import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
  customDomainVerified: boolean("custom_domain_verified").notNull().default(false),
  logoKey: text("logo_key"),
  avatarKey: text("avatar_key"),
  pendingAssistantName: text("pending_assistant_name"),
  pendingAvatarKey: text("pending_avatar_key"),
  assistantReviewNote: text("assistant_review_note"),
  assistantSubmittedAt: timestamp("assistant_submitted_at", { withTimezone: true }),
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

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    globalSubjectId: uuid("global_subject_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clinicId, t.email)],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["assessment", "medical_record", "photos", "external_context"] }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.patientId, t.scope)],
);

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["professional", "clinic_admin"] }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type", { enum: ["patient", "staff"] }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["in_progress", "completed"] }).notNull().default("in_progress"),
  flagged: boolean("flagged").notNull().default(false),
  result: jsonb("result").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const assessmentAnswers = pgTable(
  "assessment_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: integer("value"),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.assessmentId, t.questionId)],
);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    durationWeeks: integer("duration_weeks"),
    priceIdr: integer("price_idr"),
    includes: jsonb("includes").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clinicId, t.slug)],
);

export const consultationRequests = pgTable("consultation_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  programId: uuid("program_id").notNull().references(() => programs.id),
  assessmentId: uuid("assessment_id").references(() => assessments.id),
  prep: jsonb("prep").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["submitted", "accepted", "declined"] }).notNull().default("submitted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const consultations = pgTable("consultations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull().unique().references(() => consultationRequests.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  professionalId: uuid("professional_id").notNull().references(() => staff.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  meetingUrl: text("meeting_url").notNull(),
  status: text("status", { enum: ["scheduled", "completed", "no_show", "cancelled"] }).notNull().default("scheduled"),
  externalRef: text("external_ref"),
  paymentStatus: text("payment_status", { enum: ["paid", "unpaid"] }),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const soapNotes = pgTable("soap_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  consultationId: uuid("consultation_id").notNull().unique().references(() => consultations.id, { onDelete: "cascade" }),
  subjective: text("subjective").notNull().default(""),
  objective: text("objective").notNull().default(""),
  assessment: text("assessment").notNull().default(""),
  plan: text("plan").notNull().default(""),
  updatedBy: uuid("updated_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skinAnalyses = pgTable("skin_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  consultationId: uuid("consultation_id").notNull().unique().references(() => consultations.id, { onDelete: "cascade" }),
  scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
  notes: text("notes").notNull().default(""),
  updatedBy: uuid("updated_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skinPhotos = pgTable("skin_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  angle: text("angle", { enum: ["front", "left", "right", "other"] }).notNull().default("front"),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  annotations: jsonb("annotations").$type<unknown[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  actorType: text("actor_type", { enum: ["staff", "patient", "system", "api", "mcp"] }).notNull(),
  actorId: uuid("actor_id"),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before").$type<unknown>(),
  after: jsonb("after").$type<unknown>(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const prescriptions = pgTable("prescriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "issued", "superseded"] }).notNull().default("draft"),
  items: jsonb("items").$type<unknown[]>().notNull().default([]),
  issuedBy: uuid("issued_by").references(() => staff.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const carePlans = pgTable("care_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "signed", "superseded"] }).notNull().default("draft"),
  content: jsonb("content").$type<unknown>().notNull().default({}),
  summary: jsonb("summary").$type<unknown>().notNull().default({}),
  signedBy: uuid("signed_by").references(() => staff.id),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signatureHash: text("signature_hash"),
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkins = pgTable("checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  carePlanId: uuid("care_plan_id").references(() => carePlans.id),
  values: jsonb("values").$type<Record<string, number>>().notNull().default({}),
  note: text("note"),
  mood: integer("mood"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["checkin", "review", "plan"] }).notNull(),
  message: text("message").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mode: text("mode", { enum: ["live", "test"] }).notNull().default("live"),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default([]),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  clientId: text("client_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const clinicConnectors = pgTable(
  "clinic_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["kliniksistem", "beautycode"] }).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clinicId, t.kind)],
);

export const connectorDeliveries = pgTable(
  "connector_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => clinicConnectors.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    externalRef: text("external_ref"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.eventId, t.connectorId)],
);

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clinicId, t.source, t.eventId)],
);

export const externalContext = pgTable("external_context", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["beautycode"] }).notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
