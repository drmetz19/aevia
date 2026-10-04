import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  OAUTH_TOKEN_TTL_SECONDS,
  SCOPES,
  WEBHOOK_EVENTS,
  apiKeyCreatedSchema,
  apiKeyViewSchema,
  createApiKeySchema,
  createOauthClientSchema,
  deliveryViewSchema,
  integrationCheckinsSchema,
  integrationMeSchema,
  integrationOverviewSchema,
  integrationPatientSummarySchema,
  integrationReminderBodySchema,
  integrationReminderSchema,
  integrationRequestBodySchema,
  integrationRequestSchema,
  oauthClientCreatedSchema,
  oauthClientViewSchema,
  oauthTokenBodySchema,
  oauthTokenResponseSchema,
  patientPlanSchema,
  progressSchema,
  webhookCreatedSchema,
  webhookInputSchema,
  webhookUpdateSchema,
  webhookViewSchema,
} from "@aevia/core";
import { and, eq, isNull } from "drizzle-orm";
import { oauthClients, writeAudit } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { registerConnectorRoutes } from "../connectors/routes";
import { requireScope, issueAccessToken, type IntegrationAuthDeps } from "./auth";
import * as keys from "./keys";
import * as hooks from "./webhooks";
import * as data from "./data";
import { dispatchOnce, type DispatchDeps } from "./dispatcher";
import { safeEqualHex, safeEqualText, sha256 } from "./secrets";
import { TokenBucketLimiter, type RateLimitConfig } from "./rate-limit";

const idParam = z.object({ id: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });
const staffSec: Record<string, string[]>[] = [{ staffToken: [] }];
const apiSec: Record<string, string[]>[] = [{ apiKey: [] }, { oauth2: [] }];

export interface IntegrationDeps {
  ctx: AuthCtx;
  fetchFn?: typeof fetch;
  rateLimit?: RateLimitConfig;
  cronSecret?: string;
  encryptionKey: Uint8Array;
}

export const integrationRoutes: FastifyPluginAsyncZod<IntegrationDeps> = async (app, { ctx, fetchFn, rateLimit, cronSecret, encryptionKey }) => {
  const limiter = new TokenBucketLimiter(rateLimit);
  const ad: IntegrationAuthDeps = { db: ctx.db, secret: ctx.secret, now: ctx.now, limiter };
  const clinicAdmin = requireRole(ctx.secret, ctx.now, "clinic_admin");
  const sc = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({ db: ctx.db, clinicId: req.principal!.clinic_id!, actorId: req.principal!.sub, now: ctx.now() });
  const staffActor = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({ ...sc(req), actor: { type: "staff" as const, id: req.principal!.sub }, encryptionKey });
  const ic = (req: { integration?: import("./auth").Integration }) => ({ db: ctx.db, who: req.integration!, now: ctx.now() });
  const dd = (): DispatchDeps => ({ db: ctx.db, now: ctx.now, fetchFn, encryptionKey });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16_384 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // ---------- OAuth client-credentials ----------
  app.post(
    "/v1/oauth/token",
    {
      schema: {
        tags: ["OAuth"],
        summary: "Tukar client_id + client_secret dengan token akses (client_credentials). Terima form atau JSON.",
        body: oauthTokenBodySchema,
        response: { 200: oauthTokenResponseSchema },
      },
    },
    async (req, reply) => {
      const fail = (status: number, error: string, description: string) =>
        reply.code(status as 200).header("Cache-Control", "no-store").send({ error, error_description: description, message: description } as never);
      const b = req.body;
      if (b.grant_type !== "client_credentials") return fail(400, "unsupported_grant_type", "Hanya grant_type client_credentials yang didukung.");
      let clientId = b.client_id;
      let secret = b.client_secret;
      const basic = req.headers.authorization?.startsWith("Basic ") ? Buffer.from(req.headers.authorization.slice(6), "base64").toString("utf8") : null;
      if (basic && basic.includes(":")) {
        const i = basic.indexOf(":");
        clientId = decodeURIComponent(basic.slice(0, i));
        secret = decodeURIComponent(basic.slice(i + 1));
      }
      if (!clientId || !secret) return fail(401, "invalid_client", "client_id dan client_secret wajib diisi.");
      const [c] = await ctx.db.db.select().from(oauthClients).where(and(eq(oauthClients.clientId, clientId), isNull(oauthClients.revokedAt)));
      if (!c || !safeEqualHex(c.secretHash, sha256(secret))) return fail(401, "invalid_client", "Klien tidak dikenal atau rahasia tidak sesuai.");
      const asked = b.scope ? b.scope.split(/\s+/).filter(Boolean) : c.scopes;
      const bad = asked.filter((s) => !c.scopes.includes(s));
      if (bad.length || !asked.length) return fail(400, "invalid_scope", `Cakupan tidak diizinkan untuk klien ini: ${bad.join(", ") || "(kosong)"}.`);
      const now = ctx.now();
      const token = await issueAccessToken(ctx.secret, { id: c.id, clinicId: c.clinicId, scopes: asked, clientId: c.clientId }, now);
      await ctx.db.db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, c.id));
      await ctx.db.db.transaction((tx) =>
        writeAudit(tx, { clinicId: c.clinicId, actorType: "api", actorId: c.id, entity: "oauth_client", entityId: c.id, action: "oauth.token_issued", before: null, after: { via: `api:oauth:${c.clientId}`, scopes: asked }, at: now }),
      );
      return reply.header("Cache-Control", "no-store").send({ access_token: token, token_type: "Bearer" as const, expires_in: OAUTH_TOKEN_TTL_SECONDS, scope: asked.join(" ") });
    },
  );

  // ---------- Route integrasi (kunci API / token OAuth) ----------
  app.get("/v1/integrations/me", { schema: { tags: ["Integrasi"], summary: "Identitas kredensial: klinik dan cakupan aktif.", security: apiSec, response: { 200: integrationMeSchema } }, preHandler: requireScope(ad) }, async (req) => ({
    clinic_id: req.integration!.clinicId,
    credential: req.integration!.kind,
    label: req.integration!.label,
    scopes: req.integration!.scopes,
  }));

  app.get(
    "/v1/integrations/patients/:id/summary",
    { schema: { tags: ["Integrasi"], summary: "Ringkasan pasien (tanpa nama/email). Bagian klinis hanya bila pasien menyetujui akses rekam medis.", security: apiSec, params: idParam, response: { 200: integrationPatientSummarySchema } }, preHandler: requireScope(ad, "read:patients") },
    async (req) => data.patientSummary(ic(req), req.params.id),
  );
  app.get(
    "/v1/integrations/patients/:id/checkins",
    { schema: { tags: ["Integrasi"], summary: "Riwayat check-in terbaru (butuh persetujuan rekam medis).", security: apiSec, params: idParam, querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), response: { 200: integrationCheckinsSchema } }, preHandler: requireScope(ad, "read:progress") },
    async (req) => data.patientCheckins(ic(req), req.params.id, req.query.limit),
  );
  app.get(
    "/v1/integrations/patients/:id/progress",
    { schema: { tags: ["Integrasi"], summary: "Progres terhitung dari check-in dan rencana (butuh persetujuan rekam medis).", security: apiSec, params: idParam, response: { 200: progressSchema } }, preHandler: requireScope(ad, "read:progress") },
    async (req) => data.patientProgressFor(ic(req), req.params.id),
  );
  app.get(
    "/v1/integrations/patients/:id/care-plan",
    { schema: { tags: ["Integrasi"], summary: "Rencana pendampingan terbaru yang sudah ditandatangani (butuh persetujuan rekam medis).", security: apiSec, params: idParam, response: { 200: z.object({ plan: patientPlanSchema.nullable() }) } }, preHandler: requireScope(ad, "read:plans") },
    async (req) => data.patientCarePlan(ic(req), req.params.id),
  );
  app.post(
    "/v1/integrations/reminders",
    { schema: { tags: ["Integrasi"], summary: "Buat pengingat check-in atau tinjauan untuk pasien. Teks pengingat baku, tidak dapat diubah.", security: apiSec, body: integrationReminderBodySchema, response: { 201: integrationReminderSchema } }, preHandler: requireScope(ad, "write:reminders") },
    async (req, reply) => reply.code(201).send(await data.createReminder(ic(req), req.body)),
  );
  app.post(
    "/v1/integrations/consultation-requests",
    { schema: { tags: ["Integrasi"], summary: "Ajukan permintaan konsultasi atas nama pasien. Ditinjau tim klinik seperti biasa.", security: apiSec, body: integrationRequestBodySchema, response: { 201: integrationRequestSchema } }, preHandler: requireScope(ad, "write:consultation_requests") },
    async (req, reply) => reply.code(201).send(await data.createConsultationRequest(ic(req), req.body)),
  );

  // Webhook lewat API (cakupan webhooks:manage)
  const apiHooks = (req: Parameters<typeof ic>[0]) => ({ db: ctx.db, clinicId: req.integration!.clinicId, actor: { type: "api" as const, id: req.integration!.id, label: req.integration!.label }, now: ctx.now(), encryptionKey });
  const hookGuard = requireScope(ad, "webhooks:manage");
  app.get("/v1/integrations/webhooks", { schema: { tags: ["Integrasi"], summary: "Daftar endpoint webhook.", security: apiSec, response: { 200: z.object({ webhooks: z.array(webhookViewSchema) }) } }, preHandler: hookGuard }, async (req) => ({ webhooks: await hooks.listWebhooks(apiHooks(req)) }));
  app.post("/v1/integrations/webhooks", { schema: { tags: ["Integrasi"], summary: "Buat endpoint webhook. Rahasia penandatangan hanya tampil di respons ini.", security: apiSec, body: webhookInputSchema, response: { 201: webhookCreatedSchema } }, preHandler: hookGuard }, async (req, reply) => reply.code(201).send(await hooks.createWebhook(apiHooks(req), req.body)));
  app.delete("/v1/integrations/webhooks/:id", { schema: { tags: ["Integrasi"], summary: "Hapus endpoint webhook.", security: apiSec, params: idParam, response: { 200: okSchema } }, preHandler: hookGuard }, async (req) => {
    await hooks.deleteWebhook(apiHooks(req), req.params.id);
    return { ok: true as const };
  });

  // ---------- Konsol: kelola kunci, klien OAuth, webhook (admin klinik) ----------
  const tagS = ["Konsol: integrasi"];
  app.get("/v1/staff/integrations", { schema: { tags: tagS, security: staffSec, response: { 200: integrationOverviewSchema } }, preHandler: clinicAdmin }, async (req) => ({
    api_keys: await keys.listKeys(sc(req)),
    oauth_clients: await keys.listClients(sc(req)),
    webhooks: await hooks.listWebhooks(staffActor(req)),
    events: [...WEBHOOK_EVENTS],
  }));
  app.post("/v1/staff/integrations/api-keys", { schema: { tags: tagS, security: staffSec, body: createApiKeySchema, response: { 201: apiKeyCreatedSchema } }, preHandler: clinicAdmin }, async (req, reply) => reply.code(201).send(await keys.createKey(sc(req), req.body)));
  app.delete("/v1/staff/integrations/api-keys/:id", { schema: { tags: tagS, security: staffSec, params: idParam, response: { 200: apiKeyViewSchema } }, preHandler: clinicAdmin }, async (req) => keys.revokeKey(sc(req), req.params.id));
  app.post("/v1/staff/integrations/oauth-clients", { schema: { tags: tagS, security: staffSec, body: createOauthClientSchema, response: { 201: oauthClientCreatedSchema } }, preHandler: clinicAdmin }, async (req, reply) => reply.code(201).send(await keys.createClient(sc(req), req.body)));
  app.delete("/v1/staff/integrations/oauth-clients/:id", { schema: { tags: tagS, security: staffSec, params: idParam, response: { 200: oauthClientViewSchema } }, preHandler: clinicAdmin }, async (req) => keys.revokeClient(sc(req), req.params.id));
  app.post("/v1/staff/integrations/webhooks", { schema: { tags: tagS, security: staffSec, body: webhookInputSchema, response: { 201: webhookCreatedSchema } }, preHandler: clinicAdmin }, async (req, reply) => reply.code(201).send(await hooks.createWebhook(staffActor(req), req.body)));
  app.put("/v1/staff/integrations/webhooks/:id", { schema: { tags: tagS, security: staffSec, params: idParam, body: webhookUpdateSchema, response: { 200: webhookViewSchema } }, preHandler: clinicAdmin }, async (req) => hooks.updateWebhook(staffActor(req), req.params.id, req.body));
  app.delete("/v1/staff/integrations/webhooks/:id", { schema: { tags: tagS, security: staffSec, params: idParam, response: { 200: okSchema } }, preHandler: clinicAdmin }, async (req) => {
    await hooks.deleteWebhook(staffActor(req), req.params.id);
    return { ok: true as const };
  });
  app.get("/v1/staff/integrations/webhooks/:id/deliveries", { schema: { tags: tagS, security: staffSec, params: idParam, response: { 200: z.object({ deliveries: z.array(deliveryViewSchema) }) } }, preHandler: clinicAdmin }, async (req) => ({ deliveries: await hooks.listDeliveries(staffActor(req), req.params.id) }));
  app.post("/v1/staff/integrations/webhooks/:id/test", { schema: { tags: tagS, security: staffSec, summary: "Kirim event uji (webhook.test) satu kali dan kembalikan hasilnya.", params: idParam, response: { 200: deliveryViewSchema } }, preHandler: clinicAdmin }, async (req) => {
    const a = staffActor(req);
    const id = await hooks.queueTest(a, req.params.id);
    await dispatchOnce(dd());
    const all = await hooks.listDeliveries(a, req.params.id);
    const d = all.find((x) => x.id === id);
    if (!d) throw new AuthError(500, "delivery_missing", "Pengiriman uji belum dapat dibaca.");
    return d;
  });

  registerConnectorRoutes(app, { ctx, ad, encryptionKey, fetchFn });

  // ---------- Dispatcher (Vercel Cron memanggil GET; POST juga diterima) ----------
  const cron = async (req: { headers: { authorization?: string } }) => {
    const secret = cronSecret ?? process.env.CRON_SECRET;
    if (!secret) throw new AuthError(503, "cron_not_configured", "Dispatcher belum dikonfigurasi: CRON_SECRET belum diatur.");
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ") || !safeEqualText(h.slice(7), secret)) throw new AuthError(401, "invalid_credentials", "Kredensial cron tidak valid.");
    return dispatchOnce(dd());
  };
  const dispatchSchema = { tags: ["Internal"], summary: "Jalankan dispatcher webhook satu putaran. Dilindungi CRON_SECRET (Authorization: Bearer).", security: [{ cronSecret: [] }], response: { 200: z.object({ fanned_out: z.number(), attempted: z.number(), delivered: z.number(), retrying: z.number(), failed: z.number() }) } };
  app.post("/v1/internal/dispatch", { schema: dispatchSchema }, cron);
  app.get("/v1/internal/dispatch", { schema: { ...dispatchSchema, hide: false } }, cron);
};

export { SCOPES, timingSafeEqual };
