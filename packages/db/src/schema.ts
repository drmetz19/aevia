import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const clinics = pgTable("clinics", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  brandMode: text("brand_mode", { enum: ["cobrand", "whitelabel"] }).notNull().default("cobrand"),
  logoUrl: text("logo_url"),
  colors: jsonb("colors").$type<Record<string, string>>().notNull().default({}),
  font: text("font"),
  assistantName: text("assistant_name").notNull().default("Sovia"),
  assistantNameStatus: text("assistant_name_status", { enum: ["pending", "approved", "rejected"] })
    .notNull()
    .default("approved"),
  avatarUrl: text("avatar_url"),
  customDomain: text("custom_domain").unique(),
  llmEnabled: boolean("llm_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clinicSettings = pgTable(
  "clinic_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clinicId, t.key)],
);
