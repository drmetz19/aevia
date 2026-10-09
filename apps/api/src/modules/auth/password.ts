import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Role } from "@aevia/core";
import { passwordTokens, staffCredentials } from "@aevia/db";
import { AuthError } from "./otp";
import { findStaffIdentity, type AuthCtx } from "./service";
import { signToken, TOKEN_TTL_SECONDS } from "./tokens";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** Parameter scrypt (OWASP: N=2^17, r=8, p=1). Disimpan di hash agar bisa dinaikkan nanti. */
const N = 131072;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
export const LINK_TTL = { set: 72 * 60, reset: 60 } as const; // menit
const LINK_REQUESTS_PER_HOUR = 3;

export const LOGIN_INVALID = "Email atau password belum sesuai.";
export const LINK_SENT = "Jika email Anda terdaftar sebagai staf, link untuk mengatur password akan segera kami kirim.";
const LINK_INVALID = "Link ini sudah tidak berlaku. Silakan minta link baru.";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const got = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Hash dummy agar waktu respons untuk email tak terdaftar mirip dengan email terdaftar. */
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

const tokenHash = (secret: Uint8Array, token: string) => createHmac("sha256", secret).update(`pwlink:${token}`).digest("hex");

async function session(ctx: AuthCtx, who: { id: string; clinicId: string | null; slug: string | null; role: Role }) {
  const token = await signToken(ctx.secret, { sub: who.id, clinic_id: who.clinicId, role: who.role }, ctx.now());
  return { token, expires_in: TOKEN_TTL_SECONDS, role: who.role, clinic_slug: who.slug };
}

export async function loginWithPassword(ctx: AuthCtx, email: string, password: string) {
  const now = ctx.now();
  const who = await findStaffIdentity(ctx.db, email);
  const [cred] = who ? await ctx.db.db.select().from(staffCredentials).where(eq(staffCredentials.email, email)) : [];
  if (!who || !cred) {
    await verifyPassword(password, await dummy());
    throw new AuthError(400, "login_invalid", LOGIN_INVALID);
  }
  if (cred.lockedUntil && cred.lockedUntil.getTime() > now.getTime()) {
    throw new AuthError(429, "login_locked", `Terlalu banyak percobaan. Coba lagi dalam ${LOCK_MINUTES} menit, atau atur ulang password lewat email.`);
  }
  if (!(await verifyPassword(password, cred.passwordHash))) {
    const failed = cred.failedAttempts + 1;
    const lock = failed >= MAX_FAILED;
    await ctx.db.db
      .update(staffCredentials)
      .set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
      .where(eq(staffCredentials.email, email));
    if (lock) throw new AuthError(429, "login_locked", `Terlalu banyak percobaan. Coba lagi dalam ${LOCK_MINUTES} menit, atau atur ulang password lewat email.`);
    throw new AuthError(400, "login_invalid", LOGIN_INVALID);
  }
  if (cred.failedAttempts > 0 || cred.lockedUntil) {
    await ctx.db.db.update(staffCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(staffCredentials.email, email));
  }
  return session(ctx, who);
}

/** Buat link sekali pakai lalu kirim lewat email. `purpose: set` untuk undangan (72 jam), `reset` untuk lupa password (60 menit). */
export async function issuePasswordLink(ctx: AuthCtx, email: string, purpose: "set" | "reset") {
  const now = ctx.now();
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const [recent] = await ctx.db.db
    .select({ n: sql<number>`count(*)::int` })
    .from(passwordTokens)
    .where(and(eq(passwordTokens.email, email), gt(passwordTokens.createdAt, hourAgo)));
  if ((recent?.n ?? 0) >= LINK_REQUESTS_PER_HOUR) {
    throw new AuthError(429, "link_rate_limited", "Link sudah beberapa kali diminta. Mohon tunggu sebentar sebelum meminta lagi.");
  }
  const token = randomBytes(32).toString("base64url");
  await ctx.db.db.insert(passwordTokens).values({
    email,
    purpose,
    tokenHash: tokenHash(ctx.secret, token),
    expiresAt: new Date(now.getTime() + LINK_TTL[purpose] * 60_000),
    createdAt: now,
  });
  const link = `${ctx.consoleUrl.replace(/\/+$/, "")}/atur-password?token=${token}`;
  await ctx.sender.send({ email, purpose: purpose === "set" ? "password_set" : "password_reset", link });
}

export async function requestPasswordLink(ctx: AuthCtx, email: string) {
  const who = await findStaffIdentity(ctx.db, email);
  if (who) {
    const [cred] = await ctx.db.db.select({ email: staffCredentials.email }).from(staffCredentials).where(eq(staffCredentials.email, email));
    await issuePasswordLink(ctx, email, cred ? "reset" : "set");
  }
  return { message: LINK_SENT };
}

export async function setPasswordWithToken(ctx: AuthCtx, token: string, password: string) {
  const now = ctx.now();
  const [row] = await ctx.db.db.select().from(passwordTokens).where(eq(passwordTokens.tokenHash, tokenHash(ctx.secret, token)));
  if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) throw new AuthError(400, "link_invalid", LINK_INVALID);
  const who = await findStaffIdentity(ctx.db, row.email);
  if (!who) throw new AuthError(400, "link_invalid", LINK_INVALID);
  if (password.trim().toLowerCase() === row.email.toLowerCase()) {
    throw new AuthError(400, "password_weak", "Password tidak boleh sama dengan email.");
  }
  const passwordHash = await hashPassword(password);
  await ctx.db.db.transaction(async (tx) => {
    // klaim token secara atomik: dua permintaan bersamaan tidak bisa memakai link yang sama
    const claimed = await tx
      .update(passwordTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordTokens.id, row.id), isNull(passwordTokens.usedAt)))
      .returning({ id: passwordTokens.id });
    if (claimed.length === 0) throw new AuthError(400, "link_invalid", LINK_INVALID);
    await tx.update(passwordTokens).set({ usedAt: now }).where(and(eq(passwordTokens.email, row.email), isNull(passwordTokens.usedAt)));
    await tx
      .insert(staffCredentials)
      .values({ email: row.email, passwordHash, updatedAt: now })
      .onConflictDoUpdate({ target: staffCredentials.email, set: { passwordHash, failedAttempts: 0, lockedUntil: null, updatedAt: now } });
  });
  return session(ctx, who);
}

/** Dipakai alur admin (klinik baru, undang staf): kirim link atur password tanpa menggagalkan alur utama. */
export async function sendInviteLinkSafely(ctx: AuthCtx, email: string): Promise<boolean> {
  try {
    await issuePasswordLink(ctx, email, "set");
    return true;
  } catch (e) {
    console.warn(`[password] undangan ke ${email.replace(/(^.).*(@.*$)/, "$1***$2")} gagal: ${(e as Error).message}`);
    return false;
  }
}

export function consoleUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONSOLE_URL) return env.CONSOLE_URL;
  return env.NODE_ENV === "production" ? "https://aevia-console.vercel.app" : "http://localhost:3001";
}

