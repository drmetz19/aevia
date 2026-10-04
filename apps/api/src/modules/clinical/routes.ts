import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  MAX_PHOTO_BYTES,
  angleSchema,
  annotationsBodySchema,
  auditListSchema,
  consultationDetailSchema,
  photoSchema,
  photoUrlSchema,
  skinBodySchema,
  skinSchema,
  soapBodySchema,
  soapSchema,
} from "@aevia/core";
import { AuthError } from "../auth/otp";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { verifyFileToken, type StorageProvider } from "../../storage";
import { auditFor, consultationDetail, photoUrl, readPhotoForServing, saveAnnotations, saveSkin, saveSoap, skinView, uploadPhoto } from "./service";

const idParam = z.object({ id: z.uuid() });

export const clinicalRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx; storage: StorageProvider }> = async (app, { ctx, storage }) => {
  // Data klinis hanya untuk profesional. Audit juga dapat dibaca admin klinik.
  const pro = requireRole(ctx.secret, ctx.now, "professional");
  const proOrAdmin = requireRole(ctx.secret, ctx.now, "professional", "clinic_admin");
  const c = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    clinicId: req.principal!.clinic_id!,
    staffId: req.principal!.sub,
    now: ctx.now(),
    storage,
  });

  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES + 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get("/v1/staff/consultations/:id", { schema: { params: idParam, response: { 200: consultationDetailSchema } }, preHandler: pro }, async (req) =>
    consultationDetail(c(req), req.params.id),
  );

  app.put(
    "/v1/staff/consultations/:id/soap",
    { schema: { params: idParam, body: soapBodySchema, response: { 200: soapSchema } }, preHandler: pro },
    async (req) => saveSoap(c(req), req.params.id, req.body),
  );

  app.get("/v1/staff/consultations/:id/skin", { schema: { params: idParam, response: { 200: skinSchema } }, preHandler: pro }, async (req) =>
    skinView(c(req), req.params.id),
  );
  app.put(
    "/v1/staff/consultations/:id/skin",
    { schema: { params: idParam, body: skinBodySchema, response: { 200: skinSchema } }, preHandler: pro },
    async (req) => saveSkin(c(req), req.params.id, req.body),
  );

  app.post(
    "/v1/staff/consultations/:id/photos",
    {
      schema: { params: idParam, querystring: z.object({ angle: angleSchema.default("front") }), response: { 201: photoSchema } },
      bodyLimit: MAX_PHOTO_BYTES + 1024,
      preHandler: pro,
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new AuthError(415, "unsupported_type", "Format foto belum didukung. Gunakan JPG, PNG, atau WebP.");
      return reply.code(201).send(await uploadPhoto(c(req), req.params.id, req.query.angle, req.body));
    },
  );

  app.get("/v1/staff/photos/:id/url", { schema: { params: idParam, response: { 200: photoUrlSchema } }, preHandler: pro }, async (req) =>
    photoUrl(c(req), req.params.id),
  );
  app.put(
    "/v1/staff/photos/:id/annotations",
    { schema: { params: idParam, body: annotationsBodySchema, response: { 200: photoSchema } }, preHandler: pro },
    async (req) => saveAnnotations(c(req), req.params.id, req.body.annotations),
  );

  app.get("/v1/staff/consultations/:id/audit", { schema: { params: idParam, response: { 200: auditListSchema } }, preHandler: proOrAdmin }, async (req) => ({
    entries: await auditFor(c(req), req.params.id),
  }));

  // Berkas lokal bertanda tangan. Consent `photos` dicek SAAT permintaan: pencabutan langsung menutup akses.
  app.get(
    "/v1/files/:id",
    { schema: { params: idParam, querystring: z.object({ c: z.uuid(), e: z.coerce.number(), s: z.string().min(10).max(100) }), hide: true } },
    async (req, reply) => {
      const { c: clinicId, e, s } = req.query;
      if (!verifyFileToken(ctx.secret, req.params.id, clinicId, e, s, ctx.now())) {
        throw new AuthError(403, "link_invalid", "Tautan foto sudah tidak berlaku. Silakan buka ulang dari halaman konsultasi.");
      }
      const r = await readPhotoForServing(ctx.db, storage, clinicId, req.params.id);
      if (r.status === 403) throw new AuthError(403, "photos_consent_required", "Persetujuan foto pasien tidak aktif. Foto tidak dapat diakses.");
      if (r.status === 404) throw new AuthError(404, "photo_not_found", "Foto ini belum ditemukan.");
      return reply
        .header("content-type", r.contentType)
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", "inline")
        .send(Buffer.from(r.data));
    },
  );
};
