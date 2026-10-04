import { z } from "zod";
import { sanitizeOutput } from "./guardrail";

export const prescriptionItemSchema = z.object({
  name: z.string().trim().min(1, "Nama obat belum terisi.").max(120),
  strength: z.string().trim().max(60).default(""),
  dose: z.string().trim().max(60).default(""),
  frequency: z.string().trim().max(80).default(""),
  route: z.string().trim().max(60).default(""),
  duration: z.string().trim().max(60).default(""),
  notes: z.string().trim().max(300).default(""),
});
export type PrescriptionItem = z.infer<typeof prescriptionItemSchema>;
export const prescriptionBodySchema = z.object({ items: z.array(prescriptionItemSchema).min(1, "Tambahkan minimal satu item resep.").max(20) });
export const prescriptionSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.enum(["draft", "issued", "superseded"]),
  items: z.array(prescriptionItemSchema),
  issued_at: z.string().nullable(),
  issued_by_name: z.string().nullable(),
  updated_at: z.string(),
});
export const prescriptionListSchema = z.object({ prescriptions: z.array(prescriptionSchema) });
export type PrescriptionView = z.infer<typeof prescriptionSchema>;

export const monitorMetricSchema = z.object({
  metric_key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, "Nama metrik belum terisi.").max(80),
  unit: z.string().trim().max(20).default(""),
  baseline: z.number().nullable().default(null),
  target: z.number().nullable().default(null),
  direction: z.enum(["up", "down"]).default("up"),
});
export type MonitorMetric = z.infer<typeof monitorMetricSchema>;

export const planContentSchema = z.object({
  focus: z.array(z.string().trim().min(1).max(300)).max(10),
  next_steps: z.array(z.string().trim().min(1).max(300)).max(10),
  monitor: z.array(monitorMetricSchema).max(10),
  review_at: z.iso.date().nullable().default(null),
});
export type PlanContent = z.infer<typeof planContentSchema>;

export const summarySchema = z.object({
  discussed: z.string().trim().max(2000),
  priorities: z.array(z.string().trim().min(1).max(300)).max(10),
});
export type PlanSummary = z.infer<typeof summarySchema>;

export const planBodySchema = z.object({ content: planContentSchema, summary: summarySchema });
export const planSchema = z.object({
  id: z.string(),
  consultation_id: z.string(),
  version: z.number(),
  status: z.enum(["draft", "signed", "superseded"]),
  content: planContentSchema,
  summary: summarySchema,
  signed_at: z.string().nullable(),
  signed_by_name: z.string().nullable(),
  updated_at: z.string(),
});
export type PlanView = z.infer<typeof planSchema>;
export const planListSchema = z.object({ plans: z.array(planSchema) });
export const signBodySchema = z.object({
  confirm: z.literal(true, { error: "Mohon centang konfirmasi sebelum menandatangani." }),
});

export const patientPlanSchema = z.object({
  id: z.string(),
  version: z.number(),
  consultation_id: z.string(),
  clinic_name: z.string(),
  signed_at: z.string(),
  signed_by_name: z.string(),
  content: planContentSchema,
  summary: summarySchema,
  explanation: z.string(),
  prescription: z
    .object({ issued_at: z.string(), issued_by_name: z.string(), items: z.array(prescriptionItemSchema) })
    .nullable(),
});
export type PatientPlan = z.infer<typeof patientPlanSchema>;
export const patientSummarySchema = z.object({
  consultation_id: z.string(),
  scheduled_at: z.string(),
  plan: patientPlanSchema.nullable(),
});

export const PLAN_HEADINGS = {
  focus: "Fokus Anda saat ini",
  next: "Langkah berikutnya",
  monitor: "Yang perlu dipantau",
  review: "Kapan kita tinjau kembali",
} as const;
export const SUMMARY_HEADINGS = {
  discussed: "Yang dibahas",
  priorities: "Prioritas Anda",
  plan: "Rencana saat ini",
  next: "Langkah berikutnya",
} as const;
export const SUMMARY_OPENING = "Berikut hal utama yang dibahas bersama profesional Anda.";
export const EMPTY_PLAN = "Rencana akan tersedia setelah konsultasi selesai ditinjau profesional.";
export const planUpdatedLine = (clinicName: string) => `Rencana Anda telah diperbarui oleh tim ${clinicName}.`;
export const PLAN_CO_BRAND_LINE = "Rencana ini disusun oleh tim klinik Anda dan ditampilkan melalui AEVIA.";
export const PLAN_WHITELABEL_LINE = (clinicName: string) => `Rencana ini disusun oleh tim ${clinicName}.`;

/** Penjelasan Sovia (templat deterministik). Tidak pernah mengubah rencana; setiap bagian lewat guardrail. */
export function explainPlan(assistantName: string, plan: { content: PlanContent }): string {
  const c = plan.content;
  const parts = [`Saya ${assistantName}. Saya bantu menjelaskan rencana yang sudah ditinjau dan ditandatangani profesional Anda.`];
  if (c.focus.length) parts.push(`Fokus Anda saat ini: ${c.focus.join("; ")}.`);
  if (c.next_steps.length) parts.push(`Langkah berikutnya: ${c.next_steps.join("; ")}.`);
  if (c.monitor.length) parts.push(`Yang akan kita pantau: ${c.monitor.map((m) => m.label).join(", ")}.`);
  if (c.review_at) parts.push(`Rencana ini akan ditinjau kembali pada ${formatDateId(c.review_at)}.`);
  parts.push("Bagian ini sebaiknya dibahas langsung dengan profesional Anda bila ada yang ingin ditanyakan.");
  // Isi rencana adalah milik profesional; guardrail hanya menjaga ucapan Sovia (bagian rakitan).
  return parts.map((p) => (p.startsWith("Fokus") || p.startsWith("Langkah") || p.startsWith("Yang akan") ? p : sanitizeOutput(p).text)).join(" ");
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export function formatDateId(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Hash tanda tangan: sha256(content + summary + staff + timestamp). Dihitung di API (node:crypto). */
export function signaturePayload(content: unknown, summary: unknown, staffId: string, signedAtIso: string): string {
  return JSON.stringify({ content, summary, staff: staffId, at: signedAtIso });
}
