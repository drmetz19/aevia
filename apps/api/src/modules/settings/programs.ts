import { asc, eq } from "drizzle-orm";
import { programInputSchema, type StaffProgram } from "@aevia/core";
import { consultationRequests, programs, writeAudit, type Db, type Tx } from "@aevia/db";
import type { z } from "zod";
import { AuthError } from "../auth/otp";

type Input = z.infer<typeof programInputSchema>;
type Ctx = { db: Db; clinicId: string; actorId: string; now: Date };
type Row = typeof programs.$inferSelect;

const view = (p: Row): StaffProgram => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  summary: p.summary,
  duration_weeks: p.durationWeeks,
  price_idr: p.priceIdr,
  includes: p.includes,
  active: p.active,
});
const snap = (p: Row | Input) =>
  "durationWeeks" in p
    ? { name: p.name, summary: p.summary, duration_weeks: p.durationWeeks, price_idr: p.priceIdr, includes: p.includes, active: p.active }
    : { name: p.name, summary: p.summary, duration_weeks: p.duration_weeks, price_idr: p.price_idr, includes: p.includes, active: p.active };
const audit = (tx: Tx, c: Ctx, id: string, action: string, before: unknown, after: unknown) =>
  writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "program", entityId: id, action, before, after, at: c.now });
const notFound = () => new AuthError(404, "program_not_found", "Program ini belum ditemukan di klinik Anda.");

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "program";

export async function listPrograms(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => (await tx.select().from(programs).orderBy(asc(programs.sortOrder), asc(programs.createdAt))).map(view));
}

export async function createProgram(c: Ctx, body: Input) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const all = await tx.select({ slug: programs.slug, sort: programs.sortOrder }).from(programs);
    const taken = new Set(all.map((x) => x.slug));
    const base = slugify(body.name);
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    const [row] = await tx
      .insert(programs)
      .values({
        clinicId: c.clinicId,
        slug,
        name: body.name,
        summary: body.summary,
        durationWeeks: body.duration_weeks,
        priceIdr: body.price_idr,
        includes: body.includes,
        active: body.active,
        sortOrder: Math.max(0, ...all.map((x) => x.sort)) + 1,
        createdAt: c.now,
      })
      .returning();
    await audit(tx, c, row!.id, "program.create", null, snap(body));
    return view(row!);
  });
}

export async function updateProgram(c: Ctx, id: string, body: Input) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(programs).where(eq(programs.id, id));
    if (!before) throw notFound();
    const [row] = await tx
      .update(programs)
      .set({ name: body.name, summary: body.summary, durationWeeks: body.duration_weeks, priceIdr: body.price_idr, includes: body.includes, active: body.active })
      .where(eq(programs.id, id))
      .returning();
    await audit(tx, c, id, "program.update", snap(before), snap(body));
    return view(row!);
  });
}

export async function deleteProgram(c: Ctx, id: string) {
  await c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(programs).where(eq(programs.id, id));
    if (!before) throw notFound();
    const [used] = await tx.select({ id: consultationRequests.id }).from(consultationRequests).where(eq(consultationRequests.programId, id)).limit(1);
    if (used) throw new AuthError(409, "program_in_use", "Program ini sudah dipakai permintaan konsultasi, jadi tidak dapat dihapus. Nonaktifkan saja agar tidak tampil di katalog.");
    await tx.delete(programs).where(eq(programs.id, id));
    await audit(tx, c, id, "program.delete", snap(before), null);
  });
}
