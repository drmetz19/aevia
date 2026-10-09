import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@aevia/db";
import { buildApp } from "./app";

/**
 * Vercel Function untuk seluruh API (semua path dialihkan ke sini lewat vercel.json).
 * App dibuat sekali per instance; migrasi TIDAK dijalankan di sini (jalankan `pnpm db:migrate` saat deploy).
 */
// Di bundel Vercel, aset Swagger UI disalin ke ./static di samping file ini (lihat scripts/build-vercel.mjs).
const bundledStatic = join(dirname(fileURLToPath(import.meta.url)), "static");
if (!process.env.SWAGGER_UI_STATIC_DIR && existsSync(join(bundledStatic, "index.html"))) process.env.SWAGGER_UI_STATIC_DIR = bundledStatic;

let ready: ReturnType<typeof boot> | null = null;
async function boot() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL wajib diisi.");
  const app = await buildApp({ db: await createDb({ url }) });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= boot().catch((e) => {
    ready = null;
    throw e;
  });
  const app = await ready;
  app.server.emit("request", req, res);
}
