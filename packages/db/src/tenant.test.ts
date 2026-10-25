import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { clinics, clinicSettings, consents, events, patients, programs, auditLogs, checkins, reminders } from "./schema";
import { seed } from "./seed";

let d: Db;
let a: string;
let b: string;

beforeAll(async () => {
  d = await createDb();
  await d.migrate();
  await seed(d);
  const rows = await d.db.select().from(clinics);
  a = rows.find((r) => r.slug === "drmetz")!.id;
  b = rows.find((r) => r.slug === "demo-partner")!.id;
});
afterAll(() => d.close());

describe("isolasi tenant (RLS, role aevia_app)", () => {
  it("konteks klinik A hanya membaca baris A", async () => {
    const rows = await d.withTenant(a, (tx) => tx.select().from(clinicSettings));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clinicId === a)).toBe(true);
  });

  it("konteks klinik A tidak bisa membaca baris klinik B", async () => {
    const rows = await d.withTenant(a, (tx) =>
      tx.select().from(clinicSettings).where(eq(clinicSettings.clinicId, b)),
    );
    expect(rows).toEqual([]);
  });

  it("konteks klinik A tidak bisa menulis baris untuk klinik B", async () => {
    await expect(
      d.withTenant(a, (tx) => tx.insert(clinicSettings).values({ clinicId: b, key: "x", value: {} })),
    ).rejects.toThrow();
  });

  it("tanpa konteks klinik tidak ada baris yang terbaca", async () => {
    const rows = await d.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE aevia_app`);
      return tx.select().from(clinicSettings);
    });
    expect(rows).toEqual([]);
  });

  it("role aktif benar-benar aevia_app non-superuser, dan kembali normal setelah transaksi", async () => {
    const inTx = await d.withTenant(a, async (tx) => {
      const r = (await tx.execute(
        sql`SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`,
      )) as unknown as { rows: { u: string; su: boolean }[] };
      return r.rows[0];
    });
    expect(inTx).toEqual({ u: "aevia_app", su: false });
    const after = (await d.db.execute(sql`SELECT current_user AS u`)) as unknown as { rows: { u: string }[] };
    expect(after.rows[0]?.u).not.toBe("aevia_app");
  });

  it("patients & consents ikut terisolasi; email sama boleh di dua klinik", async () => {
    const pa = await d.withTenant(a, (tx) => tx.insert(patients).values({ clinicId: a, email: "x@y.test" }).returning());
    const pb = await d.withTenant(b, (tx) => tx.insert(patients).values({ clinicId: b, email: "x@y.test" }).returning());
    expect(pa[0]!.id).not.toBe(pb[0]!.id);
    await d.withTenant(a, (tx) => tx.insert(consents).values({ clinicId: a, patientId: pa[0]!.id, scope: "photos", grantedAt: new Date() }));
    expect(await d.withTenant(b, (tx) => tx.select().from(consents))).toEqual([]);
    const seenByB = await d.withTenant(b, (tx) => tx.select().from(patients));
    expect(seenByB.every((p) => p.clinicId === b)).toBe(true);
  });

  it("outbox events terisolasi per klinik", async () => {
    await d.withTenant(a, (tx) => tx.insert(events).values({ clinicId: a, type: "assessment.completed" }));
    expect((await d.withTenant(b, (tx) => tx.select().from(events))).filter((e) => e.clinicId !== b)).toEqual([]);
    // pendaftaran pasien di test sebelumnya juga memancarkan contact.created (trigger CRM) di kedua klinik
    expect((await d.withTenant(a, (tx) => tx.select().from(events))).filter((e) => e.type === "assessment.completed").length).toBe(1);
  });

  it("programs terisolasi per klinik", async () => {
    const seenByA = await d.withTenant(a, (tx) => tx.select().from(programs));
    expect(seenByA.length).toBe(3);
    expect(seenByA.every((p) => p.clinicId === a)).toBe(true);
    expect((await d.withTenant(b, (tx) => tx.select().from(programs))).map((p) => p.slug)).toEqual(["konsultasi-awal"]);
  });

  it("audit_logs terisolasi dan append-only", async () => {
    await d.withTenant(a, (tx) => tx.insert(auditLogs).values({ clinicId: a, actorType: "system", entity: "x", entityId: a, action: "t" }));
    expect(await d.withTenant(b, (tx) => tx.select().from(auditLogs))).toEqual([]);
    await expect(d.withTenant(a, (tx) => tx.delete(auditLogs))).rejects.toThrow();
  });

  it("checkins & reminders terisolasi per klinik", async () => {
    const [pa] = await d.withTenant(a, (tx) => tx.select().from(patients).limit(1));
    const patientId = pa?.id ?? (await d.withTenant(a, (tx) => tx.insert(patients).values({ clinicId: a, email: "ci@y.test" }).returning()))[0]!.id;
    await d.withTenant(a, (tx) => tx.insert(checkins).values({ clinicId: a, patientId, values: { tidur: 3 } }));
    await d.withTenant(a, (tx) => tx.insert(reminders).values({ clinicId: a, patientId, kind: "checkin", message: "m", dueAt: new Date() }));
    expect(await d.withTenant(b, (tx) => tx.select().from(checkins))).toEqual([]);
    expect(await d.withTenant(b, (tx) => tx.select().from(reminders))).toEqual([]);
    await expect(d.withTenant(a, (tx) => tx.delete(checkins))).rejects.toThrow();
  });
});

describe("temuan Supabase advisor (0016)", () => {
  it("semua kebijakan tenant_isolation membungkus current_setting dalam subquery; fungsi guard punya search_path tetap", async () => {
    const pol = (await d.db.execute(sql`SELECT tablename, qual, with_check FROM pg_policies WHERE policyname = 'tenant_isolation'`)) as unknown as { rows: { tablename: string; qual: string; with_check: string }[] };
    expect(pol.rows.length).toBeGreaterThanOrEqual(25);
    for (const r of pol.rows) {
      expect(r.qual, r.tablename).toMatch(/\(\s*SELECT\s+\(?NULLIF\(current_setting/i);
      expect(r.with_check, r.tablename).toMatch(/\(\s*SELECT\s+\(?NULLIF\(current_setting/i);
    }
    const fn = (await d.db.execute(sql`SELECT proconfig FROM pg_proc WHERE proname = 'aevia_guard_immutable'`)) as unknown as { rows: { proconfig: string[] | null }[] };
    expect(fn.rows[0]?.proconfig?.some((c) => c.startsWith("search_path="))).toBe(true);
  });
});

describe("runner migrasi", () => {
  it("baris _migrations tanpa akhiran .sql dianggap sudah terpasang (tidak dijalankan ulang)", async () => {
    const m = await createDb();
    try {
      const names = async () => ((await m.db.execute(sql`SELECT name FROM _migrations`)) as unknown as { rows: { name: string }[] }).rows.map((r) => r.name);
      await m.migrate();
      const total = (await names()).length;
      await m.db.execute(sql`UPDATE _migrations SET name = regexp_replace(name, '\\.sql$', '')`);
      await m.migrate();
      const after = await names();
      expect(after.length).toBe(total);
      expect(after.filter((n) => n.endsWith(".sql"))).toEqual([]);
    } finally {
      await m.close();
    }
  }, 60_000);
});

describe("harga & akses program (0017)", () => {
  it("default amount/open; nilai di luar daftar ditolak; SQL migrasi aman diulang", async () => {
    const row = (await d.withTenant(b, (tx) => tx.select().from(programs)))[0]!;
    expect(row).toMatchObject({ priceMode: "amount", access: "open" });
    const seeded = await d.withTenant(a, (tx) => tx.select().from(programs).where(eq(programs.slug, "pendampingan-kulit-8-minggu")));
    expect(seeded[0]).toMatchObject({ priceMode: "coming_soon", access: "voucher" });
    await expect(d.db.execute(sql`UPDATE programs SET price_mode = 'gratis' WHERE id = ${row.id}`)).rejects.toThrow();
    await expect(d.db.execute(sql`UPDATE programs SET access = 'rahasia' WHERE id = ${row.id}`)).rejects.toThrow();
    const { readFileSync } = await import("node:fs");
    const ddl = readFileSync(new URL("../migrations/0017_program_pricing.sql", import.meta.url), "utf8");
    for (const stmt of ddl.split("--> statement-breakpoint")) await d.db.execute(sql.raw(stmt));
  });
});
