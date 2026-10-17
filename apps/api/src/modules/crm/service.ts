import { and, asc, eq, gt, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { LEAD_STAGES, LEAD_STAGE_INFO, type ContactView, type LeadStage, type contactListQuerySchema, type contactStageChangeSchema, type contactUpdateSchema, type contactUpsertSchema, type funnelQuerySchema } from "@aevia/core";
import { contactStageHistory, contacts, events, staff, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import type { Integration } from "../integrations/auth";

type Ctx = { db: Db; who: Integration; now: Date };
type Row = typeof contacts.$inferSelect;
const NOT_FOUND = "Kontak ini belum ditemukan di klinik Anda.";

const view = (c: Row): ContactView => ({
  id: c.id,
  patient_id: c.patientId,
  name: c.name,
  email: c.email,
  phone: c.phone,
  source: c.source,
  source_detail: c.sourceDetail,
  utm: c.utm,
  tags: c.tags,
  notes: c.notes,
  owner_staff_id: c.ownerStaffId,
  value_idr: c.valueIdr,
  external_source: c.externalSource,
  external_ref: c.externalRef,
  stage: c.stage,
  stage_label: LEAD_STAGE_INFO[c.stage].label,
  sales_phase: LEAD_STAGE_INFO[c.stage].sales_phase,
  stage_changed_at: c.stageChangedAt.toISOString(),
  lost_reason: c.lostReason,
  created_at: c.createdAt.toISOString(),
  updated_at: c.updatedAt.toISOString(),
});

/** Setiap panggilan tercatat seperti route integrasi lain: actor_type=api|mcp, `via`=penanda kredensial. Tanpa PII di audit. */
const audit = (tx: Tx, c: Ctx, entityId: string, action: string, before: unknown = null, after: Record<string, unknown> = {}) =>
  writeAudit(tx, { clinicId: c.who.clinicId, actorType: c.who.actor, actorId: c.who.id, entity: "contact", entityId, action, before, after: { via: c.who.label, ...after }, at: c.now });

const emit = (tx: Tx, c: Ctx, type: "contact.created" | "contact.updated" | "contact.stage_changed", payload: Record<string, unknown>) =>
  tx.insert(events).values({ clinicId: c.who.clinicId, type, payload, createdAt: c.now });

async function load(tx: Tx, id: string) {
  const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new AuthError(404, "contact_not_found", NOT_FOUND);
  return row;
}

async function requireOwner(tx: Tx, staffId: string | null | undefined) {
  if (!staffId) return;
  const [s] = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.id, staffId), eq(staff.active, true)));
  if (!s) throw new AuthError(400, "owner_not_found", "Staf penanggung jawab belum ditemukan atau tidak aktif di klinik ini.");
}

/** Email/telepon unik per klinik: tolak bila sudah dipakai kontak lain (beri tahu id-nya agar CRM bisa menggabungkan). */
async function requireUnique(tx: Tx, selfId: string | null, email?: string | null, phone?: string | null) {
  const conds = [email ? eq(contacts.email, email) : undefined, phone ? eq(contacts.phone, phone) : undefined].filter(Boolean) as SQL[];
  if (!conds.length) return;
  const [other] = await tx.select({ id: contacts.id }).from(contacts).where(and(or(...conds), selfId ? ne(contacts.id, selfId) : undefined));
  if (other) throw new AuthError(409, "contact_conflict", "Email atau nomor telepon ini sudah dipakai kontak lain di klinik Anda.", { contact_id: other.id });
}

type Fields = Partial<z.infer<typeof contactUpdateSchema>>;
function patch(b: Fields): Partial<typeof contacts.$inferInsert> {
  const has = (k: keyof Fields) => b[k] !== undefined;
  return {
    ...(has("name") ? { name: b.name } : {}),
    ...(has("email") ? { email: b.email } : {}),
    ...(has("phone") ? { phone: b.phone } : {}),
    ...(has("source") ? { source: b.source } : {}),
    ...(has("source_detail") ? { sourceDetail: b.source_detail } : {}),
    ...(has("utm") ? { utm: Object.fromEntries(Object.entries(b.utm!).filter(([, v]) => v)) as Record<string, string> } : {}),
    ...(has("tags") ? { tags: b.tags } : {}),
    ...(has("notes") ? { notes: b.notes } : {}),
    ...(has("owner_staff_id") ? { ownerStaffId: b.owner_staff_id } : {}),
    ...(has("value_idr") ? { valueIdr: b.value_idr } : {}),
    ...(has("external_source") ? { externalSource: b.external_source } : {}),
    ...(has("external_ref") ? { externalRef: b.external_ref } : {}),
  };
}
const changedKeys = (p: Record<string, unknown>) => Object.keys(p).sort();

/**
 * Upsert dari CRM. Dicocokkan berurutan: (external_source, external_ref) → email → telepon.
 * Kontak baru mulai di fase `new` (atau `contacted`); kontak yang sudah ada tidak diubah fasenya di sini.
 */
export async function upsertContact(c: Ctx, body: z.infer<typeof contactUpsertSchema>) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await requireOwner(tx, body.owner_staff_id);
    const byRef = body.external_ref ? (await tx.select().from(contacts).where(and(eq(contacts.externalSource, body.external_source!), eq(contacts.externalRef, body.external_ref))))[0] : undefined;
    const byEmail = !byRef && body.email ? (await tx.select().from(contacts).where(eq(contacts.email, body.email)))[0] : undefined;
    const byPhone = !byRef && !byEmail && body.phone ? (await tx.select().from(contacts).where(eq(contacts.phone, body.phone)))[0] : undefined;
    const existing = byRef ?? byEmail ?? byPhone;
    const { stage: initial, ...fields } = body;

    if (existing) {
      await requireUnique(tx, existing.id, body.email, body.phone);
      const p = patch(fields);
      const [row] = await tx.update(contacts).set({ ...p, updatedAt: c.now }).where(eq(contacts.id, existing.id)).returning();
      await audit(tx, c, existing.id, "integration.contact.update", null, { matched_by: byRef ? "external_ref" : byEmail ? "email" : "phone", fields: changedKeys(p) });
      await emit(tx, c, "contact.updated", { contact_id: existing.id, patient_id: existing.patientId });
      return { created: false, contact: view(row!) };
    }

    await requireUnique(tx, null, body.email, body.phone);
    const stage: LeadStage = initial ?? "new";
    const [row] = await tx
      .insert(contacts)
      .values({ clinicId: c.who.clinicId, ...patch(fields), source: body.source ?? "other", stage, stageChangedAt: c.now, createdAt: c.now, updatedAt: c.now })
      .returning();
    await tx.insert(contactStageHistory).values({ clinicId: c.who.clinicId, contactId: row!.id, fromStage: null, toStage: stage, mode: "manual", trigger: c.who.label, actorType: c.who.actor, actorId: c.who.id, at: c.now });
    await audit(tx, c, row!.id, "integration.contact.create", null, { stage, source: row!.source });
    await emit(tx, c, "contact.created", { contact_id: row!.id, stage });
    return { created: true, contact: view(row!) };
  });
}

export async function getContact(c: Ctx, id: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const row = await load(tx, id);
    await audit(tx, c, id, "integration.contact.read");
    return view(row);
  });
}

export async function updateContact(c: Ctx, id: string, body: z.infer<typeof contactUpdateSchema>) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const before = await load(tx, id);
    await requireOwner(tx, body.owner_staff_id);
    await requireUnique(tx, id, body.email, body.phone);
    if (body.external_ref && !(body.external_source ?? before.externalSource)) {
      throw new AuthError(400, "bad_request", "external_source wajib diisi bila external_ref diisi.");
    }
    const p = patch(body);
    const [row] = await tx.update(contacts).set({ ...p, updatedAt: c.now }).where(eq(contacts.id, id)).returning();
    await audit(tx, c, id, "integration.contact.update", null, { fields: changedKeys(p) });
    await emit(tx, c, "contact.updated", { contact_id: id, patient_id: before.patientId });
    return view(row!);
  });
}

/** Pindah fase manual (tim sales). Boleh maju, mundur (koreksi), atau `lost` dengan alasan. Tercatat di riwayat. */
export async function changeStage(c: Ctx, id: string, body: z.infer<typeof contactStageChangeSchema>) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const before = await load(tx, id);
    if (before.stage === body.stage && (body.stage !== "lost" || before.lostReason === body.lost_reason)) return view(before);
    const lostReason = body.stage === "lost" ? body.lost_reason! : null;
    const [row] = await tx.update(contacts).set({ stage: body.stage, lostReason, stageChangedAt: c.now, updatedAt: c.now }).where(eq(contacts.id, id)).returning();
    await tx.insert(contactStageHistory).values({
      clinicId: c.who.clinicId,
      contactId: id,
      fromStage: before.stage,
      toStage: body.stage,
      mode: "manual",
      trigger: c.who.label,
      reason: body.stage === "lost" ? lostReason : (body.reason ?? null),
      actorType: c.who.actor,
      actorId: c.who.id,
      at: c.now,
    });
    await audit(tx, c, id, "integration.contact.stage", { stage: before.stage }, { stage: body.stage });
    await emit(tx, c, "contact.stage_changed", { contact_id: id, patient_id: before.patientId, stage: body.stage, previous_stage: before.stage, mode: "manual" });
    return view(row!);
  });
}

export async function stageHistory(c: Ctx, id: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    await load(tx, id);
    const rows = await tx.select().from(contactStageHistory).where(eq(contactStageHistory.contactId, id)).orderBy(asc(contactStageHistory.at), asc(contactStageHistory.id));
    await audit(tx, c, id, "integration.contact.read.stages");
    return {
      history: rows.map((h) => ({ id: h.id, from_stage: h.fromStage as LeadStage | null, to_stage: h.toStage as LeadStage, mode: h.mode, trigger: h.trigger, reason: h.reason, at: h.at.toISOString() })),
    };
  });
}

/** Hanya kontak yang belum punya akun pasien yang boleh dihapus (lead mentah dari CRM). */
export async function deleteContact(c: Ctx, id: string) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const row = await load(tx, id);
    if (row.patientId) throw new AuthError(409, "contact_linked", "Kontak ini sudah tertaut ke akun pasien sehingga tidak dapat dihapus. Tandai sebagai lost bila tidak lanjut.");
    await tx.delete(contacts).where(eq(contacts.id, id));
    await audit(tx, c, id, "integration.contact.delete", { stage: row.stage }, {});
  });
}

// ---------- daftar + sinkron inkremental ----------
const encodeCursor = (r: Row) => Buffer.from(JSON.stringify([r.updatedAt.toISOString(), r.id])).toString("base64url");
function decodeCursor(raw: string): [Date, string] {
  try {
    const [t, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [string, string];
    const d = new Date(t);
    if (Number.isNaN(d.getTime()) || typeof id !== "string") throw new Error();
    return [d, id];
  } catch {
    throw new AuthError(400, "bad_cursor", "Cursor halaman tidak valid. Mulai lagi tanpa cursor.");
  }
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Urut updated_at naik (lalu id): aman untuk sinkron inkremental — simpan updated_at terakhir, kirim sebagai updated_since. */
export async function listContacts(c: Ctx, q: z.infer<typeof contactListQuerySchema>) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const conds: (SQL | undefined)[] = [
      q.stage?.length ? inArray(contacts.stage, q.stage) : undefined,
      q.source ? eq(contacts.source, q.source) : undefined,
      q.owner_staff_id ? eq(contacts.ownerStaffId, q.owner_staff_id) : undefined,
      q.tag ? sql`${contacts.tags} @> ARRAY[${q.tag}]::text[]` : undefined,
      q.updated_since ? gte(contacts.updatedAt, new Date(q.updated_since)) : undefined,
    ];
    if (q.q) {
      const pat = `%${likeEscape(q.q)}%`;
      const digits = q.q.replace(/\D/g, "");
      conds.push(or(ilike(contacts.name, pat), ilike(contacts.email, pat), digits.length >= 4 ? ilike(contacts.phone, `%${digits.replace(/^0/, "")}%`) : undefined));
    }
    if (q.cursor) {
      const [t, id] = decodeCursor(q.cursor);
      conds.push(or(gt(contacts.updatedAt, t), and(eq(contacts.updatedAt, t), gt(contacts.id, id))));
    }
    const rows = await tx.select().from(contacts).where(and(...conds)).orderBy(asc(contacts.updatedAt), asc(contacts.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    await audit(tx, c, c.who.id, "integration.contact.list", null, { count: page.length });
    return { contacts: page.map(view), next_cursor: rows.length > q.limit ? encodeCursor(page.at(-1)!) : null };
  });
}

// ---------- funnel ----------
const FUNNEL = LEAD_STAGES.filter((s) => s !== "lost");

/** Funnel kohort: kontak yang dibuat dalam rentang. `reached` memakai fase tertinggi yang pernah dicapai (riwayat). */
export async function funnel(c: Ctx, q: z.infer<typeof funnelQuerySchema>) {
  return c.db.withTenant(c.who.clinicId, async (tx) => {
    const rows = await tx
      .select({
        stage: contacts.stage,
        best: sql<number>`coalesce(max(aevia_lead_stage_rank(${contactStageHistory.toStage})), 0)`.mapWith(Number),
      })
      .from(contacts)
      .leftJoin(contactStageHistory, eq(contactStageHistory.contactId, contacts.id))
      .where(and(q.from ? gte(contacts.createdAt, new Date(q.from)) : undefined, q.to ? lte(contacts.createdAt, new Date(q.to)) : undefined))
      .groupBy(contacts.id, contacts.stage);
    await audit(tx, c, c.who.id, "integration.contact.funnel", null, { total: rows.length });
    let prev: number | null = null;
    const stages = FUNNEL.map((s) => {
      const info = LEAD_STAGE_INFO[s];
      const best = (r: (typeof rows)[number]) => Math.max(r.best, LEAD_STAGE_INFO[r.stage].rank);
      const reached = rows.filter((r) => best(r) >= info.rank).length;
      const conversion_pct = prev === null ? null : prev === 0 ? 0 : Math.round((reached / prev) * 1000) / 10;
      prev = reached;
      return { stage: s, label: info.label, sales_phase: info.sales_phase, current: rows.filter((r) => r.stage === s).length, reached, conversion_pct };
    });
    return { total: rows.length, lost: rows.filter((r) => r.stage === "lost").length, stages };
  });
}
