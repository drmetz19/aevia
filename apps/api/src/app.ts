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
import { programRoutes } from "./modules/programs/routes";
import { consultationRoutes } from "./modules/consultations/routes";
import { staffRoutes } from "./modules/staff/routes";
import { clinicalRoutes } from "./modules/clinical/routes";
import { storageFromEnv, type StorageProvider } from "./storage";
import { planRoutes } from "./modules/plans/routes";
import { progressRoutes } from "./modules/progress/routes";
import { settingsRoutes } from "./modules/settings/routes";
import { isStaffActive } from "./modules/settings/team";
import { consentRoutes } from "./modules/consents/routes";

export interface AppDeps {
  db: Db;
  otpSender?: OtpSender;
  jwtSecret?: string;
  storage?: StorageProvider;
  /** Kunci layanan LLM platform; default dari env ANTHROPIC_API_KEY. Kosong → mode LLM tidak dapat dinyalakan. */
  anthropicApiKey?: string;
  now?: () => Date;
}

/** Dipakai server lokal dan (nanti) Vercel Function: tidak membuka port di sini. */
export async function buildApp({ db, otpSender = consoleOtpSender, jwtSecret, now = () => new Date(), storage, anthropicApiKey = process.env.ANTHROPIC_API_KEY }: AppDeps) {
  const ctx = { db, secret: resolveSecret(jwtSecret), sender: otpSender, now };
  const files = storage ?? storageFromEnv(ctx.secret);
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.decorate("isStaffActive", (staffId: string, clinicId: string) => isStaffActive(db, staffId, clinicId));
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: "not_found", message: "Halaman yang Anda cari belum ditemukan." }),
  );
  app.setErrorHandler((err: { statusCode?: number; validation?: unknown }, _req, reply) => {
      const code = (err as { code?: string }).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const brandAsset = _req.url.includes("/v1/staff/brand/");
      return reply.code(413).send({ error: "file_too_large", message: brandAsset ? "Ukuran gambar melebihi 1 MB. Silakan pilih gambar yang lebih kecil." : "Ukuran foto melebihi 10 MB. Silakan pilih foto yang lebih kecil." });
    }
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return reply.code(415).send({ error: "unsupported_type", message: "Format foto belum didukung. Gunakan JPG, PNG, atau WebP." });
    if (err instanceof AuthError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
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
  await app.register(programRoutes, { db });
  await app.register(consultationRoutes, { ctx });
  await app.register(staffRoutes, { ctx });
  await app.register(clinicalRoutes, { ctx, storage: files });
  await app.register(planRoutes, { ctx });
  await app.register(settingsRoutes, { ctx, storage: files, llmAvailable: () => Boolean(anthropicApiKey) });
  await app.register(progressRoutes, { ctx });

  return app;
}
