import { createHmac } from "node:crypto";

export const MAX_ATTEMPTS = 3;
/** Jeda sebelum percobaan ke-2 dan ke-3 (eksponensial: 1 menit, 5 menit). */
export const RETRY_DELAYS_MS = [60_000, 300_000] as const;

/** Skema tanda tangan yang sama untuk webhook dan konektor: t=<detik>,v1=hmac_sha256(secret, "<t>.<body>"). */
export function signBody(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
