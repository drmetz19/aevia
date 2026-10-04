import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  otpRequestedSchema,
  patientMeSchema,
  requestOtpSchema,
  sessionSchema,
  staffMeSchema,
  verifyOtpSchema,
} from "@aevia/core";
import { findClinicBySlug } from "@aevia/db";
import { AuthError } from "./otp";
import { FORBIDDEN, SESSION_ENDED, requireRole } from "./guard";
import { patientProfile, requestPatientOtp, requestStaffOtp, staffProfile, verifyPatientOtp, verifyStaffOtp, type AuthCtx } from "./service";

const slugParam = z.object({ slug: z.string().min(1).max(64) });

export const authRoutes: FastifyPluginAsyncZod<{ ctx: AuthCtx }> = async (app, { ctx }) => {
  app.post(
    "/v1/clinics/:slug/auth/otp",
    { schema: { params: slugParam, body: requestOtpSchema, response: { 200: otpRequestedSchema } } },
    async (req) => requestPatientOtp(ctx, req.params.slug, req.body.email),
  );
  app.post(
    "/v1/clinics/:slug/auth/verify",
    { schema: { params: slugParam, body: verifyOtpSchema, response: { 200: sessionSchema } } },
    async (req) => verifyPatientOtp(ctx, req.params.slug, req.body.email, req.body.code),
  );
  app.post(
    "/v1/staff/auth/otp",
    { schema: { body: requestOtpSchema, response: { 200: otpRequestedSchema } } },
    async (req) => requestStaffOtp(ctx, req.body.email),
  );
  app.post(
    "/v1/staff/auth/verify",
    { schema: { body: verifyOtpSchema, response: { 200: sessionSchema } } },
    async (req) => verifyStaffOtp(ctx, req.body.email, req.body.code),
  );

  // Profil pasien: tenant dari path HARUS sama dengan tenant di token (pasien klinik A ditolak di klinik B).
  app.get(
    "/v1/clinics/:slug/me",
    {
      schema: { params: slugParam, response: { 200: patientMeSchema } },
      preHandler: requireRole(ctx.secret, ctx.now, "patient"),
    },
    async (req) => {
      const clinic = await findClinicBySlug(ctx.db, req.params.slug);
      if (!clinic) throw new AuthError(404, "clinic_not_found", "Klinik yang Anda cari belum kami temukan.");
      const me = req.principal!;
      if (me.clinic_id !== clinic.id) throw new AuthError(403, "forbidden", FORBIDDEN);
      const p = await patientProfile(ctx.db, clinic.id, me.sub);
      if (!p) throw new AuthError(401, "session_ended", SESSION_ENDED);
      return { id: p.id, email: p.email, clinic_slug: clinic.slug, role: "patient" as const };
    },
  );

  app.get(
    "/v1/staff/me",
    {
      schema: { response: { 200: staffMeSchema } },
      preHandler: requireRole(ctx.secret, ctx.now, "professional", "clinic_admin", "aevia_admin"),
    },
    async (req) => {
      const p = await staffProfile(ctx.db, req.principal!.sub, req.principal!.role);
      if (!p) throw new AuthError(401, "session_ended", SESSION_ENDED);
      return p;
    },
  );
};
