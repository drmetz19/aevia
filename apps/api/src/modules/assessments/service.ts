import { and, desc, eq } from "drizzle-orm";
import {
  EMERGENCY_MESSAGE,
  detectEmergency,
  findQuestion,
  questions,
  resultSchema,
  scoreAssessment,
  toPublicQuestion,
  type AssessmentState,
} from "@aevia/core";
import { assessmentAnswers, assessments, consents, events, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";

type Ctx = { db: Db; clinicId: string; patientId: string; now: Date };

async function loadState(tx: Tx, a: typeof assessments.$inferSelect): Promise<AssessmentState> {
  const rows = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, a.id));
  const answers = rows.map((r) => ({ question_id: r.questionId, value: r.value, text: r.text }));
  const done = new Set(answers.map((x) => x.question_id));
  const next = questions.find((q) => !done.has(q.id));
  return {
    id: a.id,
    status: a.status,
    flagged: a.flagged,
    answered: done.size,
    total: questions.length,
    next_question: a.status === "completed" || !next ? null : toPublicQuestion(next),
    answers,
    emergency_message: a.flagged ? EMERGENCY_MESSAGE : null,
    result: a.result ? resultSchema.parse(a.result) : null,
    completed_at: a.completedAt ? a.completedAt.toISOString() : null,
  };
}

const notFound = () => new AuthError(404, "assessment_not_found", "Assessment belum ditemukan. Silakan mulai assessment baru.");

async function own(tx: Tx, c: Ctx, id: string) {
  const [a] = await tx
    .select()
    .from(assessments)
    .where(and(eq(assessments.id, id), eq(assessments.patientId, c.patientId)));
  if (!a) throw notFound();
  return a;
}

/** Mulai assessment; bila masih ada yang berjalan, lanjutkan yang itu. */
export async function startAssessment(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [open] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.patientId, c.patientId), eq(assessments.status, "in_progress")))
      .orderBy(desc(assessments.createdAt))
      .limit(1);
    const a =
      open ??
      (await tx.insert(assessments).values({ clinicId: c.clinicId, patientId: c.patientId, createdAt: c.now }).returning())[0]!;
    return loadState(tx, a);
  });
}

export async function latestAssessment(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [a] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.patientId, c.patientId))
      .orderBy(desc(assessments.createdAt))
      .limit(1);
    return a ? loadState(tx, a) : null;
  });
}

export async function latestCompleted(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [a] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.patientId, c.patientId), eq(assessments.status, "completed")))
      .orderBy(desc(assessments.completedAt))
      .limit(1);
    return a ? loadState(tx, a) : null;
  });
}

export async function submitAnswer(
  c: Ctx,
  id: string,
  body: { question_id: string; value?: number | null; text?: string | null },
) {
  const q = findQuestion(body.question_id);
  if (!q) throw new AuthError(400, "bad_question", "Pertanyaan ini tidak kami kenali. Silakan muat ulang halaman.");
  let value: number | null = null;
  let text: string | null = null;
  if (q.type === "choice") {
    if (!body.value || !q.options.some((o) => o.value === body.value)) {
      throw new AuthError(400, "bad_answer", "Ada satu bagian yang belum terisi. Silakan pilih salah satu jawaban.");
    }
    value = body.value;
  } else {
    text = body.text?.trim() ? body.text.trim() : null; // kosong = dilewati
  }
  return c.db.withTenant(c.clinicId, async (tx) => {
    const a = await own(tx, c, id);
    if (a.status === "completed") {
      throw new AuthError(409, "assessment_completed", "Assessment ini sudah selesai. Anda bisa melihat hasilnya atau memulai yang baru.");
    }
    await tx
      .insert(assessmentAnswers)
      .values({ clinicId: c.clinicId, assessmentId: a.id, questionId: q.id, value, text, createdAt: c.now })
      .onConflictDoUpdate({ target: [assessmentAnswers.assessmentId, assessmentAnswers.questionId], set: { value, text } });
    let cur = a;
    if (detectEmergency(text) && !a.flagged) {
      cur = (await tx.update(assessments).set({ flagged: true }).where(eq(assessments.id, a.id)).returning())[0]!;
    }
    return loadState(tx, cur);
  });
}

export async function completeAssessment(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [consent] = await tx
      .select()
      .from(consents)
      .where(and(eq(consents.patientId, c.patientId), eq(consents.scope, "assessment")));
    if (!consent?.grantedAt || consent.revokedAt) {
      throw new AuthError(
        403,
        "consent_required",
        "Untuk menyelesaikan assessment, mohon beri persetujuan membagikan hasil assessment kepada klinik terlebih dahulu.",
      );
    }
    const a = await own(tx, c, id);
    if (a.status === "completed") return loadState(tx, a);
    const rows = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, a.id));
    const answers = rows.map((r) => ({ question_id: r.questionId, value: r.value, text: r.text }));
    const missing = questions.filter((q) => q.type === "choice" && !answers.some((x) => x.question_id === q.id));
    if (missing.length) {
      throw new AuthError(400, "assessment_incomplete", "Ada beberapa pertanyaan yang belum terisi. Silakan lengkapi dulu ya.");
    }
    const result = scoreAssessment(answers);
    const [done] = await tx
      .update(assessments)
      .set({ status: "completed", result, completedAt: c.now })
      .where(eq(assessments.id, a.id))
      .returning();
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "assessment.completed",
      payload: { assessment_id: a.id, patient_id: c.patientId, flagged: a.flagged },
      createdAt: c.now,
    });
    return loadState(tx, done!);
  });
}
