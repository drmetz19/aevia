import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { KS_STATUS_MAP } from "@aevia/core";
import type { beautycodeTrackerBodySchema, kliniksistemVisitBodySchema } from "@aevia/core";
import { clinicConnectors, consultations, events, externalContext, inboundEvents, patients, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import type { Integration } from "../integrations/auth";
import { externalConsentActive } from "./context";

type Ctx = { db: Db; who: Integration; now: Date };
const TERMINAL = new Set(["completed", "no_show", "cancelled"]);

const audit = (tx: Tx, c: Ctx, entity: string, entityId: string, action: string, before: unknown, after: Record<string, unknown>) =>
  writeAudit(tx, { clinicId: c.who.clinicId, actorType: c.who.actor, actorId: c.who.id, entity, entityId, action, before, after: { via: c.who.label, ...after }, at: c.now });

async function requireConnectorEnabled(tx: Tx, kind: "kliniksistem" | "beautycode") {
  const [r] = await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, kind));
  if (r && (r.config as { enabled?: boolean }).enabled === false) throw new AuthError(409, "connector_disabled", "Konektor ini sedang dinonaktifkan oleh admin klinik.");
}

/** Idempotensi: event id yang sama mengembalikan hasil pertama tanpa menjalankan ulang efeknya. */
async function once<T extends Record<string, unknown>>(tx: Tx, c: Ctx, source: string, eventId: string | undefined, run: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!eventId) return { result: await run(), replayed: false };
  const [seen] = await tx.select().from(inboundEvents).where(and(eq(inboundEvents.source, source), eq(inboundEvents.eventId, eventId)));
  if (seen) return { result: seen.result as T, replayed: true };
  const result = await run();
  await tx.insert(inboundEvents).values({ clinicId: c.who.clinicId, source, eventId, result, createdAt: c.now });
  return { result, replayed: false };
}

export async function kliniksistemVisit(c: Ctx, body: z.infer<typeof kliniksistemVisitBodySchema>, eventId?: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await requireConnectorEnabled(tx, "kliniksistem");
    return once(tx, c, "kliniksistem.visit", eventId, async () => {
      const [k] = body.aevia_consultation_id
        ? await tx.select().from(consultations).where(eq(consultations.id, body.aevia_consultation_id))
        : await tx.select().from(consultations).where(eq(consultations.externalRef, body.booking_id!));
      if (!k) throw new AuthError(404, "consultation_not_found", "Konsultasi untuk booking ini belum ditemukan di klinik Anda.");
      if (body.booking_id && k.externalRef && k.externalRef !== body.booking_id) throw new AuthError(409, "booking_mismatch", "booking_id tidak sesuai dengan booking yang tertaut pada konsultasi ini.");
      const next = KS_STATUS_MAP[body.status];
      if (next === "scheduled" && TERMINAL.has(k.status)) throw new AuthError(409, "invalid_transition", "Konsultasi ini sudah selesai atau ditutup, jadi tidak dapat dikembalikan ke Scheduled.");
      const at = new Date(body.occurred_at);
      const stale = Boolean(k.externalUpdatedAt && at.getTime() < k.externalUpdatedAt.getTime());
      const pay = body.payment_status ? (body.payment_status === "Paid" ? ("paid" as const) : ("unpaid" as const)) : undefined;
      const statusChanged = !stale && next !== k.status;
      const payChanged = !stale && pay !== undefined && pay !== k.paymentStatus;
      const linked = Boolean(body.booking_id && !k.externalRef);
      if (statusChanged || payChanged || linked || (!stale && !k.externalUpdatedAt)) {
        await tx
          .update(consultations)
          .set({ ...(statusChanged ? { status: next } : {}), ...(payChanged ? { paymentStatus: pay } : {}), ...(linked ? { externalRef: body.booking_id } : {}), ...(stale ? {} : { externalUpdatedAt: at }) })
          .where(eq(consultations.id, k.id));
      }
      if (statusChanged) {
        await tx.insert(events).values({ clinicId: c.who.clinicId, type: "consultation.status_changed", payload: { consultation_id: k.id, patient_id: k.patientId, status: next }, createdAt: c.now });
      }
      await tx.update(clinicConnectors).set({ lastSyncAt: c.now }).where(eq(clinicConnectors.kind, "kliniksistem"));
      await audit(tx, c, "consultation", k.id, "integration.kliniksistem.visit", { status: k.status, payment_status: k.paymentStatus }, { status: stale ? k.status : next, payment_status: payChanged ? pay : k.paymentStatus, changed: statusChanged || payChanged, stale, event_id: eventId ?? null });
      return { consultation_id: k.id, status: stale ? k.status : next, payment_status: payChanged ? pay! : (k.paymentStatus ?? null), changed: statusChanged || payChanged };
    });
  });
}

export async function beautycodeTracker(c: Ctx, body: z.infer<typeof beautycodeTrackerBodySchema>, eventId?: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await requireConnectorEnabled(tx, "beautycode");
    const [p] = body.aevia_patient_id ? await tx.select().from(patients).where(eq(patients.id, body.aevia_patient_id)) : await tx.select().from(patients).where(eq(patients.email, body.email!));
    if (!p) throw new AuthError(404, "patient_not_found", "Pasien ini belum ditemukan di klinik Anda.");
    return once(tx, c, "beautycode.tracker", eventId, async () => {
      if (!(await externalConsentActive(tx, p.id))) {
        throw new AuthError(403, "consent_required", "Pasien belum memberi persetujuan untuk membagikan konteks dari aplikasi lain, jadi data Beauty Code tidak dapat disimpan.");
      }
      const data = { ...(body.skin_barrier !== undefined ? { skin_barrier: body.skin_barrier } : {}), ...(body.sleep_hours !== undefined ? { sleep_hours: body.sleep_hours } : {}), ...(body.diet_triggers ? { diet_triggers: body.diet_triggers } : {}), ...(body.raw ? { raw: body.raw } : {}) };
      const [row] = await tx.insert(externalContext).values({ clinicId: c.who.clinicId, patientId: p.id, source: "beautycode", data, recordedAt: new Date(body.recorded_at), createdAt: c.now }).returning();
      await tx.update(clinicConnectors).set({ lastSyncAt: c.now }).where(eq(clinicConnectors.kind, "beautycode"));
      await audit(tx, c, "external_context", row!.id, "integration.beautycode.tracker", null, { patient_id: p.id, fields: Object.keys(data), event_id: eventId ?? null });
      return { id: row!.id, patient_id: p.id, recorded_at: row!.recordedAt.toISOString() };
    });
  });
}
