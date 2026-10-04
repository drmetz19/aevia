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

  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url });
    db = drizzlePg(pool, { schema }) as unknown as DrizzleDb;
    run = async (text) => void (await pool.query(text));
    close = () => pool.end();
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
  }

  async function withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE aevia_app`);
      await tx.execute(sql`SELECT set_config('app.clinic_id', ${clinicId}, true)`);
      return fn(tx);
    });
  }

  return { db, withTenant, migrate, close, driver };
}
