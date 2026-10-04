import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { API_AUDIENCE, OAUTH_TOKEN_TTL_SECONDS, SCOPES, type Scope } from "@aevia/core";
import { apiKeys, oauthClients, writeAudit, type Db } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { looksLikeApiKey, sha256 } from "./secrets";
import type { TokenBucketLimiter } from "./rate-limit";

export interface Integration {
  clinicId: string;
  kind: "api_key" | "oauth";
  /** id baris api_keys / oauth_clients — dipakai sebagai actor_id audit */
  id: string;
  /** "mcp" bila klien mengirim X-Aevia-Actor: mcp (server MCP); selain itu "api". Hanya label audit, bukan hak akses. */
  actor: "api" | "mcp";
  /** mis. api:aev_live_AbCd1234 atau mcp:aev_live_AbCd1234 — dicatat di setiap audit */
  label: string;
  scopes: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    integration?: Integration;
  }
}

export interface IntegrationAuthDeps {
  db: Db;
  secret: Uint8Array;
  now: () => Date;
  limiter: TokenBucketLimiter;
}

const INVALID = "Kredensial tidak valid atau sudah dicabut. Periksa kembali kunci API atau token Anda.";

export async function issueAccessToken(secret: Uint8Array, c: { id: string; clinicId: string; scopes: string[]; clientId: string }, now: Date) {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ clinic_id: c.clinicId, scope: c.scopes.join(" "), token_use: "api", client_id: c.clientId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.id)
    .setAudience(API_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + OAUTH_TOKEN_TTL_SECONDS)
    .sign(secret);
}

async function resolve(d: IntegrationAuthDeps, token: string, actor: "api" | "mcp"): Promise<Integration | null> {
  const now = d.now();
  if (looksLikeApiKey(token)) {
    const [k] = await d.db.db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, sha256(token)), isNull(apiKeys.revokedAt)));
    if (!k) return null;
    await d.db.db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, k.id));
    return { clinicId: k.clinicId, kind: "api_key", id: k.id, actor, label: `${actor}:${k.prefix}`, scopes: k.scopes };
  }
  try {
    const { payload } = await jwtVerify(token, d.secret, { algorithms: ["HS256"], audience: API_AUDIENCE, currentDate: now });
    if (payload.token_use !== "api" || !payload.sub) return null;
    const [c] = await d.db.db.select().from(oauthClients).where(and(eq(oauthClients.id, payload.sub), isNull(oauthClients.revokedAt)));
    if (!c) return null;
    const claimed = String(payload.scope ?? "").split(" ").filter(Boolean);
    return { clinicId: c.clinicId, kind: "oauth", id: c.id, actor, label: `${actor}:oauth:${c.clientId}`, scopes: claimed.filter((s) => c.scopes.includes(s)) };
  } catch {
    return null;
  }
}

/** preHandler integrasi: kunci API atau token OAuth → tenant dari kredensial; cakupan wajib per route; rate limit per kredensial. */
export function requireScope(d: IntegrationAuthDeps, ...needed: Scope[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7).trim() : "";
    const who = token ? await resolve(d, token, req.headers["x-aevia-actor"] === "mcp" ? "mcp" : "api") : null;
    if (!who) throw new AuthError(401, "invalid_credentials", INVALID);
    const rl = d.limiter.take(who.id, d.now().getTime());
    if (!rl.ok) {
      reply.header("Retry-After", String(rl.retryAfterSeconds));
      throw new AuthError(429, "rate_limited", `Terlalu banyak permintaan. Coba lagi dalam ${rl.retryAfterSeconds} detik.`);
    }
    const missing = needed.filter((s) => !who.scopes.includes(s));
    if (missing.length) {
      await d.db.ownerTx(who.clinicId, (tx) =>
        writeAudit(tx, {
          clinicId: who.clinicId,
          actorType: who.actor,
          actorId: who.id,
          entity: who.kind === "api_key" ? "api_key" : "oauth_client",
          entityId: who.id,
          action: "integration.denied",
          before: null,
          after: { via: who.label, method: req.method, route: req.routeOptions?.url ?? req.url, missing_scopes: missing },
          at: d.now(),
        }),
      );
      throw new AuthError(403, "insufficient_scope", `Kredensial ini belum memiliki cakupan akses yang dibutuhkan: ${missing.join(", ")}.`);
    }
    req.integration = who;
  };
}

export const ALL_SCOPES: readonly string[] = SCOPES;
