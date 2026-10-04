import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { clinics } from "./schema";

/** Direktori brand (tanpa RLS): dipakai sebelum konteks tenant diketahui. */
export async function findClinicBySlug({ db }: Pick<Db, "db">, slug: string) {
  const [c] = await db.select().from(clinics).where(eq(clinics.slug, slug)).limit(1);
  return c ?? null;
}
