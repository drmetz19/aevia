import { findClinicBySlug, type Db } from "@aevia/db";
import type { PublicClinic } from "@aevia/core";

/** Lookup brand publik (belum ada konteks tenant → koneksi pemilik, hanya field publik). */
export async function getPublicClinic(db: Db, slug: string): Promise<PublicClinic | null> {
  const c = await findClinicBySlug(db, slug);
  if (!c) return null;
  return {
    slug: c.slug,
    name: c.name,
    tagline: c.tagline,
    brand_mode: c.brandMode,
    logo_url: c.logoUrl,
    colors: c.colors,
    font: c.font,
    assistant_name: c.assistantName,
    avatar_url: c.avatarUrl,
  };
}
