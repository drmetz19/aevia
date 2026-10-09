import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  beautycodeConfigInputSchema,
  beautycodeSyncResultSchema,
  beautycodeTrackerBodySchema,
  beautycodeTrackerResponseSchema,
  connectorConfigInputSchema,
  connectorOverviewSchema,
  connectorSavedSchema,
  connectorTestResultSchema,
  kliniksistemVisitBodySchema,
  kliniksistemVisitResponseSchema,
} from "@aevia/core";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { requireScope, type Integration, type IntegrationAuthDeps } from "../integrations/auth";
import * as inbound from "./inbound";
import * as svc from "./service";

const eventIdHeader = z.object({ "x-event-id": z.string().trim().min(1).max(120).optional() });
const apiSec: Record<string, string[]>[] = [{ apiKey: [] }, { oauth2: [] }];
const staffSec: Record<string, string[]>[] = [{ staffToken: [] }];

export function registerConnectorRoutes(app: FastifyInstance, o: { ctx: AuthCtx; ad: IntegrationAuthDeps; encryptionKey: Uint8Array; fetchFn?: typeof fetch }) {
  const a = app.withTypeProvider<ZodTypeProvider>();
  const { ctx, ad } = o;
  const clinicAdmin = requireRole(ctx.secret, ctx.now, "clinic_admin");
  const sc = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({ db: ctx.db, clinicId: req.principal!.clinic_id!, actorId: req.principal!.sub, now: ctx.now(), encryptionKey: o.encryptionKey, fetchFn: o.fetchFn });
  const ic = (req: { integration?: Integration }) => ({ db: ctx.db, who: req.integration!, now: ctx.now() });
  const tagS = ["Konsol: konektor"];
  const guard = requireScope(ad, "integrations:write");

  // ---- Konsol (admin klinik) ----
  a.get("/v1/staff/connectors", { schema: { tags: tagS, security: staffSec, response: { 200: connectorOverviewSchema } }, preHandler: clinicAdmin }, async (req) => svc.overview(sc(req)));
  a.put("/v1/staff/connectors/kliniksistem", { schema: { tags: tagS, security: staffSec, summary: "Atur konektor KlinikSistem. Rahasia penandatangan hanya tampil saat dibuat atau diputar.", body: connectorConfigInputSchema, response: { 200: connectorSavedSchema } }, preHandler: clinicAdmin }, async (req) => svc.saveKliniksistem(sc(req), req.body));
  a.put("/v1/staff/connectors/beautycode", { schema: { tags: tagS, security: staffSec, body: beautycodeConfigInputSchema, response: { 200: connectorSavedSchema } }, preHandler: clinicAdmin }, async (req) => svc.saveBeautycode(sc(req), req.body));
  a.post("/v1/staff/connectors/beautycode/sync", { schema: { tags: tagS, security: staffSec, summary: "Tarik ringkasan tracker Beauty Code sekarang (pasien yang setuju berbagi konteks eksternal saja).", response: { 200: beautycodeSyncResultSchema } }, preHandler: clinicAdmin }, async (req) => {
    const r = await svc.syncBeautycode(sc(req));
    return { ok: r.ok, message: r.message, patients: r.patients, days: r.days };
  });
  a.post("/v1/staff/connectors/kliniksistem/test", { schema: { tags: tagS, security: staffSec, summary: "Uji koneksi: kirim aevia.ping bertanda tangan ke KlinikSistem.", response: { 200: connectorTestResultSchema } }, preHandler: clinicAdmin }, async (req) => svc.testKliniksistem(sc(req)));

  // ---- Inbound (kunci API / token OAuth dengan cakupan integrations:write) ----
  a.post(
    "/v1/integrations/kliniksistem/visits",
    {
      schema: {
        tags: ["Integrasi"],
        summary: "KlinikSistem melaporkan status kunjungan (Scheduled/Completed/No-show/Cancelled). Idempoten lewat header X-Event-Id.",
        security: apiSec,
        headers: eventIdHeader,
        body: kliniksistemVisitBodySchema,
        response: { 200: kliniksistemVisitResponseSchema },
      },
      preHandler: guard,
    },
    async (req, reply) => {
      const r = await inbound.kliniksistemVisit(ic(req), req.body, req.headers["x-event-id"]);
      if (r.replayed) reply.header("x-idempotent-replay", "true");
      return r.result as z.infer<typeof kliniksistemVisitResponseSchema>;
    },
  );
  a.post(
    "/v1/integrations/beautycode/tracker",
    {
      schema: {
        tags: ["Integrasi"],
        summary: "BeautyCode mengirim catatan tracker pasien. Butuh persetujuan konteks eksternal pasien (403 consent_required bila belum).",
        security: apiSec,
        headers: eventIdHeader,
        body: beautycodeTrackerBodySchema,
        response: { 200: beautycodeTrackerResponseSchema, 201: beautycodeTrackerResponseSchema },
      },
      preHandler: guard,
    },
    async (req, reply) => {
      const r = await inbound.beautycodeTracker(ic(req), req.body, req.headers["x-event-id"]);
      if (r.replayed) reply.header("x-idempotent-replay", "true");
      return reply.code(r.replayed ? 200 : 201).send(r.result as z.infer<typeof beautycodeTrackerResponseSchema>);
    },
  );
}
