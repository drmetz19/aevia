import { createDb, defaultPgliteDir } from "./client";

/** pnpm db:migrate — menjalankan migrasi SQL terhadap DATABASE_URL (Postgres/Supabase) atau PGlite lokal bila kosong. Idempoten. */
const url = process.env.DATABASE_URL || undefined;
const d = await createDb({ url, dataDir: url ? undefined : defaultPgliteDir() });
try {
  const before = (await d.db.execute(((await import("drizzle-orm")).sql)`SELECT to_regclass('public._migrations') AS t`)) as unknown as { rows: { t: string | null }[] };
  await d.migrate();
  const applied = (await d.db.execute(((await import("drizzle-orm")).sql)`SELECT name FROM _migrations ORDER BY name`)) as unknown as { rows: { name: string }[] };
  console.log(`Migrasi selesai (${d.driver}${url ? "" : ", lokal"}). ${applied.rows.length} migrasi tercatat; terakhir: ${applied.rows.at(-1)?.name ?? "-"}.${before.rows[0]?.t ? "" : " (database baru)"}`);
} catch (e) {
  console.error("Migrasi gagal:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await d.close();
}
