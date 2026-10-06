import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { SCOPES, SCOPE_LABELS, type LLMProvider } from "@aevia/core";
import type { Db } from "@aevia/db";
import { clinicRoutes } from "./modules/clinics/routes";
import { authRoutes } from "./modules/auth/routes";
import { AuthError } from "./modules/auth/otp";
import { otpSenderFromEnv, type OtpSender } from "./modules/auth/otp-sender";
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
import { reencryptWebhookSecrets, resolveEncryptionKey } from "./modules/integrations/crypto";
import { ClaudeProvider } from "./modules/llm/claude";
import { createLlmEngine } from "./modules/llm/engine";
import { integrationRoutes } from "./modules/integrations/routes";
import type { RateLimitConfig } from "./modules/integrations/rate-limit";

export interface AppDeps {
  db: Db;
  otpSender?: OtpSender;
  jwtSecret?: string;
  storage?: StorageProvider;
  /** Kunci layanan LLM platform; default dari env ANTHROPIC_API_KEY. Kosong → mode LLM tidak dapat dinyalakan. */
  anthropicApiKey?: string;
  now?: () => Date;
  /** Untuk pengujian dispatcher webhook; default fetch global. */
  fetchFn?: typeof fetch;
  /** Batas permintaan per kredensial integrasi (token bucket di memori). */
  rateLimit?: RateLimitConfig;
  /** Rahasia untuk /v1/internal/dispatch; default env CRON_SECRET. */
  cronSecret?: string;
  /** 32 byte; default env ENCRYPTION_KEY. Mengenkripsi rahasia webhook saat disimpan (AES-256-GCM). */
  encryptionKey?: Uint8Array;
  /** Provider LLM. Default: ClaudeProvider bila ANTHROPIC_API_KEY ada DAN bukan lingkungan test; selain itu mode skrip. */
  llmProvider?: LLMProvider;
  llmTimeoutMs?: number;
  /** Log alasan fallback LLM (default: console.warn kecuali test). */
  llmLog?: (msg: string) => void;
}

const isTestEnv = () => process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

/** Dipakai server lokal dan (nanti) Vercel Function: tidak membuka port di sini. */
export async function buildApp({ db, otpSender = otpSenderFromEnv(), jwtSecret, now = () => new Date(), storage, anthropicApiKey = process.env.ANTHROPIC_API_KEY, fetchFn, rateLimit, cronSecret, encryptionKey, llmProvider, llmTimeoutMs, llmLog }: AppDeps) {
  const ctx = { db, secret: resolveSecret(jwtSecret), sender: otpSender, now };
  const encKey = encryptionKey ?? resolveEncryptionKey();
  await reencryptWebhookSecrets(db, encKey); // migrasi data idempoten: rahasia webhook lama → terenkripsi
  const provider = llmProvider ?? (anthropicApiKey && !isTestEnv() ? new ClaudeProvider(anthropicApiKey) : undefined);
  const llm = createLlmEngine({ db, provider, now, timeoutMs: llmTimeoutMs, log: llmLog ?? (isTestEnv() ? undefined : (m) => console.warn(m)) });
  const files = storage ?? storageFromEnv(ctx.secret);
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.decorate("isStaffActive", (staffId: string, clinicId: string) => isStaffActive(db, staffId, clinicId));
  // Body JSON kosong (content-type JSON tanpa isi) diperlakukan sebagai tanpa body, bukan 400.
  // Klien lama dan integrasi sering mengirim header ini pada POST tanpa payload.
  const jsonParser = app.getDefaultJsonParser("error", "error"); // tetap aman dari __proto__/constructor poisoning
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, undefined);
    jsonParser(req, text, done);
  });
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
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AEVIA API",
        version: "0.1.0",
        description:
          "API AEVIA. Integrasi pihak ketiga memakai kunci API (Bearer aev_live_… / aev_test_…) atau token OAuth client-credentials. Panduan: docs/integrasi/README.md.",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          apiKey: { type: "http", scheme: "bearer", description: "Kunci API klinik (aev_live_… atau aev_test_…)." },
          oauth2: {
            type: "oauth2",
            flows: { clientCredentials: { tokenUrl: "/v1/oauth/token", scopes: Object.fromEntries(SCOPES.map((k) => [k, SCOPE_LABELS[k]])) } },
          },
          staffToken: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Token sesi staf konsol." },
          patientToken: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Token sesi pasien." },
          cronSecret: { type: "http", scheme: "bearer", description: "CRON_SECRET untuk dispatcher." },
        },
      },
    },
    transform: (arg) => {
      const r = jsonSchemaTransform(arg);
      const sch = r.schema as { tags?: string[] } | undefined;
      if (sch && !sch.tags) sch.tags = [arg.url.split("/")[2] ?? "umum"];
      return r;
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs", staticCSP: true, uiConfig: { docExpansion: "list", deepLinking: false } });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  await app.register(clinicRoutes, { db });
  await app.register(authRoutes, { ctx });
  await app.register(consentRoutes, { ctx });
  await app.register(assessmentRoutes, { ctx });
  await app.register(programRoutes, { db });
  await app.register(consultationRoutes, { ctx, llm });
  await app.register(staffRoutes, { ctx });
  await app.register(clinicalRoutes, { ctx, storage: files });
  await app.register(planRoutes, { ctx, llm });
  await app.register(settingsRoutes, { ctx, storage: files, llmAvailable: () => Boolean(provider || anthropicApiKey) });
  await app.register(progressRoutes, { ctx });
  await app.register(integrationRoutes, { ctx, fetchFn, rateLimit, cronSecret, encryptionKey: encKey });

  return app;
}
