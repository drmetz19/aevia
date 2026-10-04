import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { clinics, clinicSettings } from "./schema";

export async function seed({ db }: Pick<Db, "db">) {
  await db
    .insert(clinics)
    .values([
      {
        slug: "drmetz",
        name: "DrMetz",
        tagline: "Aesthetic & Wellness Clinic",
        brandMode: "cobrand",
        colors: {},
        assistantName: "Sovia",
        assistantNameStatus: "approved",
      },
      {
        slug: "demo-partner",
        name: "Lumina Skin Studio",
        tagline: "Klinik kulit & kebugaran",
        brandMode: "whitelabel",
        colors: { primary: "#1F4D3F", accent: "#B5542F", dark: "#12302A", background: "#F5F7F3" },
        font: null,
        assistantName: "Luna",
        assistantNameStatus: "pending",
      },
    ])
    .onConflictDoUpdate({
      target: clinics.slug,
      set: {
        name: sql`excluded.name`,
        tagline: sql`excluded.tagline`,
        brandMode: sql`excluded.brand_mode`,
        colors: sql`excluded.colors`,
        assistantName: sql`excluded.assistant_name`,
        assistantNameStatus: sql`excluded.assistant_name_status`,
      },
    });
  const rows = await db.select().from(clinics);
  await db
    .insert(clinicSettings)
    .values(rows.map((c) => ({ clinicId: c.id, key: "welcome", value: { note: `Pengaturan ${c.slug}` } })))
    .onConflictDoNothing();
}
