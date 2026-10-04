import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createRequestSchema, draftBodySchema, draftSchema, myRequestsSchema, requestSchema } from "@aevia/core";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { noLlm, type LlmEngine } from "../llm/engine";
import { buildDraft, createRequest, myRequests } from "./service";

export const consultationRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx; llm?: LlmEngine }> = async (app, { ctx, llm = noLlm }) => {
  const guard = requireRole(ctx.secret, ctx.now, "patient");
  const c = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    clinicId: req.principal!.clinic_id!,
    patientId: req.principal!.sub,
    now: ctx.now(),
  });

  app.post(
    "/v1/consultation-requests/draft",
    { schema: { body: draftBodySchema, response: { 200: draftSchema } }, preHandler: guard },
    async (req) => {
      const d = await buildDraft(c(req));
      // Narasi disempurnakan LLM hanya bila aktif; tetap draf (pasien yang mengirim), gagal → skrip tanpa galat.
      return { ...d, prep: await llm.polishPrep(req.principal!.clinic_id!, d.prep) };
    },
  );
  app.post(
    "/v1/consultation-requests",
    { schema: { body: createRequestSchema, response: { 201: requestSchema } }, preHandler: guard },
    async (req, reply) => reply.code(201).send(await createRequest(c(req), req.body.program_id, req.body.prep)),
  );
  app.get(
    "/v1/consultation-requests/mine",
    { schema: { response: { 200: myRequestsSchema } }, preHandler: guard },
    async (req) => ({ requests: await myRequests(c(req)) }),
  );
};
