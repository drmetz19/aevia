import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { checkinBodySchema, checkinFormSchema, progressSchema, reminderListSchema } from "@aevia/core";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { checkinForm, dueReminders, markRead, patientProgress, staffProgress, submitCheckin } from "./service";

const idParam = z.object({ id: z.uuid() });

export const progressRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx }> = async (app, { ctx }) => {
  const patient = requireRole(ctx.secret, ctx.now, "patient");
  const pro = requireRole(ctx.secret, ctx.now, "professional");
  const p = (req: { principal?: { sub: string; clinic_id: string | null } }) => ({
    db: ctx.db,
    clinicId: req.principal!.clinic_id!,
    patientId: req.principal!.sub,
    now: ctx.now(),
  });

  app.get("/v1/checkins/form", { schema: { response: { 200: checkinFormSchema } }, preHandler: patient }, async (req) => checkinForm(p(req)));
  app.post("/v1/checkins", { schema: { body: checkinBodySchema, response: { 201: progressSchema } }, preHandler: patient }, async (req, reply) =>
    reply.code(201).send(await submitCheckin(p(req), req.body)),
  );
  app.get("/v1/progress", { schema: { response: { 200: progressSchema } }, preHandler: patient }, async (req) => patientProgress(p(req)));
  app.get("/v1/reminders", { schema: { response: { 200: reminderListSchema } }, preHandler: patient }, async (req) => ({
    reminders: await dueReminders(p(req)),
  }));
  app.post("/v1/reminders/:id/read", { schema: { params: idParam, response: { 200: z.object({ ok: z.literal(true) }) } }, preHandler: patient }, async (req) => {
    await markRead(p(req), req.params.id);
    return { ok: true as const };
  });

  app.get(
    "/v1/staff/patients/:id/progress",
    {
      schema: {
        params: idParam,
        response: { 200: z.object({ progress_visible: z.boolean(), hidden_reason: z.string().nullable(), progress: progressSchema.nullable() }) },
      },
      preHandler: pro,
    },
    async (req) => staffProgress(ctx.db, req.principal!.clinic_id!, req.params.id),
  );
};
