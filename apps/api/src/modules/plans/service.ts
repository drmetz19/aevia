import { createHash } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  explainPlan,
  planContentSchema,
  prescriptionItemSchema,
  signaturePayload,
  summarySchema,
  type PatientPlan,
  type PlanContent,
  type PlanSummary,
  type PlanView,
  type PrescriptionItem,
  type PrescriptionView,
} from "@aevia/core";
import { carePlans, clinics, consultations, events, prescriptions, staff, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { remindersAfterSign } from "../progress/service";

export type Ctx = { db: Db; clinicId: string; staffId: string; now: Date };

const audit = (tx: Tx, c: Ctx, entity: string, entityId: string, action: string, before: unknown, after: unknown) =>
  writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.staffId, entity, entityId, action, before, after, at: c.now });

async function consultationOf(tx: Tx, id: string) {
  const [k] = await tx.select().from(consultations).where(eq(consultations.id, id));
  if (!k) throw new AuthError(404, "consultation_not_found", "Konsultasi ini belum ditemukan di klinik Anda.");
  return k;
}

const staffName = async (tx: Tx, id: string | null) => {
  if (!id) return null;
  const [s] = await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, id));
  return s?.name ?? null;
};

// ---------- Resep ----------
type RxRow = typeof prescriptions.$inferSelect;
const rxItems = (r: RxRow): PrescriptionItem[] => prescriptionItemSchema.array().catch([]).parse(r.items);
const rxView = async (tx: Tx, r: RxRow): Promise<PrescriptionView> => ({
  id: r.id,
  version: r.version,
  status: r.status,
  items: rxItems(r),
  issued_at: r.issuedAt?.toISOString() ?? null,
  issued_by_name: await staffName(tx, r.issuedBy),
  updated_at: r.updatedAt.toISOString(),
});

export async function listPrescriptions(c: Ctx, consultationId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    await consultationOf(tx, consultationId);
    const rows = await tx.select().from(prescriptions).where(eq(prescriptions.consultationId, consultationId)).orderBy(desc(prescriptions.version));
    return Promise.all(rows.map((r) => rxView(tx, r)));
  });
}

/** Simpan draf. Bila ada draf → diperbarui; bila tidak (mis. versi terakhir sudah terbit) → versi baru berstatus draf. */
export async function saveRxDraft(c: Ctx, consultationId: string, items: PrescriptionItem[]) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const k = await consultationOf(tx, consultationId);
    const all = await tx.select().from(prescriptions).where(eq(prescriptions.consultationId, consultationId)).orderBy(desc(prescriptions.version));
    const draft = all.find((r) => r.status === "draft");
    if (draft) {
      const [row] = await tx.update(prescriptions).set({ items, updatedAt: c.now }).where(eq(prescriptions.id, draft.id)).returning();
      await audit(tx, c, "prescription", draft.id, "rx.update", { items: draft.items, version: draft.version }, { items, version: draft.version });
      return rxView(tx, row!);
    }
    const version = (all[0]?.version ?? 0) + 1;
    const [row] = await tx
      .insert(prescriptions)
      .values({ clinicId: c.clinicId, consultationId, patientId: k.patientId, version, items, createdBy: c.staffId, createdAt: c.now, updatedAt: c.now })
      .returning();
    await audit(tx, c, "prescription", row!.id, "rx.create", null, { items, version });
    return rxView(tx, row!);
  });
}

export async function issueRx(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [r] = await tx.select().from(prescriptions).where(eq(prescriptions.id, id));
    if (!r) throw new AuthError(404, "rx_not_found", "Resep ini belum ditemukan.");
    if (r.status !== "draft") throw new AuthError(409, "rx_not_draft", "Resep ini sudah diterbitkan dan tidak dapat diubah. Buat versi baru untuk perubahan.");
    if (!rxItems(r).length) throw new AuthError(400, "rx_empty", "Tambahkan minimal satu item resep sebelum menerbitkan.");
    const olds = await tx.select().from(prescriptions).where(and(eq(prescriptions.consultationId, r.consultationId), eq(prescriptions.status, "issued")));
    for (const o of olds) {
      await tx.update(prescriptions).set({ status: "superseded" }).where(eq(prescriptions.id, o.id));
      await audit(tx, c, "prescription", o.id, "rx.supersede", { status: "issued" }, { status: "superseded", by_version: r.version });
    }
    const [row] = await tx.update(prescriptions).set({ status: "issued", issuedBy: c.staffId, issuedAt: c.now, updatedAt: c.now }).where(eq(prescriptions.id, id)).returning();
    await audit(tx, c, "prescription", id, "rx.issue", { status: "draft" }, { status: "issued", version: r.version });
    return rxView(tx, row!);
  });
}

// ---------- Rencana ----------
type PlanRow = typeof carePlans.$inferSelect;
const parseContent = (v: unknown): PlanContent => planContentSchema.catch({ focus: [], next_steps: [], monitor: [], review_at: null }).parse(v);
const parseSummary = (v: unknown): PlanSummary => summarySchema.catch({ discussed: "", priorities: [] }).parse(v);
const planView = async (tx: Tx, p: PlanRow): Promise<PlanView> => ({
  id: p.id,
  consultation_id: p.consultationId,
  version: p.version,
  status: p.status,
  content: parseContent(p.content),
  summary: parseSummary(p.summary),
  signed_at: p.signedAt?.toISOString() ?? null,
  signed_by_name: await staffName(tx, p.signedBy),
  updated_at: p.updatedAt.toISOString(),
});

export async function listPlans(c: Ctx, consultationId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    await consultationOf(tx, consultationId);
    const rows = await tx.select().from(carePlans).where(eq(carePlans.consultationId, consultationId)).orderBy(desc(carePlans.version));
    return Promise.all(rows.map((r) => planView(tx, r)));
  });
}

export async function savePlanDraft(c: Ctx, consultationId: string, content: PlanContent, summary: PlanSummary) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const k = await consultationOf(tx, consultationId);
    const all = await tx.select().from(carePlans).where(eq(carePlans.consultationId, consultationId)).orderBy(desc(carePlans.version));
    const draft = all.find((p) => p.status === "draft");
    if (draft) {
      const [row] = await tx.update(carePlans).set({ content, summary, updatedAt: c.now }).where(eq(carePlans.id, draft.id)).returning();
      await audit(tx, c, "care_plan", draft.id, "plan.update", { content: draft.content, summary: draft.summary }, { content, summary });
      return planView(tx, row!);
    }
    const version = (all[0]?.version ?? 0) + 1;
    const [row] = await tx
      .insert(carePlans)
      .values({ clinicId: c.clinicId, patientId: k.patientId, consultationId, version, content, summary, createdBy: c.staffId, createdAt: c.now, updatedAt: c.now })
      .returning();
    await audit(tx, c, "care_plan", row!.id, all.length ? "plan.new_version" : "plan.create", all[0] ? { from_version: all[0].version } : null, { content, summary, version });
    return planView(tx, row!);
  });
}

export async function signPlan(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [p] = await tx.select().from(carePlans).where(eq(carePlans.id, id));
    if (!p) throw new AuthError(404, "plan_not_found", "Rencana ini belum ditemukan.");
    if (p.status !== "draft") throw new AuthError(409, "plan_not_draft", "Rencana ini sudah ditandatangani dan tidak dapat diubah. Buat versi baru untuk perubahan.");
    const content = parseContent(p.content);
    if (!content.focus.length || !content.next_steps.length) {
      throw new AuthError(400, "plan_incomplete", "Rencana belum lengkap. Isi minimal satu fokus dan satu langkah berikutnya sebelum menandatangani.");
    }
    const summary = parseSummary(p.summary);
    const at = c.now.toISOString();
    const hash = createHash("sha256").update(signaturePayload(content, summary, c.staffId, at)).digest("hex");
    const prev = await tx.select().from(carePlans).where(and(eq(carePlans.patientId, p.patientId), eq(carePlans.status, "signed"), ne(carePlans.id, id)));
    for (const o of prev) {
      await tx.update(carePlans).set({ status: "superseded" }).where(eq(carePlans.id, o.id));
      await audit(tx, c, "care_plan", o.id, "plan.supersede", { status: "signed" }, { status: "superseded", by_version: p.version });
    }
    const [row] = await tx
      .update(carePlans)
      .set({ status: "signed", signedBy: c.staffId, signedAt: c.now, signatureHash: hash, updatedAt: c.now })
      .where(eq(carePlans.id, id))
      .returning();
    await audit(tx, c, "care_plan", id, "plan.sign", { status: "draft" }, { status: "signed", version: p.version, signature_hash: hash });
    await remindersAfterSign(tx, c.clinicId, p.patientId, c.now, content.review_at);
    await tx.insert(events).values({
      clinicId: c.clinicId,
      type: "plan.approved",
      payload: { plan_id: id, patient_id: p.patientId, consultation_id: p.consultationId, version: p.version },
      createdAt: c.now,
    });
    return planView(tx, row!);
  });
}

// ---------- Pasien (hanya yang signed / issued) ----------
type PCtx = { db: Db; clinicId: string; patientId: string };

async function patientPlanFrom(tx: Tx, c: PCtx, p: PlanRow): Promise<PatientPlan> {
  const [clinic] = await tx.select().from(clinics).where(eq(clinics.id, c.clinicId));
  const [rx] = await tx
    .select()
    .from(prescriptions)
    .where(and(eq(prescriptions.consultationId, p.consultationId), eq(prescriptions.status, "issued")))
    .orderBy(desc(prescriptions.version))
    .limit(1);
  const content = parseContent(p.content);
  const assistant = clinic?.assistantName ?? "Sovia";
  return {
    id: p.id,
    version: p.version,
    consultation_id: p.consultationId,
    clinic_name: clinic?.name ?? "",
    signed_at: p.signedAt!.toISOString(),
    signed_by_name: (await staffName(tx, p.signedBy)) ?? "",
    content,
    summary: parseSummary(p.summary),
    explanation: explainPlan(assistant, { content }),
    prescription: rx
      ? { issued_at: rx.issuedAt!.toISOString(), issued_by_name: (await staffName(tx, rx.issuedBy)) ?? "", items: rxItems(rx) }
      : null,
  };
}

export async function currentPlan(c: PCtx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [p] = await tx
      .select()
      .from(carePlans)
      .where(and(eq(carePlans.patientId, c.patientId), eq(carePlans.status, "signed")))
      .orderBy(desc(carePlans.signedAt))
      .limit(1);
    return p ? patientPlanFrom(tx, c, p) : null;
  });
}

export async function consultationSummary(c: PCtx, consultationId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [k] = await tx.select().from(consultations).where(and(eq(consultations.id, consultationId), eq(consultations.patientId, c.patientId)));
    if (!k) throw new AuthError(404, "consultation_not_found", "Konsultasi ini belum ditemukan.");
    const [p] = await tx
      .select()
      .from(carePlans)
      .where(and(eq(carePlans.consultationId, consultationId), eq(carePlans.status, "signed")))
      .orderBy(desc(carePlans.version))
      .limit(1);
    return { consultation_id: k.id, scheduled_at: k.scheduledAt.toISOString(), plan: p ? await patientPlanFrom(tx, c, p) : null };
  });
}

