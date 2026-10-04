import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type DrizzleDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export interface Db {
  /** Koneksi pemilik (migrasi, seed, lookup brand publik). Jangan dipakai untuk data klinis. */
  db: DrizzleDb;
  /**
   * Transaksi koneksi pemilik untuk operasi lintas-tenant yang sah (admin platform, kredensial integrasi) yang tetap
   * menulis tabel ber-RLS. Konteks klinik dipasang agar kebijakan RLS lolos (pemilik juga terikat FORCE RLS di Postgres sungguhan).
   */
  ownerTx<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Jalankan fn di transaksi sebagai role aevia_app dengan konteks klinik (RLS berlaku). */
  withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
  driver: "pglite" | "pg";
}

export interface CreateDbOptions {
  /** URL Postgres. Kosong/undefined → PGlite. */
  url?: string;
  /** Folder data PGlite; undefined → in-memory (test). */
  dataDir?: string;
}

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(migrationsDir + name, "utf8") }));
}

export function defaultPgliteDir(): string {
  return process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pglite", import.meta.url));
}

export async function createDb(opts: CreateDbOptions = {}): Promise<Db> {
  let db: DrizzleDb;
  let run: (text: string) => Promise<void>;
  let close: () => Promise<void>;
  let driver: Db["driver"];

  // Verifikasi di Postgres sungguhan (non-superuser, RLS FORCE berlaku untuk pemilik):
  //   AEVIA_TEST_PG_URL=postgres://owner:pw@host:5432/postgres pnpm test
  // Setiap createDb() tanpa opsi membuat database sementara dan menghapusnya saat close().
  let dropAfter: (() => Promise<void>) | null = null;
  let url = opts.url;
  if (!url && opts.dataDir === undefined && process.env.AEVIA_TEST_PG_URL) {
    const base = new URL(process.env.AEVIA_TEST_PG_URL);
    const name = `aevia_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Pool({ connectionString: base.toString(), max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(base.toString());
    u.pathname = `/${name}`;
    url = u.toString();
    dropAfter = async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    };
  }

  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    db = drizzlePg(pool, { schema }) as unknown as DrizzleDb;
    run = async (text) => void (await pool.query(text));
    close = async () => {
      await pool.end();
      await dropAfter?.();
    };
    driver = "pg";
  } else {
    const client = new PGlite(opts.dataDir);
    await client.waitReady;
    db = drizzlePglite(client, { schema }) as unknown as DrizzleDb;
    run = async (text) => void (await client.exec(text));
    close = () => client.close();
    driver = "pglite";
  }

  async function migrate() {
    await run(
      "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = (await db.execute(sql`SELECT name FROM _migrations`)) as unknown as { rows: { name: string }[] };
    const applied = new Set(done.rows.map((r) => r.name));
    for (const m of loadMigrations()) {
      if (applied.has(m.name)) continue;
      const statements = m.sql.split("--> statement-breakpoint");
      for (const s of statements) if (s.trim()) await run(s);
      await db.execute(sql`INSERT INTO _migrations (name) VALUES (${m.name})`);
    }
    if (dropAfter) {
      // Mode uji Postgres sungguhan: longgarkan FORCE agar pemeriksaan test lewat pemilik dapat membaca semua baris.
      // Isolasi yang diuji tetap sama: kode aplikasi memakai role aevia_app (RLS berlaku penuh).
      const t = (await db.execute(sql`SELECT relname FROM pg_class WHERE relforcerowsecurity AND relnamespace = 'public'::regnamespace`)) as unknown as { rows: { relname: string }[] };
      for (const r of t.rows) await run(`ALTER TABLE "${r.relname}" NO FORCE ROW LEVEL SECURITY`);
    }
  }

  async function withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE aevia_app`);
      await tx.execute(sql`SELECT set_config('app.clinic_id', ${clinicId}, true)`);
      return fn(tx);
    });
  }

  async function ownerTx<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.clinic_id', ${clinicId}, true)`);
      return fn(tx);
    });
  }

  return { db, withTenant, ownerTx, migrate, close, driver };
}
