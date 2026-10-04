import { z } from "zod";

export const SCOPES = [
  "read:patients",
  "read:progress",
  "read:plans",
  "write:reminders",
  "write:consultation_requests",
  "integrations:write",
  "webhooks:manage",
] as const;
export type Scope = (typeof SCOPES)[number];
export const scopeSchema = z.enum(SCOPES, { error: "Cakupan akses belum dikenal." });

export const SCOPE_LABELS: Record<Scope, string> = {
  "read:patients": "Membaca ringkasan pasien",
  "read:progress": "Membaca check-in dan progres",
  "read:plans": "Membaca rencana pendampingan yang sudah ditandatangani",
  "write:reminders": "Membuat pengingat check-in atau tinjauan",
  "write:consultation_requests": "Membuat permintaan konsultasi",
  "integrations:write": "Dicadangkan: mengelola integrasi lain melalui API",
  "webhooks:manage": "Mengelola endpoint webhook melalui API",
};

export const WEBHOOK_EVENTS = [
  "assessment.completed",
  "consultation.requested",
  "consultation.accepted",
  "plan.approved",
  "checkin.submitted",
  "progress.updated",
] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS, { error: "Jenis kejadian belum dikenal." });

export const API_KEY_PREFIX = { live: "aev_live_", test: "aev_test_" } as const;
export const OAUTH_TOKEN_TTL_SECONDS = 15 * 60;
export const API_AUDIENCE = "aevia-api";

const scopes = z.array(scopeSchema).min(1, "Pilih setidaknya satu cakupan akses.").max(SCOPES.length);
const name = z.string().trim().min(2, "Nama minimal 2 karakter.").max(60, "Nama maksimal 60 karakter.");

export const createApiKeySchema = z.object({ name, mode: z.enum(["live", "test"]).default("live"), scopes });
export const createOauthClientSchema = z.object({ name, scopes });

export const apiKeyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(["live", "test"]),
  prefix: z.string(),
  scopes: z.array(z.string()),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export const apiKeyCreatedSchema = apiKeyViewSchema.extend({ secret: z.string().describe("Ditampilkan sekali saja.") });
export const oauthClientViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  client_id: z.string(),
  scopes: z.array(z.string()),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export const oauthClientCreatedSchema = oauthClientViewSchema.extend({ client_secret: z.string().describe("Ditampilkan sekali saja.") });

/** Tolak HTTP, kredensial di URL, dan host internal (SSRF dasar). */
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Alamat webhook belum sesuai. Tulis alamat lengkap, contoh https://contoh.id/webhook.";
  }
  if (u.protocol !== "https:") return "Alamat webhook harus memakai https.";
  if (u.username || u.password) return "Alamat webhook tidak boleh memuat nama pengguna atau kata sandi.";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const internal =
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    !h.includes(".") && !h.includes(":") ||
    /^(127|10|0)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "::1" ||
    h.startsWith("fc") && h.includes(":") ||
    h.startsWith("fd") && h.includes(":") ||
    h.startsWith("fe80:") ||
    /^\d+$/.test(h);
  if (internal) return "Alamat webhook harus dapat dijangkau dari internet (bukan alamat internal).";
  return null;
}
const urlSchema = z.string().trim().max(500).superRefine((v, ctx) => {
  const m = validateWebhookUrl(v);
  if (m) ctx.addIssue({ code: "custom", message: m });
});
const eventsSchema = z.array(z.union([webhookEventSchema, z.literal("*")])).min(1, "Pilih setidaknya satu jenis kejadian.");
export const webhookInputSchema = z.object({ url: urlSchema, events: eventsSchema });
export const webhookUpdateSchema = z.object({ url: urlSchema.optional(), events: eventsSchema.optional(), active: z.boolean().optional() });
export const webhookViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  created_at: z.string(),
});
export const webhookCreatedSchema = webhookViewSchema.extend({ secret: z.string().describe("Ditampilkan sekali saja.") });
export const deliveryViewSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  event_type: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number(),
  last_status_code: z.number().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: z.string().nullable(),
  created_at: z.string(),
});
export const integrationOverviewSchema = z.object({
  api_keys: z.array(apiKeyViewSchema),
  oauth_clients: z.array(oauthClientViewSchema),
  webhooks: z.array(webhookViewSchema),
  events: z.array(z.string()),
});

export const oauthTokenBodySchema = z.object({
  grant_type: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  scope: z.string().optional(),
});
export const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
  scope: z.string(),
});

// --- Respons route integrasi (minim PII: tanpa email/nama pasien) ---
export const integrationPatientSummarySchema = z.object({
  patient: z.object({ id: z.string(), created_at: z.string() }),
  consents: z.array(z.object({ scope: z.string(), granted: z.boolean() })),
  consultation_requests: z.object({ submitted: z.number(), accepted: z.number(), declined: z.number() }),
  clinical_visible: z.boolean(),
  hidden_reason: z.string().nullable(),
  clinical: z
    .object({
      last_assessment_completed_at: z.string().nullable(),
      signed_plan_version: z.number().nullable(),
      checkin_count: z.number(),
      last_checkin_at: z.string().nullable(),
    })
    .nullable(),
});
export const integrationCheckinsSchema = z.object({
  checkins: z.array(z.object({ id: z.string(), created_at: z.string(), values: z.record(z.string(), z.number()), mood: z.number().nullable() })),
});
export const integrationReminderBodySchema = z.object({
  patient_id: z.uuid(),
  kind: z.enum(["checkin", "review"]),
  due_at: z.iso.datetime().optional(),
});
export const integrationReminderSchema = z.object({ id: z.string(), patient_id: z.string(), kind: z.string(), due_at: z.string() });
export const integrationRequestBodySchema = z.object({
  patient_id: z.uuid(),
  program_id: z.uuid(),
  prep: z
    .object({
      tujuan: z.string().trim().max(600).default(""),
      keluhan: z.string().trim().max(1200).default(""),
      pertanyaan: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
      konteks_assessment: z.string().trim().max(1200).default(""),
    })
    .default({ tujuan: "", keluhan: "", pertanyaan: [], konteks_assessment: "" }),
});
export const integrationRequestSchema = z.object({ id: z.string(), patient_id: z.string(), program_id: z.string(), status: z.string(), created_at: z.string() });
export const integrationMeSchema = z.object({ clinic_id: z.string(), credential: z.enum(["api_key", "oauth"]), label: z.string(), scopes: z.array(z.string()) });
