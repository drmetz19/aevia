import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@aevia/core";

export interface Principal {
  sub: string;
  clinic_id: string | null;
  role: Role;
}

export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function resolveSecret(secret?: string): Uint8Array {
  const s = secret ?? process.env.JWT_SECRET;
  if (!s || s.startsWith("ganti-dengan")) {
    if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET wajib diisi di produksi.");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-0123456789");
  }
  if (s.length < 32 && process.env.NODE_ENV === "production") throw new Error("JWT_SECRET minimal 32 karakter.");
  return new TextEncoder().encode(s);
}

export async function signToken(secret: Uint8Array, p: Principal, now = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ clinic_id: p.clinic_id, role: p.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SECONDS)
    .sign(secret);
}

export async function verifyToken(secret: Uint8Array, token: string, now = new Date()): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], currentDate: now });
    if (!payload.sub) return null;
    return { sub: payload.sub, clinic_id: (payload.clinic_id as string | null) ?? null, role: payload.role as Role };
  } catch {
    return null;
  }
}
