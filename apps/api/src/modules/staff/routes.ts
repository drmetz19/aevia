import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { acceptBodySchema, patientDetailSchema, queueSchema, requestSchema } from "@aevia/core";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { acceptRequest, patientDetail, queue } from "./service";

const idParam = z.object({ id: z.uuid() });

export const staffRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx }> = async (app, { ctx }) => {
  const guard = requireRole(ctx.secret, ctx.now, "professional", "clinic_admin");
  const c = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    clinicId: req.principal!.clinic_id!,
    staffId: req.principal!.sub,
    now: ctx.now(),
  });

  app.get("/v1/staff/queue", { schema: { response: { 200: queueSchema } }, preHandler: guard }, async (req) => ({
    items: await queue(c(req)),
  }));
  app.get(
    "/v1/staff/patients/:id",
    { schema: { params: idParam, response: { 200: patientDetailSchema } }, preHandler: guard },
    async (req) => patientDetail(c(req), req.params.id),
  );
  app.post(
    "/v1/staff/consultation-requests/:id/accept",
    { schema: { params: idParam, body: acceptBodySchema, response: { 200: requestSchema } }, preHandler: guard },
    async (req) => acceptRequest(c(req), req.params.id, req.body),
  );
};
