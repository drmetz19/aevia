import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { API_KEY_PREFIX } from "@aevia/core";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

/** Banding waktu-konstan atas hash (panjang sama). */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
export const safeEqualText = (a: string, b: string) => safeEqualHex(sha256(a), sha256(b));

export function newApiKey(mode: "live" | "test") {
  const secret = `${API_KEY_PREFIX[mode]}${randomToken(24)}`;
  return { secret, prefix: secret.slice(0, API_KEY_PREFIX[mode].length + 8), hash: sha256(secret) };
}
export const looksLikeApiKey = (t: string) => t.startsWith(API_KEY_PREFIX.live) || t.startsWith(API_KEY_PREFIX.test);
export const newClient = () => ({ clientId: `aev_cid_${randomToken(12)}`, secret: `aev_cs_${randomToken(32)}` });
export const newWebhookSecret = () => `whsec_${randomToken(32)}`;
