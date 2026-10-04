import { publicClinicSchema, type PublicClinic } from "@aevia/core";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function fetchClinic(slug: string): Promise<PublicClinic | null> {
  const res = await fetch(`${API_URL}/v1/clinics/${encodeURIComponent(slug)}/public`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API klinik gagal (${res.status})`);
  return publicClinicSchema.parse(await res.json());
}

/** Warna klinik hanya menimpa --brand-* untuk whitelabel; cobrand memakai token AEVIA. */
export function brandStyle(c: PublicClinic): Record<string, string> {
  if (c.brand_mode !== "whitelabel") return {};
  const m: Record<string, string | undefined> = {
    "--brand-primary": c.colors.primary,
    "--brand-accent": c.colors.accent,
    "--brand-dark": c.colors.dark,
    "--brand-bg": c.colors.background,
  };
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v)) as Record<string, string>;
}
