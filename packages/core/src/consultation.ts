import { z } from "zod";
import { beautySnapshotSchema } from "./connectors";
import { areaLabel, DISCLAIMER, questions, type AssessmentResult, type StoredAnswer } from "./assessment";
import { sanitizeOutput } from "./guardrail";

export const PREP_INTRO =
  "Anda sudah memiliki gambaran awal. Sekarang mari siapkan hal yang paling penting untuk dibahas bersama profesional.";
export const PREP_NOTE = "Sovia akan membantu merangkum konteks utama agar konsultasi lebih terarah.";

export const prepSchema = z.object({
  tujuan: z.string().trim().max(600),
  keluhan: z.string().trim().max(1200),
  pertanyaan: z.array(z.string().trim().min(1).max(300)).max(8),
  konteks_assessment: z.string().trim().max(1200),
});
export type Prep = z.infer<typeof prepSchema>;

export const programPriceModeSchema = z.enum(["amount", "coming_soon"]);
export const programAccessSchema = z.enum(["open", "voucher"]);
export type ProgramPriceMode = z.infer<typeof programPriceModeSchema>;
export type ProgramAccess = z.infer<typeof programAccessSchema>;

export const programSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  duration_weeks: z.number().nullable(),
  price_idr: z.number().nullable(),
  price_mode: programPriceModeSchema,
  access: programAccessSchema,
  includes: z.array(z.string()),
});
export type Program = z.infer<typeof programSchema>;
export const programListSchema = z.object({ programs: z.array(programSchema) });

export const requestStatusSchema = z.enum(["submitted", "accepted", "declined"]);
export const consultationStatusSchema = z.enum(["scheduled", "completed", "no_show", "cancelled"]);

export const draftBodySchema = z.object({ program_id: z.uuid().optional() });
export const draftSchema = z.object({ prep: prepSchema, status: z.literal("draft"), from_assessment: z.boolean() });
/** `voucher_code`: opsional; dinormalisasi (trim + huruf besar) di server. Wajib bila program ber-akses voucher. */
export const createRequestSchema = z.object({ program_id: z.uuid(), prep: prepSchema, voucher_code: z.string().max(64).optional() });
export const VOUCHER_ERRORS = {
  voucher_required: [400, "Program ini memerlukan kode voucher dari klinik. Masukkan kodenya untuk melanjutkan."],
  voucher_invalid: [400, "Kode ini belum kami kenali. Periksa kembali atau hubungi klinik."],
  voucher_expired: [400, "Kode ini sudah melewati masa berlakunya. Hubungi klinik untuk kode yang baru."],
  voucher_exhausted: [409, "Kuota kode ini sudah terpenuhi. Hubungi klinik untuk kode lain."],
  voucher_not_for_program: [400, "Kode ini tidak berlaku untuk program yang Anda pilih. Periksa kembali atau hubungi klinik."],
  voucher_already_used: [409, "Kode ini sudah pernah Anda gunakan. Hubungi klinik bila perlu bantuan."],
} as const;

export const consultationSchema = z.object({
  id: z.string(),
  scheduled_at: z.string(),
  meeting_url: z.string(),
  status: consultationStatusSchema,
});
export const requestSchema = z.object({
  id: z.string(),
  status: requestStatusSchema,
  program_id: z.string(),
  program_name: z.string(),
  created_at: z.string(),
  prep: prepSchema,
  consultation: consultationSchema.nullable(),
});
export type ConsultationRequestView = z.infer<typeof requestSchema>;
export const myRequestsSchema = z.object({ requests: z.array(requestSchema) });

export const queueItemSchema = z.object({
  id: z.string(),
  status: requestStatusSchema,
  created_at: z.string(),
  patient_id: z.string(),
  patient_email: z.string(),
  program_name: z.string(),
  assessment_visible: z.boolean(),
  flagged: z.boolean().nullable(),
  scheduled_at: z.string().nullable(),
  voucher_code: z.string().nullable(),
});
export const queueSchema = z.object({ items: z.array(queueItemSchema) });

export const acceptBodySchema = z.object({
  scheduled_at: z.iso.datetime({ offset: true, error: "Tanggal dan jam konsultasi belum sesuai." }),
  meeting_url: z
    .url({ protocol: /^https$/, error: "Tautan pertemuan harus diawali https://" })
    .max(500),
});

export const patientDetailSchema = z.object({
  patient: z.object({ id: z.string(), email: z.string(), created_at: z.string() }),
  assessment_visible: z.boolean(),
  hidden_reason: z.string().nullable(),
  assessment: z
    .object({ id: z.string(), flagged: z.boolean(), completed_at: z.string().nullable(), result: z.unknown() })
    .nullable(),
  external_context: z
    .object({ consent_active: z.boolean(), beautycode: beautySnapshotSchema.nullable() })
    .default({ consent_active: false, beautycode: null }),
  requests: z.array(
    z.object({
      id: z.string(),
      status: requestStatusSchema,
      program_name: z.string(),
      created_at: z.string(),
      prep: prepSchema.nullable(),
      consultation: consultationSchema.nullable(),
      voucher_code: z.string().nullable(),
    }),
  ),
});

export const HIDDEN_REASON =
  "Pasien belum memberi persetujuan untuk membagikan hasil assessment, jadi isi assessment dan persiapan konsultasi disembunyikan.";

/** Draf persiapan dari assessment (mode skrip). Selalu status draft; bagian rakitan Sovia lewat guardrail. */
export function draftPrep(result: AssessmentResult | null, answers: StoredAnswer[], extraContext = ""): Prep {
  const withExtra = (p: Prep): Prep => (extraContext ? { ...p, konteks_assessment: sanitizeOutput(`${p.konteks_assessment} ${extraContext}`.trim()).text.slice(0, 1200) } : p);
  if (!result) {
    return withExtra({
      tujuan: "",
      keluhan: "",
      pertanyaan: ["Hal apa yang paling perlu saya pahami tentang kondisi saya saat ini?"],
      konteks_assessment: "Belum ada hasil assessment. Anda dapat menyelesaikan assessment lebih dulu agar konsultasi lebih terarah.",
    });
  }
  const g = (t: string) => sanitizeOutput(t).text;
  const label = (qid: string, v: number | null) => questions.find((q) => q.id === qid)?.options.find((o) => o.value === v)?.label;
  const top = result.priorities;
  const lines = top.map((area) => {
    const q = questions.find((x) => x.area === area && x.scored);
    const a = answers.find((x) => x.question_id === q?.id);
    return `${areaLabel(area)}: ${label(q?.id ?? "", a?.value ?? null) ?? "perlu dibahas"}`;
  });
  const freeText = answers
    .filter((a) => a.text && questions.find((q) => q.id === a.question_id)?.type === "text" && a.question_id !== "tujuan-t")
    .map((a) => a.text!.trim());
  const goalText = answers.find((a) => a.question_id === "tujuan-t")?.text?.trim();
  return withExtra({
    tujuan: g([result.goal, goalText].filter(Boolean).join(". ")),
    keluhan: [g(lines.join("; ")), ...freeText].filter(Boolean).join(". "),
    pertanyaan: top.map((a) => g(`Bagaimana saya bisa mendukung area ${areaLabel(a).toLowerCase()} dengan lebih baik?`)),
    konteks_assessment: g(
      `Area yang layak dibahas lebih dulu: ${top.map(areaLabel).join(", ")}. Hasil ini digunakan sebagai konteks awal sebelum konsultasi. ${DISCLAIMER}`,
    ),
  });
}

import { scriptEngine, type SoviaEngine } from "./assessment";
export interface PrepEngine extends SoviaEngine {
  draftPrep(result: AssessmentResult | null, answers: StoredAnswer[], extraContext?: string): Prep;
}
/** ScriptEngine lengkap (assessment + draf persiapan konsultasi). */
export const scriptPrepEngine: PrepEngine = { ...scriptEngine, draftPrep };
