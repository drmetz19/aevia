import { z } from "zod";

export const consentScopes = ["assessment", "medical_record", "photos", "external_context"] as const;
export const consentScopeSchema = z.enum(consentScopes);
export type ConsentScope = z.infer<typeof consentScopeSchema>;

export const consentStatusSchema = z.object({
  scope: consentScopeSchema,
  granted: z.boolean(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  decided: z.boolean(),
});
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
export const consentListSchema = z.object({ consents: z.array(consentStatusSchema) });
export const updateConsentSchema = z.object({ scope: consentScopeSchema, granted: z.boolean() });

export const consentCopy: Record<ConsentScope, { title: string; desc: string }> = {
  assessment: {
    title: "Hasil assessment",
    desc: "Profesional klinik dapat melihat jawaban dan gambaran hasil assessment Anda.",
  },
  medical_record: {
    title: "Rekam medis",
    desc: "Profesional klinik dapat melihat catatan konsultasi dan rencana Anda di klinik ini.",
  },
  photos: {
    title: "Foto kulit",
    desc: "Foto yang Anda unggah dapat dilihat profesional klinik untuk analisis kulit.",
  },
  external_context: {
    title: "Konteks dari aplikasi lain",
    desc: "Klinik dapat menerima ringkasan dari aplikasi yang Anda hubungkan, bila ada.",
  },
};
