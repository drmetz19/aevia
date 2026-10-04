import { z } from "zod";

export const brandModeSchema = z.enum(["cobrand", "whitelabel"]);
export type BrandMode = z.infer<typeof brandModeSchema>;

export const brandColorsSchema = z
  .object({
    primary: z.string().optional(),
    accent: z.string().optional(),
    background: z.string().optional(),
    dark: z.string().optional(),
  })
  .partial();
export type BrandColors = z.infer<typeof brandColorsSchema>;

/** Field brand publik klinik — satu-satunya yang boleh keluar lewat endpoint publik. */
export const publicClinicSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  brand_mode: brandModeSchema,
  logo_url: z.string().nullable(),
  colors: brandColorsSchema,
  font: z.string().nullable(),
  assistant_name: z.string(),
  avatar_url: z.string().nullable(),
});
export type PublicClinic = z.infer<typeof publicClinicSchema>;

export const errorSchema = z.object({ error: z.string(), message: z.string() });
