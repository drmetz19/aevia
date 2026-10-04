import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, like, not } from "drizzle-orm";
import { clinics, webhookEndpoints, type Db } from "@aevia/db";

const PREFIX = "enc:v1:";

/** ENCRYPTION_KEY: 32 byte, ditulis sebagai 64 karakter hex atau base64. Tanpa kunci: dev memakai kunci tetap, produksi menolak. */
export function resolveEncryptionKey(raw = process.env.ENCRYPTION_KEY): Uint8Array {
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY wajib diisi di produksi (32 byte, hex atau base64).");
    return createHash("sha256").update("aevia-dev-only-encryption-key").digest();
  }
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY harus 32 byte (64 karakter hex atau base64 dari 32 byte).");
  return new Uint8Array(buf);
}

export const isEncrypted = (v: string) => v.startsWith(PREFIX);

/** AES-256-GCM, IV acak 12 byte per enkripsi. Format: enc:v1:<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string, key: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

/** Hanya dipanggil saat menandatangani. Nilai lama (belum terenkripsi) dikembalikan apa adanya sampai dimigrasikan. */
export function decryptSecret(stored: string, key: Uint8Array): string {
  if (!isEncrypted(stored)) return stored;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p ?? "", "base64url"));
  const d = createDecipheriv("aes-256-gcm", key, iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(ct!), d.final()]).toString("utf8");
}

/** Migrasi data idempoten: enkripsi rahasia webhook yang masih polos. Aman dijalankan tiap start. */
export async function reencryptWebhookSecrets(db: Db, key: Uint8Array): Promise<number> {
  let n = 0;
  for (const { id } of await db.db.select({ id: clinics.id }).from(clinics)) {
    n += await db.withTenant(id, async (tx) => {
      const rows = await tx.select({ id: webhookEndpoints.id, secret: webhookEndpoints.secret }).from(webhookEndpoints).where(not(like(webhookEndpoints.secret, `${PREFIX}%`)));
      for (const r of rows) await tx.update(webhookEndpoints).set({ secret: encryptSecret(r.secret, key) }).where(eq(webhookEndpoints.id, r.id));
      return rows.length;
    });
  }
  return n;
}
