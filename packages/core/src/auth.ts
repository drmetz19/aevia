import { z } from "zod";

export const roleSchema = z.enum(["patient", "professional", "clinic_admin", "aevia_admin"]);
export type Role = z.infer<typeof roleSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Alamat email belum sesuai. Periksa kembali ya." }));

export const requestOtpSchema = z.object({ email: emailSchema });
export const verifyOtpSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "Kode terdiri dari 6 angka."),
});

export const otpRequestedSchema = z.object({ message: z.string() });
export const sessionSchema = z.object({
  token: z.string(),
  expires_in: z.number(),
  role: roleSchema,
  clinic_slug: z.string().nullable(),
});

export const patientMeSchema = z.object({
  id: z.string(),
  email: z.string(),
  clinic_slug: z.string(),
  role: z.literal("patient"),
});
export const staffMeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  clinic_slug: z.string().nullable(),
});

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
