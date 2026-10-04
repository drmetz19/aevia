import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "@aevia/db";
import { clinicRoutes } from "./modules/clinics/routes";
import { authRoutes } from "./modules/auth/routes";
import { AuthError } from "./modules/auth/otp";
import { consoleOtpSender, type OtpSender } from "./modules/auth/otp-sender";
import { resolveSecret } from "./modules/auth/tokens";
import { assessmentRoutes } from "./modules/assessments/routes";
import { consentRoutes } from "./modules/consents/routes";

export interface AppDeps {
  db: Db;
  otpSender?: OtpSender;
  jwtSecret?: string;
  now?: () => Date;
}

/** Dipakai server lokal dan (nanti) Vercel Function: tidak membuka port di sini. */
export async function buildApp({ db, otpSender = consoleOtpSender, jwtSecret, now = () => new Date() }: AppDeps) {
  const ctx = { db, secret: resolveSecret(jwtSecret), sender: otpSender, now };
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: "not_found", message: "Halaman yang Anda cari belum ditemukan." }),
  );
  app.setErrorHandler((err: { statusCode?: number; validation?: unknown }, _req, reply) => {
      if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (hasZodFastifySchemaValidationErrors(err) || err.validation || err.statusCode === 400) {
      return reply.code(400).send({ error: "bad_request", message: "Ada bagian yang belum terisi atau belum sesuai. Mohon periksa kembali." });
    }
    return reply.code(err.statusCode ?? 500).send({
      error: "server_error",
      message: "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.",
    });
  });

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: { info: { title: "AEVIA API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  await app.register(clinicRoutes, { db });
  await app.register(authRoutes, { ctx });
  await app.register(consentRoutes, { ctx });
  await app.register(assessmentRoutes, { ctx });

  return app;
}
