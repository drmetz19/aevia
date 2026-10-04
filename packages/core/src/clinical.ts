import { z } from "zod";

export interface SkinParameter {
  key: string;
  label: string;
}

/** Set parameter default klinik (skor 0–100 diisi manual oleh profesional). Dapat diganti lewat clinic_settings.skin_parameters. */
export const DEFAULT_SKIN_PARAMETERS: SkinParameter[] = [
  { key: "melasma_hiperpigmentasi", label: "Melasma & hiperpigmentasi" },
  { key: "eritema_vaskular", label: "Eritema vaskular" },
  { key: "komedo_porfirin", label: "Komedo & porfirin" },
  { key: "tewl_dehidrasi", label: "TEWL & dehidrasi" },
  { key: "tekstur_pori", label: "Tekstur & pori" },
  { key: "skor_keseluruhan", label: "Skor kulit keseluruhan" },
];
export const skinParametersSchema = z.array(z.object({ key: z.string().min(1).max(64), label: z.string().min(1).max(80) })).min(1).max(12);

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type PhotoMime = keyof typeof PHOTO_TYPES;

/** Deteksi tipe dari magic bytes (jangan percaya header Content-Type / nama file). */
export function sniffImage(b: Uint8Array): PhotoMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  const ascii = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

export const angleSchema = z.enum(["front", "left", "right", "other"]);
export const severitySchema = z.enum(["low", "medium", "high"]);
export const SEVERITY_LABEL = { low: "Rendah", medium: "Sedang", high: "Tinggi" } as const;
export const SEVERITY_INITIAL = { low: "R", medium: "S", high: "T" } as const;

const unit = z.number().min(0).max(1);
export const annotationSchema = z
  .object({
    type: z.enum(["point", "area"]),
    x: unit,
    y: unit,
    w: unit.optional(),
    h: unit.optional(),
    label: z.string().trim().max(80),
    severity: severitySchema,
  })
  .refine((a) => a.type === "point" || (a.w !== undefined && a.h !== undefined && a.w > 0 && a.h > 0 && a.x + a.w <= 1.0001 && a.y + a.h <= 1.0001), {
    message: "Area harus punya lebar dan tinggi dan berada di dalam foto.",
  });
export type Annotation = z.infer<typeof annotationSchema>;
export const annotationsBodySchema = z.object({ annotations: z.array(annotationSchema).max(50) });

export const soapBodySchema = z.object({
  subjective: z.string().max(5000),
  objective: z.string().max(5000),
  assessment: z.string().max(5000),
  plan: z.string().max(5000),
});
export const soapSchema = soapBodySchema.extend({ updated_at: z.string().nullable(), updated_by: z.string().nullable() });
export type Soap = z.infer<typeof soapSchema>;

export const skinBodySchema = z.object({
  scores: z.record(z.string(), z.number().int().min(0, "Skor berada di antara 0 dan 100.").max(100, "Skor berada di antara 0 dan 100.")),
  notes: z.string().max(3000),
});
export const photoSchema = z.object({
  id: z.string(),
  angle: angleSchema,
  taken_at: z.string(),
  annotations: z.array(annotationSchema),
});
export const skinSchema = z.object({
  parameters: skinParametersSchema,
  scores: z.record(z.string(), z.number()),
  notes: z.string(),
  updated_at: z.string().nullable(),
  photos_consent: z.boolean(),
  photos: z.array(photoSchema),
});
export const photoUrlSchema = z.object({ url: z.string(), expires_in: z.number() });

export const consultationDetailSchema = z.object({
  id: z.string(),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled"]),
  scheduled_at: z.string(),
  meeting_url: z.string(),
  program_name: z.string(),
  patient: z.object({ id: z.string(), email: z.string() }),
  photos_consent: z.boolean(),
  assessment_visible: z.boolean(),
  soap: soapSchema,
});

export const auditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  actor_type: z.enum(["staff", "patient", "system", "api", "mcp"]),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  entity: z.string(),
  entity_id: z.string(),
  action: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export const auditListSchema = z.object({ entries: z.array(auditEntrySchema) });
