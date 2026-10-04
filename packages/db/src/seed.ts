import { sql } from "drizzle-orm";
import { DEFAULT_SKIN_PARAMETERS } from "@aevia/core";
import type { Db } from "./client";
import { clinics, clinicSettings, platformAdmins, programs, staff } from "./schema";

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
        colors: { primary: "#1F4D3F", accent: "#B5542F", background: "#F5F7F3", surface: "#FFFFFF" },
        font: null,
        assistantName: "Sovia",
        assistantNameStatus: "pending",
        pendingAssistantName: "Luna",
        assistantSubmittedAt: new Date("2026-09-01T09:00:00Z"),
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
        pendingAssistantName: sql`excluded.pending_assistant_name`,
        assistantSubmittedAt: sql`excluded.assistant_submitted_at`,
      },
    });
  const rows = await db.select().from(clinics);
  await db
    .insert(clinicSettings)
    .values([
      ...rows.map((c) => ({ clinicId: c.id, key: "welcome", value: { note: `Pengaturan ${c.slug}` } })),
      ...rows.map((c) => ({ clinicId: c.id, key: "skin_parameters", value: DEFAULT_SKIN_PARAMETERS })),
    ])
    .onConflictDoNothing();
  const id = (slug: string) => rows.find((c) => c.slug === slug)!.id;
  await db
    .insert(staff)
    .values([
      { clinicId: id("drmetz"), email: "dr.metz@drmetz.test", name: "dr. Metz", role: "professional" },
      { clinicId: id("drmetz"), email: "admin@drmetz.test", name: "Admin DrMetz", role: "clinic_admin" },
      { clinicId: id("demo-partner"), email: "admin@demo-partner.test", name: "Admin Lumina", role: "clinic_admin" },
    ])
    .onConflictDoNothing();
  await db.insert(platformAdmins).values({ email: "admin@aevia.test", name: "Admin Platform" }).onConflictDoNothing();
  // Harga placeholder, dapat diubah klinik (Phase 8).
  await db
    .insert(programs)
    .values([
      {
        clinicId: id("drmetz"),
        slug: "konsultasi-healthy-aging",
        name: "Konsultasi Healthy Aging",
        summary: "Sesi konsultasi dengan profesional untuk memahami kondisi Anda dan menyusun arah langkah berikutnya.",
        durationWeeks: null,
        priceIdr: 450000,
        includes: ["Telaah hasil assessment", "Konsultasi 1 sesi bersama profesional", "Ringkasan dan rencana personal"],
        sortOrder: 1,
      },
      {
        clinicId: id("drmetz"),
        slug: "pendampingan-kulit-8-minggu",
        name: "Program Pendampingan Kulit 8 Minggu",
        summary: "Pendampingan bertahap untuk kesehatan kulit, dengan tinjauan berkala bersama profesional.",
        durationWeeks: 8,
        priceIdr: 1850000,
        includes: ["Analisis kulit awal", "Rencana perawatan personal", "Check-in dan tinjauan berkala"],
        sortOrder: 2,
      },
      {
        clinicId: id("drmetz"),
        slug: "komposisi-tubuh-12-minggu",
        name: "Program Komposisi Tubuh 12 Minggu",
        summary: "Pendampingan bertahap untuk pola makan, aktivitas, dan komposisi tubuh yang lebih seimbang.",
        durationWeeks: 12,
        priceIdr: 2950000,
        includes: ["Pemeriksaan komposisi tubuh awal", "Rencana nutrisi dan aktivitas", "Tinjauan progres berkala"],
        sortOrder: 3,
      },
      {
        clinicId: id("demo-partner"),
        slug: "konsultasi-awal",
        name: "Konsultasi Awal",
        summary: "Sesi pengenalan bersama profesional Lumina Skin Studio.",
        durationWeeks: null,
        priceIdr: 300000,
        includes: ["Telaah kondisi kulit", "Rencana langkah awal"],
        sortOrder: 1,
      },
    ])
    .onConflictDoNothing();
}
