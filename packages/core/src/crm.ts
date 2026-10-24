import { z } from "zod";

/**
 * Fase lead AEVIA, diselaraskan dengan fase penjualan CRM.
 * Urutan = urutan funnel. `lost` di luar urutan (bisa terjadi dari fase mana pun).
 * Fase bertanda `auto` maju sendiri dari kejadian perjalanan pasien (trigger DB, migrasi 0015);
 * fase lain diubah tim sales lewat API. Maju otomatis tidak pernah memundurkan fase.
 */
export const LEAD_STAGES = [
  "new",
  "contacted",
  "registered",
  "assessed",
  "consultation_requested",
  "consultation_scheduled",
  "consulted",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const leadStageSchema = z.enum(LEAD_STAGES, { error: "Fase lead belum dikenal." });

export const SALES_PHASES = ["lead", "contacted", "engaged", "qualified", "opportunity", "appointment", "proposal", "closed_won", "closed_lost"] as const;
export type SalesPhase = (typeof SALES_PHASES)[number];

export interface LeadStageInfo {
  stage: LeadStage;
  /** 0 untuk lost; selain itu posisi di funnel (1 = paling awal). Harus sama dengan aevia_lead_stage_rank() di SQL. */
  rank: number;
  label: string;
  sales_phase: SalesPhase;
  /** Kejadian AEVIA yang memajukan lead ke fase ini secara otomatis; null = hanya manual. */
  auto_trigger: string | null;
  description: string;
}

export const LEAD_STAGE_INFO: Record<LeadStage, LeadStageInfo> = {
  new: { stage: "new", rank: 1, label: "Lead baru", sales_phase: "lead", auto_trigger: null, description: "Kontak masuk dari CRM, iklan, atau formulir; belum dihubungi." },
  contacted: { stage: "contacted", rank: 2, label: "Sudah dihubungi", sales_phase: "contacted", auto_trigger: null, description: "Tim sales sudah menghubungi (WhatsApp, telepon, email)." },
  registered: { stage: "registered", rank: 3, label: "Terdaftar", sales_phase: "engaged", auto_trigger: "patient.registered", description: "Kontak masuk ke halaman klinik dan punya akun pasien." },
  assessed: { stage: "assessed", rank: 4, label: "Assessment selesai", sales_phase: "qualified", auto_trigger: "assessment.completed", description: "Menyelesaikan assessment bersama asisten AI (lead terkualifikasi)." },
  consultation_requested: { stage: "consultation_requested", rank: 5, label: "Minta konsultasi", sales_phase: "opportunity", auto_trigger: "consultation.requested", description: "Mengajukan permintaan konsultasi untuk sebuah program." },
  consultation_scheduled: { stage: "consultation_scheduled", rank: 6, label: "Konsultasi dijadwalkan", sales_phase: "appointment", auto_trigger: "consultation.accepted", description: "Klinik menerima permintaan dan menjadwalkan konsultasi." },
  consulted: { stage: "consulted", rank: 7, label: "Sudah konsultasi", sales_phase: "proposal", auto_trigger: "consultation.status_changed:completed", description: "Konsultasi selesai; program/rencana sedang ditawarkan." },
  won: { stage: "won", rank: 8, label: "Program berjalan", sales_phase: "closed_won", auto_trigger: "plan.approved", description: "Profesional menandatangani rencana pendampingan; pasien menjalani program." },
  lost: { stage: "lost", rank: 0, label: "Tidak lanjut", sales_phase: "closed_lost", auto_trigger: null, description: "Lead tidak melanjutkan. Wajib disertai alasan. Aktivitas pasien berikutnya membuka lead kembali." },
};

export const CONTACT_SOURCES = ["website", "whatsapp", "phone", "email", "referral", "social", "ads", "event", "walk_in", "aevia", "other"] as const;
export const contactSourceSchema = z.enum(CONTACT_SOURCES, { error: "Sumber kontak belum dikenal." });

/**
 * Normalisasi nomor telepon Indonesia ke format digit internasional (62…), cocok untuk WhatsApp.
 * "0812-3456-7890", "+62 812 3456 7890", "812 3456 7890" → "6281234567890". Nomor luar negeri ber-"+" dipertahankan digitnya.
 * Mengembalikan null bila bukan nomor yang masuk akal (8–15 digit).
 */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  let d = t.replace(/\D/g, "");
  if (t.startsWith("+")) {
    // sudah berkode negara
  } else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const phoneSchema = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Nomor telepon belum sesuai. Contoh: 0812 3456 7890 atau +62 812 3456 7890." });
      return z.NEVER;
    }
    return n;
  });
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "Alamat email belum sesuai." }));
const utmSchema = z
  .object({
    source: z.string().trim().max(120).optional(),
    medium: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(200).optional(),
    content: z.string().trim().max(200).optional(),
    term: z.string().trim().max(200).optional(),
  })
  .describe("Parameter UTM saat lead masuk.");
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(30).transform((t) => [...new Set(t)]);

const contactFields = {
  name: z.string().trim().min(1).max(120).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional().describe("Dinormalisasi ke 62… (format WhatsApp)."),
  source: contactSourceSchema.optional(),
  source_detail: z.string().trim().max(200).optional().describe("Mis. nama formulir, kampanye, atau perujuk."),
  utm: utmSchema.optional(),
  tags: tagsSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
  owner_staff_id: z.uuid().nullable().optional().describe("Staf klinik penanggung jawab lead."),
  value_idr: z.number().int().min(0).max(10_000_000_000).nullable().optional().describe("Perkiraan nilai transaksi (Rupiah)."),
  external_source: z.string().trim().min(1).max(40).optional().describe("Nama CRM Anda, mis. konektor, hubspot."),
  external_ref: z.string().trim().min(1).max(120).optional().describe("ID kontak di CRM Anda. Dipakai untuk upsert idempoten."),
};

/** POST /v1/integrations/contacts — upsert: dicocokkan berurutan via (external_source, external_ref), email, lalu telepon. */
export const contactUpsertSchema = z
  .object({
    ...contactFields,
    stage: z.enum(["new", "contacted"]).optional().describe("Fase awal untuk kontak baru (default new). Fase selanjutnya lewat /stage atau otomatis."),
  })
  .refine((v) => v.email || v.phone, { message: "Isi setidaknya email atau nomor telepon.", path: ["email"] })
  .refine((v) => !v.external_ref || v.external_source, { message: "external_source wajib diisi bila external_ref diisi.", path: ["external_source"] });

export const contactUpdateSchema = z
  .object({ ...contactFields, email: emailSchema.nullable().optional(), phone: phoneSchema.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada data yang diubah.", path: ["name"] });

export const contactStageChangeSchema = z
  .object({
    stage: leadStageSchema,
    reason: z.string().trim().max(500).optional(),
    lost_reason: z.string().trim().min(2).max(500).optional(),
  })
  .refine((v) => v.stage !== "lost" || v.lost_reason, { message: "Isi lost_reason saat menandai lead tidak lanjut.", path: ["lost_reason"] });

export const contactListQuerySchema = z.object({
  stage: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(leadStageSchema).optional())
    .describe("Satu atau beberapa fase dipisah koma, mis. new,contacted."),
  source: contactSourceSchema.optional(),
  owner_staff_id: z.uuid().optional(),
  tag: z.string().trim().max(40).optional(),
  q: z.string().trim().min(2).max(120).optional().describe("Cari nama, email, atau telepon."),
  updated_since: z.iso.datetime({ offset: true }).optional().describe("Untuk sinkron inkremental: hanya yang berubah sejak waktu ini."),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const contactViewSchema = z.object({
  id: z.string(),
  clinic_id: z.string().describe("Klinik pemilik kontak (sama dengan klinik kredensial)."),
  patient_id: z.string().nullable().describe("Terisi bila kontak sudah punya akun pasien di klinik."),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string(),
  source_detail: z.string().nullable(),
  utm: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
  owner_staff_id: z.string().nullable(),
  value_idr: z.number().nullable(),
  external_source: z.string().nullable(),
  external_ref: z.string().nullable(),
  stage: leadStageSchema,
  stage_label: z.string(),
  sales_phase: z.enum(SALES_PHASES),
  stage_changed_at: z.string(),
  lost_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ContactView = z.infer<typeof contactViewSchema>;

export const contactUpsertResponseSchema = z.object({ created: z.boolean(), contact: contactViewSchema });
export const contactListSchema = z.object({ contacts: z.array(contactViewSchema), next_cursor: z.string().nullable() });

export const contactStageHistorySchema = z.object({
  history: z.array(
    z.object({
      id: z.string(),
      from_stage: leadStageSchema.nullable(),
      to_stage: leadStageSchema,
      mode: z.enum(["auto", "manual"]),
      trigger: z.string().nullable().describe("Kejadian pemicu (auto) atau penanda kredensial (manual)."),
      reason: z.string().nullable(),
      at: z.string(),
    }),
  ),
});

export const leadStageCatalogSchema = z.object({
  stages: z.array(
    z.object({
      stage: leadStageSchema,
      rank: z.number(),
      label: z.string(),
      sales_phase: z.enum(SALES_PHASES),
      auto_trigger: z.string().nullable(),
      description: z.string(),
    }),
  ),
});

export const funnelQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional().describe("Kohort: kontak yang dibuat sejak waktu ini."),
  to: z.iso.datetime({ offset: true }).optional(),
});
export const funnelSchema = z.object({
  total: z.number(),
  lost: z.number(),
  stages: z.array(
    z.object({
      stage: leadStageSchema,
      label: z.string(),
      sales_phase: z.enum(SALES_PHASES),
      current: z.number().describe("Kontak yang saat ini berada di fase ini."),
      reached: z.number().describe("Kontak yang pernah mencapai fase ini atau lebih jauh."),
      conversion_pct: z.number().nullable().describe("reached fase ini ÷ reached fase sebelumnya × 100."),
    }),
  ),
});
