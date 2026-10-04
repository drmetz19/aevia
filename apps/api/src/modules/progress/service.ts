import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import {
  CHECKIN_INTERVAL_DAYS,
  GENERAL_METRICS,
  REMINDER_MESSAGE,
  checkinFields,
  computeProgress,
  planContentSchema,
  type CheckinForm,
  type MonitorMetric,
  type Progress,
} from "@aevia/core";
import { carePlans, checkins, consents, events, patients, reminders, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";

export type PCtx = { db: Db; clinicId: string; patientId: string; now: Date };
const DAY = 86_400_000;

/** Metrik aktif: dari rencana signed terbaru (monitor[]); tanpa rencana → metrik umum. */
export async function activeMetrics(tx: Tx, patientId: string): Promise<{ metrics: MonitorMetric[]; planId: string | null; general: boolean }> {
  const [p] = await tx
    .select()
    .from(carePlans)
    .where(and(eq(carePlans.patientId, patientId), eq(carePlans.status, "signed")))
    .orderBy(desc(carePlans.signedAt))
    .limit(1);
  const content = p ? planContentSchema.safeParse(p.content) : null;
  if (p && content?.success && content.data.monitor.length) return { metrics: content.data.monitor, planId: p.id, general: false };
  return { metrics: GENERAL_METRICS, planId: p?.id ?? null, general: true };
}

export async function progressFor(tx: Tx, patientId: string): Promise<Progress> {
  const { metrics, general } = await activeMetrics(tx, patientId);
  const rows = await tx.select().from(checkins).where(eq(checkins.patientId, patientId)).orderBy(asc(checkins.createdAt));
  return computeProgress(metrics, rows.map((r) => ({ at: r.createdAt.toISOString(), values: r.values })), general);
}

export async function checkinForm(c: PCtx): Promise<CheckinForm> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const a = await activeMetrics(tx, c.patientId);
    return { general: a.general, plan_id: a.planId, fields: checkinFields(a.metrics) };
  });
}

export async function patientProgress(c: PCtx) {
  return c.db.withTenant(c.clinicId, (tx) => progressFor(tx, c.patientId));
}

/** Pengingat check-in berikutnya: yang masih menunggu dianggap selesai, lalu dijadwalkan ulang 14 hari ke depan. */
export async function scheduleCheckinReminder(tx: Tx, clinicId: string, patientId: string, now: Date) {
  await tx.update(reminders).set({ readAt: now }).where(and(eq(reminders.patientId, patientId), eq(reminders.kind, "checkin"), isNull(reminders.readAt)));
  await tx.insert(reminders).values({
    clinicId,
    patientId,
    kind: "checkin",
    message: REMINDER_MESSAGE.checkin,
    dueAt: new Date(now.getTime() + CHECKIN_INTERVAL_DAYS * DAY),
    createdAt: now,
  });
}

/** Dipanggil saat rencana ditandatangani: kabar pembaruan, check-in 14 hari, dan tinjauan di review_at bila ada. */
export async function remindersAfterSign(tx: Tx, clinicId: string, patientId: string, now: Date, reviewAt: string | null) {
  await tx.update(reminders).set({ readAt: now }).where(and(eq(reminders.patientId, patientId), isNull(reminders.readAt), eq(reminders.kind, "review")));
  await tx.insert(reminders).values({ clinicId, patientId, kind: "plan", message: REMINDER_MESSAGE.plan, dueAt: now, createdAt: now });
  await scheduleCheckinReminder(tx, clinicId, patientId, now);
  if (reviewAt) {
    const due = new Date(`${reviewAt}T02:00:00Z`); // 09.00 WIB
    if (due.getTime() > now.getTime()) {
      await tx.insert(reminders).values({ clinicId, patientId, kind: "review", message: REMINDER_MESSAGE.review, dueAt: due, createdAt: now });
    }
  }
}

export async function submitCheckin(c: PCtx, body: { values: Record<string, number>; note?: string; mood?: number }) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const a = await activeMetrics(tx, c.patientId);
    const fields = new Map(checkinFields(a.metrics).map((f) => [f.key, f]));
    const entries = Object.entries(body.values);
    if (!entries.length) throw new AuthError(400, "checkin_empty", "Ada satu bagian yang belum terisi. Isi minimal satu penilaian.");
    for (const [k, v] of entries) {
      const f = fields.get(k);
      if (!f) throw new AuthError(400, "checkin_unknown", "Ada penilaian yang tidak dikenali. Silakan muat ulang halaman check-in.");
      if (v < f.min || v > f.max || (f.scale && !Number.isInteger(v))) {
        throw new AuthError(400, "checkin_range", f.scale ? `Penilaian ${f.label} berada di antara ${f.min} dan ${f.max}.` : `Nilai ${f.label} belum sesuai.`);
      }
    }
    const before = await progressFor(tx, c.patientId);
    const [row] = await tx
      .insert(checkins)
      .values({ clinicId: c.clinicId, patientId: c.patientId, carePlanId: a.planId, values: body.values, note: body.note || null, mood: body.mood ?? null, createdAt: c.now })
      .returning();
    const after = await progressFor(tx, c.patientId);
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "patient", actorId: c.patientId, entity: "checkin", entityId: row!.id, action: "checkin.submit", before: null, after: { values: body.values }, at: c.now });
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "checkin.submitted",
      payload: { checkin_id: row!.id, patient_id: c.patientId, care_plan_id: a.planId },
      createdAt: c.now,
    });
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "progress.updated",
      payload: {
        patient_id: c.patientId,
        checkin_id: row!.id,
        metrics: after.metrics.map((m) => ({ key: m.key, current: m.current, previous: m.previous, change_pct: m.change_pct, status: m.status })),
        checkin_count: after.checkin_count,
        previous_checkin_count: before.checkin_count,
      },
      createdAt: c.now,
    });
    await scheduleCheckinReminder(tx, c.clinicId, c.patientId, c.now);
    return after;
  });
}

export async function dueReminders(c: PCtx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(reminders)
      .where(and(eq(reminders.patientId, c.patientId), isNull(reminders.readAt), lte(reminders.dueAt, c.now)))
      .orderBy(desc(reminders.dueAt));
    return rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, due_at: r.dueAt.toISOString() }));
  });
}

export async function markRead(c: PCtx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const done = await tx
      .update(reminders)
      .set({ readAt: c.now })
      .where(and(eq(reminders.id, id), eq(reminders.patientId, c.patientId)))
      .returning({ id: reminders.id });
    if (!done.length) throw new AuthError(404, "reminder_not_found", "Pengingat ini belum ditemukan.");
  });
}

/** Sisi staf: progres pasien, hanya bila pasien menyetujui akses rekam medis. */
export async function staffProgress(db: Db, clinicId: string, patientId: string) {
  return db.withTenant(clinicId, async (tx) => {
    const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
    if (!p) throw new AuthError(404, "patient_not_found", "Pasien yang Anda cari belum ditemukan di klinik ini.");
    const [consent] = await tx.select().from(consents).where(and(eq(consents.patientId, patientId), eq(consents.scope, "medical_record")));
    if (!consent?.grantedAt || consent.revokedAt) {
      return {
        progress_visible: false,
        hidden_reason: "Pasien belum memberi persetujuan akses rekam medis, jadi data progres disembunyikan.",
        progress: null,
      };
    }
    return { progress_visible: true, hidden_reason: null, progress: await progressFor(tx, patientId) };
  });
}
