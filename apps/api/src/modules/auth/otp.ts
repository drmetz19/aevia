import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from "@aevia/core";
import { otpCodes, type Db } from "@aevia/db";

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const REQUESTS_PER_WINDOW = 3;

export interface OtpScope {
  subjectType: "patient" | "staff";
  clinicId: string | null;
  email: string;
}

const hash = (secret: Uint8Array, s: OtpScope, code: string) =>
  createHmac("sha256", secret).update(`${s.subjectType}:${s.clinicId ?? "-"}:${s.email}:${code}`).digest("hex");

const scopeWhere = (s: OtpScope) =>
  and(
    eq(otpCodes.subjectType, s.subjectType),
    s.clinicId ? eq(otpCodes.clinicId, s.clinicId) : isNull(otpCodes.clinicId),
    eq(otpCodes.email, s.email),
  );

/** Buat OTP baru (membatalkan yang lama). Membatasi permintaan agar tebakan tidak bisa diulang tanpa batas. */
export async function issueOtp(db: Db, secret: Uint8Array, s: OtpScope, now: Date): Promise<string> {
  const windowStart = new Date(now.getTime() - OTP_TTL_MINUTES * 60_000);
  const recent = await db.db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(scopeWhere(s), gt(otpCodes.createdAt, windowStart)));
  if ((recent[0]?.n ?? 0) >= REQUESTS_PER_WINDOW) {
    throw new AuthError(
      429,
      "otp_rate_limited",
      "Permintaan kode sudah beberapa kali. Mohon tunggu beberapa menit sebelum meminta kode baru.",
    );
  }
  await db.db.update(otpCodes).set({ consumedAt: now }).where(and(scopeWhere(s), isNull(otpCodes.consumedAt)));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.db.insert(otpCodes).values({
    ...s,
    codeHash: hash(secret, s, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
    createdAt: now,
  });
  return code;
}

export async function checkOtp(db: Db, secret: Uint8Array, s: OtpScope, code: string, now: Date): Promise<void> {
  const [row] = await db.db
    .select()
    .from(otpCodes)
    .where(and(scopeWhere(s), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (!row) throw new AuthError(400, "otp_invalid", "Kode belum sesuai. Silakan minta kode baru.");
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AuthError(429, "otp_locked", "Terlalu banyak percobaan. Silakan minta kode baru untuk melanjutkan.");
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new AuthError(400, "otp_expired", "Kode sudah kedaluwarsa. Silakan minta kode baru.");
  }
  const a = Buffer.from(hash(secret, s, code));
  const b = Buffer.from(row.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.db.update(otpCodes).set({ attempts: row.attempts + 1 }).where(eq(otpCodes.id, row.id));
    const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
    throw new AuthError(
      left > 0 ? 400 : 429,
      left > 0 ? "otp_invalid" : "otp_locked",
      left > 0
        ? `Kode belum sesuai. Anda masih punya ${left} kesempatan.`
        : "Terlalu banyak percobaan. Silakan minta kode baru untuk melanjutkan.",
    );
  }
  await db.db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));
}
