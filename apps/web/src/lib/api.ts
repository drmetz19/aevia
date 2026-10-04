import { fontStack, publicClinicSchema, themeVars, type PublicClinic } from "@aevia/core";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function fetchClinic(slug: string): Promise<PublicClinic | null> {
  const res = await fetch(`${API_URL}/v1/clinics/${encodeURIComponent(slug)}/public`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API klinik gagal (${res.status})`);
  return publicClinicSchema.parse(await res.json());
}

/** Tema klinik hanya untuk whitelabel; cobrand memakai token AEVIA. Warna yang tak lolos kontras → token AEVIA. */
export function brandStyle(c: PublicClinic): Record<string, string> {
  if (c.brand_mode !== "whitelabel") return {};
  const out: Record<string, string> = { ...(themeVars(c.colors) ?? {}) };
  const stack = fontStack(c.font);
  if (stack) {
    out["--font-sans"] = stack;
    out.fontFamily = stack;
  }
  return out;
}
