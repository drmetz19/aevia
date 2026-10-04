import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  patientPlanSchema,
  patientSummarySchema,
  planBodySchema,
  planListSchema,
  planSchema,
  prescriptionBodySchema,
  prescriptionListSchema,
  prescriptionSchema,
  signBodySchema,
} from "@aevia/core";
import { AuthError } from "../auth/otp";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { noLlm, type LlmEngine } from "../llm/engine";
import { consultationSummary, currentPlan, issueRx, listPlans, listPrescriptions, savePlanDraft, saveRxDraft, signPlan } from "./service";

const idParam = z.object({ id: z.uuid() });

export const planRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx; llm?: LlmEngine }> = async (app, { ctx, llm = noLlm }) => {
  // Resep dan rencana: hanya profesional (bukan admin klinik, Sovia/MCP/API, atau pasien).
  const pro = requireRole(ctx.secret, ctx.now, "professional");
  const patient = requireRole(ctx.secret, ctx.now, "patient");
  const s = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({ db: ctx.db, clinicId: req.principal!.clinic_id!, staffId: req.principal!.sub, now: ctx.now() });
  const p = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({ db: ctx.db, clinicId: req.principal!.clinic_id!, patientId: req.principal!.sub });

  app.get("/v1/staff/consultations/:id/prescriptions", { schema: { params: idParam, response: { 200: prescriptionListSchema } }, preHandler: pro }, async (req) => ({
    prescriptions: await listPrescriptions(s(req), req.params.id),
  }));
  app.put(
    "/v1/staff/consultations/:id/prescriptions",
    { schema: { params: idParam, body: prescriptionBodySchema, response: { 200: prescriptionSchema } }, preHandler: pro },
    async (req) => saveRxDraft(s(req), req.params.id, req.body.items),
  );
  app.post("/v1/staff/prescriptions/:id/issue", { schema: { params: idParam, response: { 200: prescriptionSchema } }, preHandler: pro }, async (req) =>
    issueRx(s(req), req.params.id),
  );

  app.get("/v1/staff/consultations/:id/care-plans", { schema: { params: idParam, response: { 200: planListSchema } }, preHandler: pro }, async (req) => ({
    plans: await listPlans(s(req), req.params.id),
  }));
  app.put(
    "/v1/staff/consultations/:id/care-plans",
    { schema: { params: idParam, body: planBodySchema, response: { 200: planSchema } }, preHandler: pro },
    async (req) => savePlanDraft(s(req), req.params.id, req.body.content, req.body.summary),
  );
  app.post(
    "/v1/staff/care-plans/:id/sign",
    { schema: { params: idParam, body: signBodySchema, response: { 200: planSchema } }, preHandler: pro },
    async (req) => signPlan(s(req), req.params.id),
  );

  app.get("/v1/care-plans/current", { schema: { response: { 200: patientPlanSchema } }, preHandler: patient }, async (req) => {
    const plan = await currentPlan(p(req));
    if (!plan) throw new AuthError(404, "plan_not_available", "Rencana akan tersedia setelah konsultasi selesai ditinjau profesional.");
    return llm.polishPlan(req.principal!.clinic_id!, plan);
  });
  app.get("/v1/consultations/:id/summary", { schema: { params: idParam, response: { 200: patientSummarySchema } }, preHandler: patient }, async (req) => {
    const r = await consultationSummary(p(req), req.params.id);
    return r.plan ? { ...r, plan: await llm.polishPlan(req.principal!.clinic_id!, r.plan) } : r;
  });
};
