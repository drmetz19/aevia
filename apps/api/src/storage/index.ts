import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface SignedUrlInput {
  key: string;
  photoId: string;
  clinicId: string;
  ttlSeconds: number;
  now: Date;
}

/** Penyimpanan berkas. Akses HANYA lewat URL bertanda tangan berumur pendek. */
export interface StorageProvider {
  driver: "local" | "supabase";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Dibaca API untuk melayani berkas (foto lewat URL bertanda tangan; aset merek lewat endpoint publik). */
  read?(key: string): Promise<Uint8Array | null>;
  signedUrl(input: SignedUrlInput): Promise<string>;
}

export const defaultUploadsDir = () => process.env.UPLOADS_DIR ?? fileURLToPath(new URL("../../../../.data/uploads", import.meta.url));

export function signFileToken(secret: Uint8Array, photoId: string, clinicId: string, exp: number): string {
  return createHmac("sha256", secret).update(`${photoId}.${clinicId}.${exp}`).digest("base64url");
}

export function verifyFileToken(secret: Uint8Array, photoId: string, clinicId: string, exp: number, sig: string, now: Date): boolean {
  if (!Number.isFinite(exp) || exp * 1000 <= now.getTime()) return false;
  const a = Buffer.from(signFileToken(secret, photoId, clinicId, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createLocalStorage(opts: { dir?: string; secret: Uint8Array }): StorageProvider {
  const root = resolve(opts.dir ?? defaultUploadsDir());
  const path = (key: string) => {
    const full = resolve(join(root, key));
    if (!full.startsWith(root + sep)) throw new Error("Kunci berkas tidak valid.");
    return full;
  };
  return {
    driver: "local",
    async put(key, data) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async remove(key) {
      await rm(path(key), { force: true });
    },
    async read(key) {
      try {
        return await readFile(path(key));
      } catch {
        return null;
      }
    },
    async signedUrl({ photoId, clinicId, ttlSeconds, now }) {
      const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
      const sig = signFileToken(opts.secret, photoId, clinicId, exp);
      return `/v1/files/${photoId}?c=${clinicId}&e=${exp}&s=${sig}`;
    },
  };
}

/**
 * Driver Supabase Storage (bucket privat). Diimplementasikan terhadap @supabase/supabase-js; belum diuji langsung.
 * Catatan: URL bertanda tangan Supabase tidak melewati API, jadi pencabutan consent hanya berlaku untuk URL yang
 * diterbitkan sesudahnya; gunakan TTL pendek (default 5 menit).
 */
export function createSupabaseStorage(opts: { url: string; serviceKey: string; bucket: string }): StorageProvider {
  let client: Promise<import("@supabase/supabase-js").SupabaseClient> | undefined;
  const get = () =>
    (client ??= import("@supabase/supabase-js").then((m) => m.createClient(opts.url, opts.serviceKey, { auth: { persistSession: false } })));
  return {
    driver: "supabase",
    async put(key, data, contentType) {
      const { error } = await (await get()).storage.from(opts.bucket).upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`Unggah ke Supabase gagal: ${error.message}`);
    },
    async remove(key) {
      await (await get()).storage.from(opts.bucket).remove([key]);
    },
    async read(key) {
      const { data, error } = await (await get()).storage.from(opts.bucket).download(key);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async signedUrl({ key, ttlSeconds }) {
      const { data, error } = await (await get()).storage.from(opts.bucket).createSignedUrl(key, ttlSeconds);
      if (error || !data) throw new Error(`URL bertanda tangan gagal: ${error?.message ?? "tidak diketahui"}`);
      return data.signedUrl;
    },
  };
}

export function storageFromEnv(secret: Uint8Array): StorageProvider {
  if (process.env.STORAGE_DRIVER === "supabase") {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("STORAGE_DRIVER=supabase membutuhkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.");
    return createSupabaseStorage({ url: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY, bucket: SUPABASE_BUCKET ?? "skin-photos" });
  }
  return createLocalStorage({ secret });
}
