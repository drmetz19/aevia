import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { answerBodySchema, assessmentStateSchema } from "@aevia/core";
import { AuthError } from "../auth/otp";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { completeAssessment, latestAssessment, latestCompleted, startAssessment, submitAnswer } from "./service";

const idParam = z.object({ id: z.uuid() });

export const assessmentRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx }> = async (app, { ctx }) => {
  const guard = requireRole(ctx.secret, ctx.now, "patient");
  const c = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    clinicId: req.principal!.clinic_id!,
    patientId: req.principal!.sub,
    now: ctx.now(),
  });
  const res = { 200: assessmentStateSchema };

  app.post("/v1/assessments", { schema: { response: res }, preHandler: guard }, async (req) => startAssessment(c(req)));

  app.post(
    "/v1/assessments/:id/answers",
    { schema: { params: idParam, body: answerBodySchema, response: res }, preHandler: guard },
    async (req) => submitAnswer(c(req), req.params.id, req.body),
  );

  app.post(
    "/v1/assessments/:id/complete",
    { schema: { params: idParam, response: res }, preHandler: guard },
    async (req) => completeAssessment(c(req), req.params.id),
  );

  // Terbaru (apa pun statusnya); ?status=completed → hanya yang selesai.
  app.get(
    "/v1/assessments/latest",
    { schema: { querystring: z.object({ status: z.enum(["completed"]).optional() }), response: res }, preHandler: guard },
    async (req) => {
      const s = req.query.status === "completed" ? await latestCompleted(c(req)) : await latestAssessment(c(req));
      if (!s) throw new AuthError(404, "assessment_not_found", "Belum ada assessment. Mulai assessment pertama Anda kapan pun siap.");
      return s;
    },
  );
};
