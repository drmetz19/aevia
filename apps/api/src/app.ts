import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "@aevia/db";
import { clinicRoutes } from "./modules/clinics/routes";

export interface AppDeps {
  db: Db;
}

/** Dipakai server lokal dan (nanti) Vercel Function: tidak membuka port di sini. */
export async function buildApp({ db }: AppDeps) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: { info: { title: "AEVIA API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  await app.register(clinicRoutes, { db });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: "not_found", message: "Halaman yang Anda cari belum ditemukan." }),
  );
  app.setErrorHandler((err: { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "bad_request", message: "Data yang dikirim belum sesuai. Mohon periksa kembali." });
    }
    return reply.code(err.statusCode ?? 500).send({
      error: "server_error",
      message: "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.",
    });
  });
  return app;
}
