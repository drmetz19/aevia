import { and, asc, desc, eq, sql } from "drizzle-orm";
import { HIDDEN_REASON, prepSchema, type Prep } from "@aevia/core";
import {
  assessments,
  consents,
  consultationRequests,
  consultations,
  events,
  patients,
  programs,
  type Db,
} from "@aevia/db";
import { AuthError } from "../auth/otp";
import { toView } from "../consultations/service";
import { beautySnapshotFor } from "../connectors/context";

type Ctx = { db: Db; clinicId: string; staffId: string; now: Date };

const hasConsent = sql<boolean>`exists (select 1 from ${consents} c where c.patient_id = ${consultationRequests.patientId} and c.scope = 'assessment' and c.granted_at is not null and c.revoked_at is null)`;

export async function queue(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const rows = await tx
      .select({
        r: consultationRequests,
        email: patients.email,
        program: programs.name,
        visible: hasConsent,
        flagged: assessments.flagged,
        scheduled: consultations.scheduledAt,
      })
      .from(consultationRequests)
      .innerJoin(patients, eq(patients.id, consultationRequests.patientId))
      .innerJoin(programs, eq(programs.id, consultationRequests.programId))
      .leftJoin(assessments, eq(assessments.id, consultationRequests.assessmentId))
      .leftJoin(consultations, eq(consultations.requestId, consultationRequests.id))
      .orderBy(
        sql`case ${consultationRequests.status} when 'submitted' then 0 else 1 end`,
        asc(consultationRequests.createdAt),
      );
    return rows.map((x) => ({
      id: x.r.id,
      status: x.r.status,
      created_at: x.r.createdAt.toISOString(),
      patient_id: x.r.patientId,
      patient_email: x.email,
      program_name: x.program,
      assessment_visible: Boolean(x.visible),
      flagged: x.visible ? (x.flagged ?? false) : null,
      scheduled_at: x.scheduled ? x.scheduled.toISOString() : null,
    }));
  });
}

export async function patientDetail(c: Ctx, patientId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
    if (!p) throw new AuthError(404, "patient_not_found", "Pasien yang Anda cari belum ditemukan di klinik ini.");
    const [consent] = await tx
      .select()
      .from(consents)
      .where(and(eq(consents.patientId, p.id), eq(consents.scope, "assessment")));
    const visible = Boolean(consent?.grantedAt && !consent.revokedAt);
    const [a] = visible
      ? await tx
          .select()
          .from(assessments)
          .where(and(eq(assessments.patientId, p.id), eq(assessments.status, "completed")))
          .orderBy(desc(assessments.completedAt))
          .limit(1)
      : [];
    const reqs = await tx
      .select({ r: consultationRequests, p: programs.name, k: consultations })
      .from(consultationRequests)
      .innerJoin(programs, eq(programs.id, consultationRequests.programId))
      .leftJoin(consultations, eq(consultations.requestId, consultationRequests.id))
      .where(eq(consultationRequests.patientId, p.id))
      .orderBy(desc(consultationRequests.createdAt));
    const external = await beautySnapshotFor(tx, p.id);
    return {
      patient: { id: p.id, email: p.email, created_at: p.createdAt.toISOString() },
      external_context: external,
      assessment_visible: visible,
      hidden_reason: visible ? null : HIDDEN_REASON,
      assessment: a
        ? { id: a.id, flagged: a.flagged, completed_at: a.completedAt?.toISOString() ?? null, result: a.result }
        : null,
      requests: reqs.map((x) => {
        const v = toView(x.r, x.p, x.k);
        return {
          id: v.id,
          status: v.status,
          program_name: v.program_name,
          created_at: v.created_at,
          prep: visible ? (v.prep as Prep) : null,
          consultation: v.consultation,
        };
      }),
    };
  });
}

export async function acceptRequest(c: Ctx, requestId: string, body: { scheduled_at: string; meeting_url: string }) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [row] = await tx
      .select({ r: consultationRequests, p: programs.name })
      .from(consultationRequests)
      .innerJoin(programs, eq(programs.id, consultationRequests.programId))
      .where(eq(consultationRequests.id, requestId));
    if (!row) throw new AuthError(404, "request_not_found", "Permintaan konsultasi ini belum ditemukan.");
    if (row.r.status !== "submitted") {
      throw new AuthError(409, "request_decided", "Permintaan ini sudah ditanggapi sebelumnya.");
    }
    const when = new Date(body.scheduled_at);
    if (when.getTime() <= c.now.getTime()) {
      throw new AuthError(400, "bad_schedule", "Jadwal konsultasi sebaiknya di waktu yang akan datang.");
    }
    const [updated] = await tx
      .update(consultationRequests)
      .set({ status: "accepted", decidedAt: c.now })
      .where(eq(consultationRequests.id, requestId))
      .returning();
    const [k] = await tx
      .insert(consultations)
      .values({
        clinicId: c.clinicId,
        requestId,
        patientId: row.r.patientId,
        professionalId: c.staffId,
        scheduledAt: when,
        meetingUrl: body.meeting_url,
        createdAt: c.now,
      })
      .returning();
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "consultation.accepted",
      payload: { request_id: requestId, consultation_id: k!.id, patient_id: row.r.patientId },
      createdAt: c.now,
    });
    return toView(updated!, row.p, k!);
  });
}

export { prepSchema };
