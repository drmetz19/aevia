import { z } from "zod";
import { programSchema } from "./consultation";
import { brandModeSchema } from "./clinic";
import { normalizeHex } from "./color";

/** Hanya font yang dihosting sendiri (@fontsource). */
export const FONT_ALLOWLIST = ["Manrope", "Inter", "DM Sans", "Plus Jakarta Sans", "Lora", "DM Serif Display"] as const;
export type FontName = (typeof FONT_ALLOWLIST)[number];
export const fontSchema = z.enum(FONT_ALLOWLIST, { error: "Font belum termasuk daftar yang tersedia." });
export const fontStack = (f: string | null | undefined) =>
  f && (FONT_ALLOWLIST as readonly string[]).includes(f) ? `"${f}", system-ui, sans-serif` : null;

const hex = z.string().transform((v, ctx) => {
  const n = normalizeHex(v);
  if (!n) ctx.addIssue({ code: "custom", message: "Kode warna belum sesuai. Gunakan format seperti #0B1F3A." });
  return n ?? v;
});

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Domain belum sesuai. Tulis nama domain saja, contoh klinik.contoh.id.");

export const brandUpdateSchema = z.object({
  brand_mode: brandModeSchema,
  colors: z.object({ primary: hex, accent: hex, background: hex, surface: hex }),
  font: fontSchema.nullable(),
  custom_domain: hostnameSchema.nullable(),
});

export const assistantStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const brandSettingsSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand_mode: brandModeSchema,
  logo_url: z.string().nullable(),
  colors: z.object({ primary: z.string(), accent: z.string(), background: z.string(), surface: z.string() }),
  font: z.string().nullable(),
  custom_domain: z.string().nullable(),
  domain_verified: z.boolean(),
  llm_enabled: z.boolean(),
  llm_available: z.boolean(),
  assistant: z.object({
    name: z.string(),
    avatar_url: z.string().nullable(),
    status: assistantStatusSchema,
    pending_name: z.string().nullable(),
    has_pending_avatar: z.boolean(),
    review_note: z.string().nullable(),
  }),
});
export type BrandSettings = z.infer<typeof brandSettingsSchema>;

export const assistantNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama asisten minimal 2 karakter.")
    .max(30, "Nama asisten maksimal 30 karakter.")
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u, "Nama asisten hanya boleh berisi huruf, angka, spasi, apostrof, atau tanda hubung."),
});
export const llmUsageSchema = z.object({ calls_30d: z.number(), fallbacks_30d: z.number(), input_tokens_30d: z.number(), output_tokens_30d: z.number() });
export const llmBodySchema = z.object({ enabled: z.boolean() });

export const MAX_BRAND_ASSET_BYTES = 1024 * 1024;

export const staffProgramSchema = programSchema.extend({ active: z.boolean() });
export type StaffProgram = z.infer<typeof staffProgramSchema>;
export const staffProgramListSchema = z.object({ programs: z.array(staffProgramSchema) });
export const programInputSchema = z.object({
  name: z.string().trim().min(3, "Nama program minimal 3 karakter.").max(80),
  summary: z.string().trim().max(400).default(""),
  duration_weeks: z.number().int().min(1, "Durasi minimal 1 minggu.").max(104).nullable(),
  price_idr: z.number().int().min(0, "Harga tidak boleh negatif.").max(1_000_000_000).nullable(),
  includes: z.array(z.string().trim().min(1).max(120)).max(10),
  active: z.boolean().default(true),
});

export const teamRoleSchema = z.enum(["professional", "clinic_admin"]);
export const teamMemberSchema = z.object({ id: z.string(), email: z.string(), name: z.string(), role: teamRoleSchema, active: z.boolean() });
export const teamListSchema = z.object({ members: z.array(teamMemberSchema) });
export const inviteBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "Alamat email belum sesuai. Periksa kembali ya." })),
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80),
  role: teamRoleSchema,
});
export const activeBodySchema = z.object({ active: z.boolean() });

export const RESERVED_SLUGS = ["admin", "api", "c", "console", "www", "app", "static", "_next", "health", "v1", "syarat", "masuk"];
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Alamat klinik 3–40 karakter: huruf kecil, angka, dan tanda hubung.")
  .refine((s) => !RESERVED_SLUGS.includes(s), "Alamat klinik ini dicadangkan. Pilih yang lain.");
export const adminClinicSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand_mode: brandModeSchema,
  custom_domain: z.string().nullable(),
  domain_verified: z.boolean(),
  assistant_status: assistantStatusSchema,
  created_at: z.string(),
});
export const adminClinicListSchema = z.object({ clinics: z.array(adminClinicSchema) });
export const createClinicSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(2, "Nama klinik minimal 2 karakter.").max(80),
  brand_mode: brandModeSchema,
  admin_email: z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "Alamat email belum sesuai. Periksa kembali ya." })),
  admin_name: z.string().trim().min(2).max(80).optional(),
});
export const domainVerifyBodySchema = z.object({ verified: z.boolean() });
export const assistantQueueSchema = z.object({
  items: z.array(
    z.object({
      clinic_id: z.string(),
      slug: z.string(),
      clinic_name: z.string(),
      current_name: z.string(),
      pending_name: z.string().nullable(),
      has_pending_avatar: z.boolean(),
      submitted_at: z.string().nullable(),
    }),
  ),
});
export const assistantReviewSchema = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).default("") })
  .refine((v) => v.decision === "approve" || v.note.length >= 3, { message: "Tuliskan alasan singkat saat menolak.", path: ["note"] });
export const resolveDomainSchema = z.object({ slug: z.string() });
