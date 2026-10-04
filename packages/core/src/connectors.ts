import { z } from "zod";
import { validateWebhookUrl } from "./integrations";

export const CONNECTOR_KINDS = ["kliniksistem", "beautycode"] as const;
export const connectorKindSchema = z.enum(CONNECTOR_KINDS);

/** Status kunjungan KlinikSistem ↔ status konsultasi AEVIA. */
export const KS_VISIT_STATUS = ["Scheduled", "Completed", "No-show", "Cancelled"] as const;
export const ksVisitStatusSchema = z.enum(KS_VISIT_STATUS, { error: "Status kunjungan harus Scheduled, Completed, No-show, atau Cancelled." });
export const KS_STATUS_MAP = { Scheduled: "scheduled", Completed: "completed", "No-show": "no_show", Cancelled: "cancelled" } as const;
export const ksPaymentSchema = z.enum(["Paid", "Unpaid"], { error: "Status pembayaran harus Paid atau Unpaid." });

export const kliniksistemVisitBodySchema = z
  .object({
    booking_id: z.string().trim().min(1).max(120).optional(),
    aevia_consultation_id: z.uuid().optional(),
    status: ksVisitStatusSchema,
    payment_status: ksPaymentSchema.optional(),
    occurred_at: z.iso.datetime({ offset: true }),
  })
  .refine((v) => v.booking_id || v.aevia_consultation_id, { message: "Isi booking_id atau aevia_consultation_id.", path: ["booking_id"] });
export const kliniksistemVisitResponseSchema = z.object({
  consultation_id: z.string(),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled"]),
  payment_status: z.enum(["paid", "unpaid"]).nullable(),
  changed: z.boolean(),
});

export const beautycodeTrackerBodySchema = z
  .object({
    aevia_patient_id: z.uuid().optional(),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    recorded_at: z.iso.datetime({ offset: true }),
    skin_barrier: z.number().min(0).max(100).optional().describe("Skor skin barrier 0-100 (lebih tinggi = lebih baik)."),
    sleep_hours: z.number().min(0).max(24).optional(),
    diet_triggers: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    raw: z.record(z.string(), z.unknown()).optional().describe("Data mentah tambahan dari BeautyCode (maks. 4 KB)."),
  })
  .refine((v) => v.aevia_patient_id || v.email, { message: "Isi aevia_patient_id atau email pasien.", path: ["aevia_patient_id"] })
  .refine((v) => v.skin_barrier !== undefined || v.sleep_hours !== undefined || (v.diet_triggers?.length ?? 0) > 0 || v.raw !== undefined, { message: "Kirim setidaknya satu data: skin_barrier, sleep_hours, diet_triggers, atau raw.", path: ["skin_barrier"] })
  .refine((v) => JSON.stringify(v.raw ?? {}).length <= 4096, { message: "Data raw melebihi 4 KB.", path: ["raw"] });
export const beautycodeTrackerResponseSchema = z.object({ id: z.string(), patient_id: z.string(), recorded_at: z.string() });

export const beautySnapshotSchema = z.object({
  recorded_at: z.string(),
  skin_barrier: z.number().nullable(),
  sleep_hours: z.number().nullable(),
  diet_triggers: z.array(z.string()),
});
export type BeautySnapshot = z.infer<typeof beautySnapshotSchema>;

/** Kalimat konteks untuk draf persiapan konsultasi (Sovia). Bahasa tenang, tanpa diagnosis. */
export function beautyContextLine(s: BeautySnapshot): string {
  const parts: string[] = [];
  if (s.skin_barrier !== null) parts.push(`skor skin barrier ${s.skin_barrier}`);
  if (s.sleep_hours !== null) parts.push(`tidur sekitar ${String(s.sleep_hours).replace(".", ",")} jam`);
  if (s.diet_triggers.length) parts.push(`pemicu makanan yang dicatat: ${s.diet_triggers.join(", ")}`);
  return parts.length ? `Catatan Beauty Code terakhir Anda: ${parts.join("; ")}.` : "";
}

export const connectorConfigInputSchema = z.object({
  base_url: z
    .string()
    .trim()
    .max(300)
    .superRefine((v, ctx) => {
      const m = validateWebhookUrl(v);
      if (m) ctx.addIssue({ code: "custom", message: m.replace("webhook", "KlinikSistem") });
    })
    .transform((v) => v.replace(/\/+$/, "")),
  enabled: z.boolean(),
  push_requested: z.boolean().default(false),
  rotate_secret: z.boolean().default(false),
});
export const beautycodeConfigInputSchema = z.object({ enabled: z.boolean() });

export const connectorViewSchema = z.object({
  kind: connectorKindSchema,
  configured: z.boolean(),
  enabled: z.boolean(),
  base_url: z.string().nullable(),
  push_requested: z.boolean(),
  has_secret: z.boolean(),
  last_sync_at: z.string().nullable(),
});
export const connectorDeliveryViewSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number(),
  last_status_code: z.number().nullable(),
  last_error: z.string().nullable(),
  external_ref: z.string().nullable(),
  created_at: z.string(),
});
export const connectorOverviewSchema = z.object({ connectors: z.array(connectorViewSchema), deliveries: z.array(connectorDeliveryViewSchema) });
export const connectorSavedSchema = connectorViewSchema.extend({ secret: z.string().nullable().describe("Rahasia penandatangan; hanya terisi saat dibuat/diputar, tampil sekali.") });
export const connectorTestResultSchema = z.object({ ok: z.boolean(), status_code: z.number().nullable(), message: z.string() });
