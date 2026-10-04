import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { clinics, clinicSettings, consents, events, patients } from "./schema";
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
    expect(await d.withTenant(b, (tx) => tx.select().from(events))).toEqual([]);
    expect((await d.withTenant(a, (tx) => tx.select().from(events))).length).toBe(1);
  });
});
