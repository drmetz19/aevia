import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  LEAD_STAGES,
  LEAD_STAGE_INFO,
  contactListQuerySchema,
  contactListSchema,
  contactStageChangeSchema,
  contactStageHistorySchema,
  contactUpdateSchema,
  contactUpsertResponseSchema,
  contactUpsertSchema,
  contactViewSchema,
  funnelQuerySchema,
  funnelSchema,
  leadStageCatalogSchema,
} from "@aevia/core";
import type { AuthCtx } from "../auth/service";
import { requireScope, type Integration, type IntegrationAuthDeps } from "../integrations/auth";
import * as svc from "./service";

const idParam = z.object({ id: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });
const apiSec: Record<string, string[]>[] = [{ apiKey: [] }, { oauth2: [] }];
const tags = ["CRM"];

/** API CRM: data kontak + fase lead. Kredensial integrasi klinik (kunci API / OAuth) dengan cakupan read:contacts / write:contacts. */
export function registerCrmRoutes(app: FastifyInstance, o: { ctx: AuthCtx; ad: IntegrationAuthDeps }) {
  const a = app.withTypeProvider<ZodTypeProvider>();
  const { ctx, ad } = o;
  const ic = (req: { integration?: Integration }) => ({ db: ctx.db, who: req.integration!, now: ctx.now() });
  const read = requireScope(ad, "read:contacts");
  const write = requireScope(ad, "write:contacts");

  a.get(
    "/v1/integrations/lead-stages",
    { schema: { tags, summary: "Katalog fase lead dan padanannya dengan fase penjualan CRM. Pakai untuk memetakan pipeline.", security: apiSec, response: { 200: leadStageCatalogSchema } }, preHandler: requireScope(ad) },
    async () => ({ stages: LEAD_STAGES.map((s) => LEAD_STAGE_INFO[s]) }),
  );
  a.get(
    "/v1/integrations/contacts",
    { schema: { tags, summary: "Daftar kontak, urut updated_at naik. Untuk sinkron inkremental kirim updated_since; lanjutkan halaman dengan next_cursor.", security: apiSec, querystring: contactListQuerySchema, response: { 200: contactListSchema } }, preHandler: read },
    async (req) => svc.listContacts(ic(req), req.query),
  );
  a.post(
    "/v1/integrations/contacts",
    {
      schema: {
        tags,
        summary: "Buat atau perbarui kontak (upsert). Dicocokkan via external_source+external_ref, lalu email, lalu telepon. 201 bila baru, 200 bila diperbarui.",
        security: apiSec,
        body: contactUpsertSchema,
        response: { 200: contactUpsertResponseSchema, 201: contactUpsertResponseSchema },
      },
      preHandler: write,
    },
    async (req, reply) => {
      const r = await svc.upsertContact(ic(req), req.body);
      return reply.code(r.created ? 201 : 200).send(r);
    },
  );
  a.get(
    "/v1/integrations/contacts/:id",
    { schema: { tags, summary: "Detail satu kontak.", security: apiSec, params: idParam, response: { 200: contactViewSchema } }, preHandler: read },
    async (req) => svc.getContact(ic(req), req.params.id),
  );
  a.patch(
    "/v1/integrations/contacts/:id",
    { schema: { tags, summary: "Ubah data kontak (hanya kolom yang dikirim). null mengosongkan email/telepon/penanggung jawab/nilai.", security: apiSec, params: idParam, body: contactUpdateSchema, response: { 200: contactViewSchema } }, preHandler: write },
    async (req) => svc.updateContact(ic(req), req.params.id, req.body),
  );
  a.delete(
    "/v1/integrations/contacts/:id",
    { schema: { tags, summary: "Hapus kontak yang belum punya akun pasien. Kontak tertaut → 409; tandai lost saja.", security: apiSec, params: idParam, response: { 200: okSchema } }, preHandler: write },
    async (req) => {
      await svc.deleteContact(ic(req), req.params.id);
      return { ok: true as const };
    },
  );
  a.post(
    "/v1/integrations/contacts/:id/stage",
    { schema: { tags, summary: "Pindahkan fase lead secara manual (mis. contacted, lost + lost_reason, atau koreksi). Tercatat di riwayat dan memicu webhook contact.stage_changed.", security: apiSec, params: idParam, body: contactStageChangeSchema, response: { 200: contactViewSchema } }, preHandler: write },
    async (req) => svc.changeStage(ic(req), req.params.id, req.body),
  );
  a.get(
    "/v1/integrations/contacts/:id/stages",
    { schema: { tags, summary: "Riwayat perpindahan fase (otomatis dan manual).", security: apiSec, params: idParam, response: { 200: contactStageHistorySchema } }, preHandler: read },
    async (req) => svc.stageHistory(ic(req), req.params.id),
  );
  a.get(
    "/v1/integrations/funnel",
    { schema: { tags, summary: "Funnel penjualan per fase: jumlah saat ini, yang pernah mencapai, dan konversi antar fase. Filter kohort from/to (tanggal kontak dibuat).", security: apiSec, querystring: funnelQuerySchema, response: { 200: funnelSchema } }, preHandler: read },
    async (req) => svc.funnel(ic(req), req.query),
  );
}
