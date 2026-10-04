import { z } from "zod";
import bank from "./questions.v0.json";
import { detectEmergency, EMERGENCY_MESSAGE, sanitizeOutput } from "./guardrail";

export interface QuestionOption {
  value: number;
  label: string;
}
export interface Question {
  id: string;
  area: string;
  type: "choice" | "text";
  scored: boolean;
  text: string;
  options: QuestionOption[];
}

export const questions = bank.questions as Question[];
export const areas = bank.areas as { id: string; label: string }[];
export const areaLabel = (id: string) => areas.find((a) => a.id === id)?.label ?? id;
export const findQuestion = (id: string) => questions.find((q) => q.id === id);
export const DISCLAIMER = "Hasil assessment bukan diagnosis.";

export const publicQuestionSchema = z.object({
  id: z.string(),
  area: z.string(),
  area_label: z.string(),
  type: z.enum(["choice", "text"]),
  text: z.string(),
  optional: z.boolean(),
  options: z.array(z.object({ value: z.number(), label: z.string() })),
});
export type PublicQuestion = z.infer<typeof publicQuestionSchema>;
export const toPublicQuestion = (q: Question): PublicQuestion => ({
  id: q.id,
  area: q.area,
  area_label: areaLabel(q.area),
  type: q.type,
  text: q.text,
  optional: q.type === "text",
  options: q.options,
});

export const levelSchema = z.enum(["stable", "attention", "priority"]);
export type Level = z.infer<typeof levelSchema>;
export const LEVEL_LABEL: Record<Level, string> = {
  stable: "Relatif stabil",
  attention: "Layak diperhatikan",
  priority: "Prioritas untuk dibahas",
};

export const resultSchema = z.object({
  areas: z.array(z.object({ area: z.string(), label: z.string(), score: z.number(), level: levelSchema, level_label: z.string() })),
  priorities: z.array(z.string()),
  goal: z.string().nullable(),
  disclaimer: z.string(),
});
export type AssessmentResult = z.infer<typeof resultSchema>;

export interface StoredAnswer {
  question_id: string;
  value: number | null;
  text: string | null;
}

export const levelOf = (score: number): Level => (score >= 67 ? "stable" : score >= 34 ? "attention" : "priority");

/** Skor 0–100 per area (makin tinggi makin tenang). Jawaban 1 = paling baik, 4 = paling perlu dibahas. */
export function scoreAssessment(answers: StoredAnswer[]): AssessmentResult {
  const scored = areas
    .filter((a) => a.id !== "tujuan")
    .map((a) => {
      const vals = questions
        .filter((q) => q.area === a.id && q.scored)
        .map((q) => answers.find((x) => x.question_id === q.id)?.value)
        .filter((v): v is number => typeof v === "number");
      const avg = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      const score = Math.round(((4 - avg) / 3) * 100);
      const level = levelOf(score);
      return { area: a.id, label: a.label, score, level, level_label: LEVEL_LABEL[level] };
    });
  const priorities = [...scored].sort((x, y) => x.score - y.score).slice(0, 3).map((x) => x.area);
  const goalQ = questions.find((q) => q.id === "tujuan-1");
  const goalVal = answers.find((a) => a.question_id === "tujuan-1")?.value;
  return {
    areas: scored,
    priorities,
    goal: goalQ?.options.find((o) => o.value === goalVal)?.label ?? null,
    disclaimer: DISCLAIMER,
  };
}

export const assessmentStateSchema = z.object({
  id: z.string(),
  status: z.enum(["in_progress", "completed"]),
  flagged: z.boolean(),
  answered: z.number(),
  total: z.number(),
  next_question: publicQuestionSchema.nullable(),
  answers: z.array(z.object({ question_id: z.string(), value: z.number().nullable(), text: z.string().nullable() })),
  emergency_message: z.string().nullable(),
  result: resultSchema.nullable(),
  completed_at: z.string().nullable(),
});
export type AssessmentState = z.infer<typeof assessmentStateSchema>;

export const answerBodySchema = z.object({
  question_id: z.string().min(1).max(64),
  value: z.number().int().min(1).max(4).nullish(),
  text: z.string().max(500).nullish(),
});

export { EMERGENCY_MESSAGE, detectEmergency };

/** SoviaEngine: script (deterministik, default) atau llm (nanti, via LLMProvider). Semua keluaran lewat guardrail. */
export interface SoviaEngine {
  mode: "script" | "llm";
  intro(assistantName: string): string;
  acknowledge(index: number): string;
}

const ACKS = ["Terima kasih, sudah saya catat.", "Baik, terima kasih sudah berbagi.", "Dicatat ya. Kita lanjut pelan-pelan.", "Terima kasih, itu membantu."];

export const scriptEngine: SoviaEngine = {
  mode: "script",
  intro: (name) =>
    `Halo, saya ${name}. Mari mulai dengan memahami kondisi Anda saat ini. Tidak ada jawaban benar atau salah, pilih yang paling sesuai dengan keadaan Anda.`,
  acknowledge: (i) => ACKS[i % ACKS.length]!,
};

export function guardEngine(e: SoviaEngine): SoviaEngine {
  return {
    mode: e.mode,
    intro: (n) => sanitizeOutput(e.intro(n)).text,
    acknowledge: (i) => sanitizeOutput(e.acknowledge(i)).text,
  };
}
