import type { IncomingMessage, ServerResponse } from "node:http";
import { createDb } from "@aevia/db";
import { buildApp } from "../src/app";

/**
 * Vercel Function untuk seluruh API (semua path dialihkan ke sini lewat vercel.json).
 * App dibuat sekali per instance; migrasi TIDAK dijalankan di sini (jalankan `pnpm db:migrate` saat deploy).
 */
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
