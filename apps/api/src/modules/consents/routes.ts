import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { consentListSchema, updateConsentSchema } from "@aevia/core";
import { requireRole } from "../auth/guard";
import type { AuthCtx } from "../auth/service";
import { listConsents, setConsent } from "./service";

export const consentRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx }> = async (app, { ctx }) => {
  const guard = requireRole(ctx.secret, ctx.now, "patient");
  app.get("/v1/me/consents", { schema: { response: { 200: consentListSchema } }, preHandler: guard }, async (req) => ({
    consents: await listConsents(ctx.db, req.principal!.clinic_id!, req.principal!.sub),
  }));
  app.put(
    "/v1/me/consents",
    { schema: { body: updateConsentSchema, response: { 200: consentListSchema } }, preHandler: guard },
    async (req) => ({
      consents: await setConsent(ctx.db, req.principal!.clinic_id!, req.principal!.sub, req.body.scope, req.body.granted, ctx.now()),
    }),
  );
};
