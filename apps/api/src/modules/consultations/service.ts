import { and, desc, eq } from "drizzle-orm";
import { VOUCHER_ERRORS, beautyContextLine, draftPrep, prepSchema, resultSchema, type ConsultationRequestView, type Prep, type StoredAnswer } from "@aevia/core";
import { assessmentAnswers, assessments, consultationRequests, consultations, events, programs, voucherRedemptions, vouchers, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { beautySnapshotFor } from "../connectors/context";

type Ctx = { db: Db; clinicId: string; patientId: string; now: Date };

export async function buildDraft(c: Ctx): Promise<{ prep: Prep; status: "draft"; from_assessment: boolean }> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const ext = await beautySnapshotFor(tx, c.patientId);
    const extra = ext.beautycode ? beautyContextLine(ext.beautycode) : "";
    const [a] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.patientId, c.patientId), eq(assessments.status, "completed")))
      .orderBy(desc(assessments.completedAt))
      .limit(1);
    if (!a?.result) return { prep: draftPrep(null, [], extra), status: "draft" as const, from_assessment: false };
    const rows = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, a.id));
    const answers: StoredAnswer[] = rows.map((r) => ({ question_id: r.questionId, value: r.value, text: r.text }));
    return { prep: draftPrep(resultSchema.parse(a.result), answers, extra), status: "draft" as const, from_assessment: true };
  });
}

export function toView(
  r: typeof consultationRequests.$inferSelect,
  programName: string,
  k: typeof consultations.$inferSelect | null,
): ConsultationRequestView {
  return {
    id: r.id,
    status: r.status,
    program_id: r.programId,
    program_name: programName,
    created_at: r.createdAt.toISOString(),
    prep: prepSchema.parse(r.prep),
    consultation: k
      ? { id: k.id, scheduled_at: k.scheduledAt.toISOString(), meeting_url: k.meetingUrl, status: k.status }
      : null,
  };
}

const voucherError = (code: keyof typeof VOUCHER_ERRORS) => new AuthError(VOUCHER_ERRORS[code][0], code, VOUCHER_ERRORS[code][1]);

/**
 * `audit` (opsional) dijalankan di transaksi yang sama, mis. untuk permintaan lewat API integrasi.
 * Voucher: bila program ber-akses voucher kode wajib (kecuali `enforceVoucher: false`, mis. permintaan dari sistem klinik);
 * kode yang diisi ditukar atomik di transaksi yang sama — galat apa pun membatalkan pembuatan permintaan.
 */
export async function createRequest(
  c: Ctx,
  programId: string,
  prep: Prep,
  audit?: (tx: Tx, row: typeof consultationRequests.$inferSelect) => Promise<void>,
  voucher: { code?: string; enforce?: boolean } = {},
) {
  const code = voucher.code?.trim().toUpperCase() || null;
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [p] = await tx.select().from(programs).where(and(eq(programs.id, programId), eq(programs.active, true)));
    if (!p) throw new AuthError(404, "program_not_found", "Program yang Anda pilih belum ditemukan di klinik ini.");
    const [dupe] = await tx
      .select({ id: consultationRequests.id })
      .from(consultationRequests)
      .where(
        and(
          eq(consultationRequests.patientId, c.patientId),
          eq(consultationRequests.programId, programId),
          eq(consultationRequests.status, "submitted"),
        ),
      );
    if (dupe) {
      throw new AuthError(409, "request_exists", "Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik.");
    }
    if (!code && p.access === "voucher" && voucher.enforce !== false) throw voucherError("voucher_required");
    const [v] = code ? await tx.select().from(vouchers).where(eq(vouchers.code, code)).for("update") : [];
    if (code) {
      if (!v || !v.active) throw voucherError("voucher_invalid");
      if (v.expiresAt && v.expiresAt.getTime() <= c.now.getTime()) throw voucherError("voucher_expired");
      if (v.programId && v.programId !== programId) throw voucherError("voucher_not_for_program");
      const [used] = await tx
        .select({ id: voucherRedemptions.id })
        .from(voucherRedemptions)
        .where(and(eq(voucherRedemptions.voucherId, v.id), eq(voucherRedemptions.patientId, c.patientId)));
      if (used) throw voucherError("voucher_already_used");
      if (v.maxUses !== null && v.usedCount >= v.maxUses) throw voucherError("voucher_exhausted");
    }
    const [a] = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.patientId, c.patientId), eq(assessments.status, "completed")))
      .orderBy(desc(assessments.completedAt))
      .limit(1);
    const [row] = await tx
      .insert(consultationRequests)
      .values({ clinicId: c.clinicId, patientId: c.patientId, programId, assessmentId: a?.id ?? null, prep, createdAt: c.now })
      .returning();
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "consultation.requested",
      payload: { request_id: row!.id, patient_id: c.patientId, program_id: programId },
      createdAt: c.now,
    });
    if (v) {
      await tx.update(vouchers).set({ usedCount: v.usedCount + 1 }).where(eq(vouchers.id, v.id));
      await tx.insert(voucherRedemptions).values({ clinicId: c.clinicId, voucherId: v.id, patientId: c.patientId, requestId: row!.id, at: c.now });
      await writeAudit(tx, {
        clinicId: c.clinicId,
        actorType: "patient",
        actorId: c.patientId,
        entity: "voucher",
        entityId: v.id,
        action: "voucher.redeem",
        before: { used_count: v.usedCount },
        after: { used_count: v.usedCount + 1, request_id: row!.id, program_id: programId },
        at: c.now,
      });
    }
    if (audit) await audit(tx, row!);
    return toView(row!, p.name, null);
  });
}

export async function myRequests(c: Ctx): Promise<ConsultationRequestView[]> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const rows = await tx
      .select({ r: consultationRequests, p: programs.name, k: consultations })
      .from(consultationRequests)
      .innerJoin(programs, eq(programs.id, consultationRequests.programId))
      .leftJoin(consultations, eq(consultations.requestId, consultationRequests.id))
      .where(eq(consultationRequests.patientId, c.patientId))
      .orderBy(desc(consultationRequests.createdAt));
    return rows.map((x) => toView(x.r, x.p, x.k));
  });
}

export type { Tx };
