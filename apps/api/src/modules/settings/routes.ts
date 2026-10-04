import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  MAX_BRAND_ASSET_BYTES,
  activeBodySchema,
  adminClinicListSchema,
  adminClinicSchema,
  assistantNameSchema,
  assistantQueueSchema,
  assistantReviewSchema,
  brandSettingsSchema,
  brandUpdateSchema,
  createClinicSchema,
  domainVerifyBodySchema,
  hostnameSchema,
  inviteBodySchema,
  llmBodySchema,
  programInputSchema,
  resolveDomainSchema,
  staffProgramListSchema,
  staffProgramSchema,
  teamListSchema,
  teamMemberSchema,
} from "@aevia/core";
import { AuthError } from "../auth/otp";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import type { StorageProvider } from "../../storage";
import * as admin from "./admin";
import * as brand from "./brand";
import * as prog from "./programs";
import * as team from "./team";

const idParam = z.object({ id: z.uuid() });
const slugParam = z.object({ slug: z.string().min(1).max(64) });

export const settingsRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx; storage: StorageProvider; llmAvailable: () => boolean }> = async (app, { ctx, storage, llmAvailable }) => {
  const clinicAdmin = requireRole(ctx.secret, ctx.now, "clinic_admin");
  const platformAdmin = requireRole(ctx.secret, ctx.now, "aevia_admin");
  const sc = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    storage,
    clinicId: req.principal!.clinic_id!,
    actorId: req.principal!.sub,
    now: ctx.now(),
    llmAvailable: llmAvailable(),
  });

  // Unggah aset merek: biner image/*, maks. 1 MB.
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: MAX_BRAND_ASSET_BYTES + 1024 }, (_req, body, done) => done(null, body));
  const bin = (req: { body: unknown }) => {
    if (!Buffer.isBuffer(req.body)) throw new AuthError(415, "unsupported_type", "Format gambar belum didukung. Gunakan PNG atau WebP.");
    return req.body;
  };
  const assetBody = { bodyLimit: MAX_BRAND_ASSET_BYTES + 1024 };

  // ---- Publik ----
  app.get("/v1/clinics/:slug/assets/:kind", { schema: { params: slugParam.extend({ kind: z.enum(["logo", "avatar"]) }) } }, async (req, reply) => {
    const a = await brand.publicAsset(ctx.db, storage, req.params.slug, req.params.kind);
    if (!a) throw new AuthError(404, "asset_not_found", "Gambar ini belum ditemukan.");
    return reply
      .header("content-type", a.contentType)
      .header("cache-control", "public, max-age=300")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .send(a.data);
  });
  app.get(
    "/v1/domains/resolve",
    { schema: { querystring: z.object({ host: hostnameSchema }), response: { 200: resolveDomainSchema } } },
    async (req) => {
      const hit = await admin.resolveDomain(ctx.db, req.query.host);
      if (!hit) throw new AuthError(404, "domain_unknown", "Domain ini belum terhubung ke klinik mana pun.");
      return hit;
    },
  );

  // ---- Admin klinik: brand ----
  app.get("/v1/staff/brand", { schema: { response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.getBrand(sc(req)));
  app.put("/v1/staff/brand", { schema: { body: brandUpdateSchema, response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.updateBrand(sc(req), req.body));
  app.post("/v1/staff/brand/logo", { ...assetBody, schema: { response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.uploadLogo(sc(req), bin(req)));
  app.delete("/v1/staff/brand/logo", { schema: { response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.removeLogo(sc(req)));
  app.put("/v1/staff/brand/assistant", { schema: { body: assistantNameSchema, response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.proposeAssistantName(sc(req), req.body.name));
  app.post("/v1/staff/brand/assistant-avatar", { ...assetBody, schema: { response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.proposeAssistantAvatar(sc(req), bin(req)));
  app.get("/v1/staff/brand/pending-avatar", { schema: { summary: "Berkas avatar usulan (admin klinik)." }, preHandler: clinicAdmin }, async (req, reply) => {
    const a = await brand.pendingAvatarBytes({ db: ctx.db, storage }, req.principal!.clinic_id!);
    return reply.header("content-type", a.contentType).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(a.data);
  });
  app.put("/v1/staff/brand/llm", { schema: { body: llmBodySchema, response: { 200: brandSettingsSchema } }, preHandler: clinicAdmin }, async (req) => brand.setLlm(sc(req), req.body.enabled));

  // ---- Admin klinik: program ----
  app.get("/v1/staff/programs", { schema: { response: { 200: staffProgramListSchema } }, preHandler: clinicAdmin }, async (req) => ({ programs: await prog.listPrograms(sc(req)) }));
  app.post("/v1/staff/programs", { schema: { body: programInputSchema, response: { 201: staffProgramSchema } }, preHandler: clinicAdmin }, async (req, reply) =>
    reply.code(201).send(await prog.createProgram(sc(req), req.body)),
  );
  app.put("/v1/staff/programs/:id", { schema: { params: idParam, body: programInputSchema, response: { 200: staffProgramSchema } }, preHandler: clinicAdmin }, async (req) =>
    prog.updateProgram(sc(req), req.params.id, req.body),
  );
  app.delete("/v1/staff/programs/:id", { schema: { params: idParam, response: { 200: z.object({ ok: z.literal(true) }) } }, preHandler: clinicAdmin }, async (req) => {
    await prog.deleteProgram(sc(req), req.params.id);
    return { ok: true as const };
  });

  // ---- Admin klinik: tim ----
  app.get("/v1/staff/team", { schema: { response: { 200: teamListSchema } }, preHandler: clinicAdmin }, async (req) => ({ members: await team.listTeam(sc(req)) }));
  app.post("/v1/staff/team", { schema: { body: inviteBodySchema, response: { 201: teamMemberSchema } }, preHandler: clinicAdmin }, async (req, reply) =>
    reply.code(201).send(await team.inviteStaff(sc(req), req.body)),
  );
  app.put("/v1/staff/team/:id/active", { schema: { params: idParam, body: activeBodySchema, response: { 200: teamMemberSchema } }, preHandler: clinicAdmin }, async (req) =>
    team.setStaffActive(sc(req), req.params.id, req.body.active),
  );

  // ---- Admin AEVIA ----
  const ac = (req: { principal?: { sub: string } }) => ({ db: ctx.db, adminId: req.principal!.sub, now: ctx.now(), storage });
  app.get("/v1/admin/clinics", { schema: { response: { 200: adminClinicListSchema } }, preHandler: platformAdmin }, async () => ({ clinics: await admin.listClinics(ctx.db) }));
  app.post("/v1/admin/clinics", { schema: { body: createClinicSchema, response: { 201: adminClinicSchema } }, preHandler: platformAdmin }, async (req, reply) =>
    reply.code(201).send(await admin.createClinic(ac(req), req.body)),
  );
  app.put("/v1/admin/clinics/:id/domain", { schema: { params: idParam, body: domainVerifyBodySchema, response: { 200: adminClinicSchema } }, preHandler: platformAdmin }, async (req) =>
    admin.verifyDomain(ac(req), req.params.id, req.body.verified),
  );
  app.get("/v1/admin/assistants", { schema: { response: { 200: assistantQueueSchema } }, preHandler: platformAdmin }, async () => ({ items: await admin.assistantQueue(ctx.db) }));
  app.get("/v1/admin/assistants/:id/avatar", { schema: { params: idParam, summary: "Berkas avatar usulan (admin platform)." }, preHandler: platformAdmin }, async (req, reply) => {
    const a = await brand.pendingAvatarBytes({ db: ctx.db, storage }, req.params.id);
    return reply.header("content-type", a.contentType).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(a.data);
  });
  app.post("/v1/admin/assistants/:id/review", { schema: { params: idParam, body: assistantReviewSchema, response: { 200: adminClinicSchema } }, preHandler: platformAdmin }, async (req) =>
    admin.reviewAssistant(ac(req), req.params.id, req.body.decision, req.body.note),
  );
};
