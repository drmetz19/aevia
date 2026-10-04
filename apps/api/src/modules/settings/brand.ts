import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  AEVIA_DEFAULT_COLORS,
  MAX_BRAND_ASSET_BYTES,
  sniffImage,
  validateBrand,
  type BrandSettings,
  type PhotoMime,
} from "@aevia/core";
import { clinics, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import type { StorageProvider } from "../../storage";

export interface SettingsCtx {
  db: Db;
  storage: StorageProvider;
  clinicId: string;
  actorId: string;
  now: Date;
  llmAvailable: boolean;
}

const EXT: Record<PhotoMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
type Clinic = typeof clinics.$inferSelect;

export const assetPath = (slug: string, kind: "logo" | "avatar", version: Date) => `/v1/clinics/${slug}/assets/${kind}?v=${version.getTime()}`;

const notFound = () => new AuthError(404, "clinic_not_found", "Klinik ini belum ditemukan.");

async function load(db: Db, clinicId: string): Promise<Clinic> {
  const [c] = await db.db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (!c) throw notFound();
  return c;
}

/** Penulisan ke `clinics` memakai koneksi pemilik (tabel ini tanpa RLS), selalu dibatasi `id = klinik principal`, dan diaudit. */
async function mutate(
  c: SettingsCtx,
  action: string,
  fn: (tx: Tx, before: Clinic) => Promise<{ set: Partial<typeof clinics.$inferInsert>; before: unknown; after: unknown }>,
): Promise<Clinic> {
  return c.db.db.transaction(async (tx) => {
    const [before] = await tx.select().from(clinics).where(eq(clinics.id, c.clinicId));
    if (!before) throw notFound();
    const r = await fn(tx, before);
    const [row] = await tx.update(clinics).set(r.set).where(eq(clinics.id, c.clinicId)).returning();
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "clinic", entityId: c.clinicId, action, before: r.before, after: r.after, at: c.now });
    return row!;
  });
}

export function brandView(cl: Clinic, llmAvailable: boolean): BrandSettings {
  const colors = { ...AEVIA_DEFAULT_COLORS, ...(cl.colors as Record<string, string>) };
  return {
    slug: cl.slug,
    name: cl.name,
    brand_mode: cl.brandMode,
    logo_url: cl.logoUrl,
    colors: { primary: colors.primary, accent: colors.accent, background: colors.background, surface: colors.surface },
    font: cl.font,
    custom_domain: cl.customDomain,
    domain_verified: cl.customDomainVerified,
    llm_enabled: cl.llmEnabled,
    llm_available: llmAvailable,
    assistant: {
      name: cl.assistantName,
      avatar_url: cl.avatarUrl,
      status: cl.assistantNameStatus,
      pending_name: cl.pendingAssistantName,
      has_pending_avatar: Boolean(cl.pendingAvatarKey),
      review_note: cl.assistantReviewNote,
    },
  };
}

export async function getBrand(c: SettingsCtx) {
  return brandView(await load(c.db, c.clinicId), c.llmAvailable);
}

export async function updateBrand(
  c: SettingsCtx,
  body: { brand_mode: "cobrand" | "whitelabel"; colors: { primary: string; accent: string; background: string; surface: string }; font: string | null; custom_domain: string | null },
) {
  const v = validateBrand(body.colors);
  if (!v.ok) {
    throw new AuthError(400, "brand_contrast", v.problems.join(" "), { problems: v.problems, checks: v.checks });
  }
  if (body.custom_domain) {
    const [dupe] = await c.db.db.select({ id: clinics.id }).from(clinics).where(eq(clinics.customDomain, body.custom_domain));
    if (dupe && dupe.id !== c.clinicId) throw new AuthError(409, "domain_taken", "Domain ini sudah dipakai klinik lain.");
  }
  const row = await mutate(c, "brand.update", async (_tx, b) => {
    const domainChanged = (b.customDomain ?? null) !== body.custom_domain;
    return {
      set: {
        brandMode: body.brand_mode,
        colors: { ...v.colors! },
        font: body.font,
        customDomain: body.custom_domain,
        ...(domainChanged ? { customDomainVerified: false } : {}),
      },
      before: { brand_mode: b.brandMode, colors: b.colors, font: b.font, custom_domain: b.customDomain, domain_verified: b.customDomainVerified },
      after: { brand_mode: body.brand_mode, colors: v.colors, font: body.font, custom_domain: body.custom_domain, ...(domainChanged ? { domain_verified: false } : {}) },
    };
  });
  return brandView(row, c.llmAvailable);
}

function checkAsset(data: Buffer, allowed: PhotoMime[]): PhotoMime {
  if (!data.length) throw new AuthError(400, "empty_file", "Berkas kosong. Silakan pilih gambar lain.");
  if (data.length > MAX_BRAND_ASSET_BYTES) throw new AuthError(413, "file_too_large", "Ukuran gambar melebihi 1 MB. Silakan pilih gambar yang lebih kecil.");
  const mime = sniffImage(data);
  if (!mime || !allowed.includes(mime)) {
    throw new AuthError(415, "unsupported_type", `Format gambar belum didukung. Gunakan ${allowed.map((m) => EXT[m].toUpperCase()).join(" atau ")}.`);
  }
  return mime;
}

/** Logo: hanya PNG atau WebP. SVG sengaja tidak diterima (dapat memuat skrip). */
export async function uploadLogo(c: SettingsCtx, data: Buffer) {
  const mime = checkAsset(data, ["image/png", "image/webp"]);
  const key = `${c.clinicId}/brand/logo-${randomUUID()}.${EXT[mime]}`;
  await c.storage.put(key, data, mime);
  let oldKey: string | null = null;
  try {
    const row = await mutate(c, "brand.logo", async (_tx, b) => {
      oldKey = b.logoKey;
      return { set: { logoKey: key, logoUrl: assetPath(b.slug, "logo", c.now) }, before: { logo_key: b.logoKey }, after: { logo_key: key, content_type: mime, bytes: data.length } };
    });
    if (oldKey) await c.storage.remove(oldKey);
    return brandView(row, c.llmAvailable);
  } catch (e) {
    await c.storage.remove(key);
    throw e;
  }
}

export async function removeLogo(c: SettingsCtx) {
  let oldKey: string | null = null;
  const row = await mutate(c, "brand.logo_remove", async (_tx, b) => {
    oldKey = b.logoKey;
    return { set: { logoKey: null, logoUrl: null }, before: { logo_key: b.logoKey }, after: { logo_key: null } };
  });
  if (oldKey) await c.storage.remove(oldKey);
  return brandView(row, c.llmAvailable);
}

/** Usulan nama asisten: menunggu persetujuan admin AEVIA; yang tampil di web tetap nama yang sudah disetujui. */
export async function proposeAssistantName(c: SettingsCtx, name: string) {
  const row = await mutate(c, "assistant.propose", async (_tx, b) => ({
    set: { pendingAssistantName: name, assistantNameStatus: "pending", assistantReviewNote: null, assistantSubmittedAt: c.now },
    before: { name: b.assistantName, status: b.assistantNameStatus, pending_name: b.pendingAssistantName },
    after: { pending_name: name, status: "pending" },
  }));
  return brandView(row, c.llmAvailable);
}

export async function proposeAssistantAvatar(c: SettingsCtx, data: Buffer) {
  const mime = checkAsset(data, ["image/png", "image/webp", "image/jpeg"]);
  const key = `${c.clinicId}/brand/avatar-pending-${randomUUID()}.${EXT[mime]}`;
  await c.storage.put(key, data, mime);
  let oldKey: string | null = null;
  try {
    const row = await mutate(c, "assistant.avatar_propose", async (_tx, b) => {
      oldKey = b.pendingAvatarKey;
      return {
        set: { pendingAvatarKey: key, assistantNameStatus: "pending", assistantReviewNote: null, assistantSubmittedAt: c.now, pendingAssistantName: b.pendingAssistantName ?? b.assistantName },
        before: { pending_avatar_key: b.pendingAvatarKey, status: b.assistantNameStatus },
        after: { pending_avatar_key: key, content_type: mime, bytes: data.length, status: "pending" },
      };
    });
    if (oldKey) await c.storage.remove(oldKey);
    return brandView(row, c.llmAvailable);
  } catch (e) {
    await c.storage.remove(key);
    throw e;
  }
}

export async function setLlm(c: SettingsCtx, enabled: boolean) {
  if (enabled && !c.llmAvailable) {
    throw new AuthError(409, "llm_unavailable", "Mode LLM belum dapat dinyalakan karena platform belum memiliki kunci layanan. Hubungi admin platform.");
  }
  const row = await mutate(c, "llm.toggle", async (_tx, b) => ({ set: { llmEnabled: enabled }, before: { llm_enabled: b.llmEnabled }, after: { llm_enabled: enabled } }));
  return brandView(row, c.llmAvailable);
}

export async function pendingAvatarBytes(c: { db: Db; storage: StorageProvider }, clinicId: string) {
  const cl = await load(c.db, clinicId);
  if (!cl.pendingAvatarKey) throw new AuthError(404, "no_pending_avatar", "Belum ada avatar yang menunggu persetujuan.");
  const data = await c.storage.read?.(cl.pendingAvatarKey);
  if (!data) throw new AuthError(404, "no_pending_avatar", "Belum ada avatar yang menunggu persetujuan.");
  return { data: Buffer.from(data), contentType: sniffImage(data) ?? "application/octet-stream" };
}

/** Aset merek publik (logo, avatar yang sudah disetujui). */
export async function publicAsset(db: Db, storage: StorageProvider, slug: string, kind: "logo" | "avatar") {
  const [cl] = await db.db.select().from(clinics).where(eq(clinics.slug, slug));
  const key = kind === "logo" ? cl?.logoKey : cl?.avatarKey;
  if (!key) return null;
  const data = await storage.read?.(key);
  if (!data) return null;
  const mime = sniffImage(data);
  return mime ? { data: Buffer.from(data), contentType: mime } : null;
}
