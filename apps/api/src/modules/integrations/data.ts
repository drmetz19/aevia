import { and, desc, eq } from "drizzle-orm";
import { REMINDER_MESSAGE } from "@aevia/core";
import { assessments, carePlans, checkins, consents, consultationRequests, patients, reminders, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { currentPlanIn } from "../plans/service";
import { progressFor } from "../progress/service";
import { createRequest } from "../consultations/service";
import type { Integration } from "./auth";

type Ctx = { db: Db; who: Integration; now: Date };
const NO_PATIENT = "Pasien ini belum ditemukan di klinik Anda.";
const NO_CONSENT = "Pasien belum memberi persetujuan akses rekam medis, jadi data ini tidak dapat dibaca.";

/** Setiap panggilan integrasi tercatat: actor_type=api, actor_id=id kredensial, `via`=api:<prefix>. */
const audit = (tx: Tx, c: Ctx, entity: string, entityId: string, action: string, after: Record<string, unknown> = {}) =>
  writeAudit(tx, { clinicId: c.who.clinicId, actorType: c.who.actor, actorId: c.who.id, entity, entityId, action, before: null, after: { via: c.who.label, ...after }, at: c.now });

async function patientIn(tx: Tx, id: string) {
  const [p] = await tx.select().from(patients).where(eq(patients.id, id));
  if (!p) throw new AuthError(404, "patient_not_found", NO_PATIENT);
  return p;
}
async function hasMedicalConsent(tx: Tx, patientId: string) {
  const [c] = await tx.select().from(consents).where(and(eq(consents.patientId, patientId), eq(consents.scope, "medical_record")));
  return Boolean(c?.grantedAt && !c.revokedAt);
}
async function requireMedicalConsent(tx: Tx, patientId: string) {
  if (!(await hasMedicalConsent(tx, patientId))) throw new AuthError(403, "consent_required", NO_CONSENT);
}

export async function patientSummary(c: Ctx, patientId: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const p = await patientIn(tx, patientId);
    const cs = await tx.select().from(consents).where(eq(consents.patientId, patientId));
    const reqs = await tx.select({ status: consultationRequests.status }).from(consultationRequests).where(eq(consultationRequests.patientId, patientId));
    const visible = await hasMedicalConsent(tx, patientId);
    let clinical = null;
    if (visible) {
      const [a] = await tx.select({ at: assessments.completedAt }).from(assessments).where(and(eq(assessments.patientId, patientId), eq(assessments.status, "completed"))).orderBy(desc(assessments.completedAt)).limit(1);
      const [plan] = await tx.select({ v: carePlans.version }).from(carePlans).where(and(eq(carePlans.patientId, patientId), eq(carePlans.status, "signed"))).orderBy(desc(carePlans.signedAt)).limit(1);
      const cks = await tx.select({ at: checkins.createdAt }).from(checkins).where(eq(checkins.patientId, patientId)).orderBy(desc(checkins.createdAt));
      clinical = {
        last_assessment_completed_at: a?.at?.toISOString() ?? null,
        signed_plan_version: plan?.v ?? null,
        checkin_count: cks.length,
        last_checkin_at: cks[0]?.at.toISOString() ?? null,
      };
    }
    await audit(tx, c, "patient", patientId, "integration.read.summary", { clinical_visible: visible });
    return {
      patient: { id: p.id, created_at: p.createdAt.toISOString() },
      consents: cs.map((x) => ({ scope: x.scope, granted: Boolean(x.grantedAt && !x.revokedAt) })),
      consultation_requests: {
        submitted: reqs.filter((r) => r.status === "submitted").length,
        accepted: reqs.filter((r) => r.status === "accepted").length,
        declined: reqs.filter((r) => r.status === "declined").length,
      },
      clinical_visible: visible,
      hidden_reason: visible ? null : NO_CONSENT,
      clinical,
    };
  });
}

export async function patientCheckins(c: Ctx, patientId: string, limit: number) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await patientIn(tx, patientId);
    await requireMedicalConsent(tx, patientId);
    const rows = await tx.select().from(checkins).where(eq(checkins.patientId, patientId)).orderBy(desc(checkins.createdAt)).limit(limit);
    await audit(tx, c, "patient", patientId, "integration.read.checkins", { count: rows.length });
    // catatan bebas (note) sengaja tidak ikut: bisa memuat data pribadi
    return { checkins: rows.map((r) => ({ id: r.id, created_at: r.createdAt.toISOString(), values: r.values, mood: r.mood })) };
  });
}

export async function patientProgressFor(c: Ctx, patientId: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await patientIn(tx, patientId);
    await requireMedicalConsent(tx, patientId);
    const progress = await progressFor(tx, patientId);
    await audit(tx, c, "patient", patientId, "integration.read.progress");
    return progress;
  });
}

export async function patientCarePlan(c: Ctx, patientId: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await patientIn(tx, patientId);
    await requireMedicalConsent(tx, patientId);
    const plan = await currentPlanIn(tx, { db: c.db, clinicId: c.who.clinicId, patientId });
    await audit(tx, c, "patient", patientId, "integration.read.care_plan", { plan_id: plan?.id ?? null });
    return { plan };
  });
}

export async function createReminder(c: Ctx, body: { patient_id: string; kind: "checkin" | "review"; due_at?: string }) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await patientIn(tx, body.patient_id);
    const dueAt = body.due_at ? new Date(body.due_at) : c.now;
    const [r] = await tx.insert(reminders).values({ clinicId: c.who.clinicId, patientId: body.patient_id, kind: body.kind, message: REMINDER_MESSAGE[body.kind], dueAt, createdAt: c.now }).returning();
    await audit(tx, c, "reminder", r!.id, "integration.reminder.create", { patient_id: body.patient_id, kind: body.kind });
    return { id: r!.id, patient_id: body.patient_id, kind: r!.kind, due_at: r!.dueAt.toISOString() };
  });
}

export async function createConsultationRequest(c: Ctx, body: { patient_id: string; program_id: string; prep: { tujuan: string; keluhan: string; pertanyaan: string[]; konteks_assessment: string } }) {
  await c.db.withTenant(c.who.clinicId, (tx) => patientIn(tx, body.patient_id));
  const view = await createRequest({ db: c.db, clinicId: c.who.clinicId, patientId: body.patient_id, now: c.now }, body.program_id, body.prep, (tx, row) =>
    audit(tx, c, "consultation_request", row.id, "integration.consultation_request.create", { patient_id: body.patient_id, program_id: body.program_id }),
  );
  return { id: view.id, patient_id: body.patient_id, program_id: view.program_id, status: view.status, created_at: view.created_at };
}
