import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULT_SKIN_PARAMETERS } from "@aevia/core";
import { clinicSettings, clinics, platformAdmins, staff, writeAudit, type Db } from "@aevia/db";
import type { createClinicSchema } from "@aevia/core";
import { AuthError } from "../auth/otp";
import type { StorageProvider } from "../../storage";
import { assetPath } from "./brand";

type Ctx = { db: Db; adminId: string; now: Date };
const clinicView = (c: typeof clinics.$inferSelect) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  brand_mode: c.brandMode,
  custom_domain: c.customDomain,
  domain_verified: c.customDomainVerified,
  assistant_status: c.assistantNameStatus,
  created_at: c.createdAt.toISOString(),
});

export async function listClinics(db: Db) {
  return (await db.db.select().from(clinics).orderBy(asc(clinics.createdAt))).map(clinicView);
}

/** Buat klinik + admin pertama + parameter kulit default. Slug langsung dapat dibuka di web (halaman membaca langsung dari API). */
export async function createClinic(c: Ctx, body: z.infer<typeof createClinicSchema>) {
  const [slugTaken] = await c.db.db.select({ id: clinics.id }).from(clinics).where(eq(clinics.slug, body.slug));
  if (slugTaken) throw new AuthError(409, "slug_taken", "Alamat klinik ini sudah dipakai. Pilih yang lain.");
  const [a] = await c.db.db.select({ id: staff.id }).from(staff).where(eq(staff.email, body.admin_email));
  const [b] = await c.db.db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, body.admin_email));
  if (a || b) throw new AuthError(409, "email_taken", "Email admin ini sudah terdaftar sebagai staf. Gunakan email lain.");
  const adminName = body.admin_name ?? `Admin ${body.name}`;
  return c.db.db.transaction(async (tx) => {
    const [row] = await tx.insert(clinics).values({ slug: body.slug, name: body.name, brandMode: body.brand_mode, createdAt: c.now }).returning();
    const [adm] = await tx.insert(staff).values({ clinicId: row!.id, email: body.admin_email, name: adminName, role: "clinic_admin", createdAt: c.now }).returning();
    await tx.insert(clinicSettings).values({ clinicId: row!.id, key: "skin_parameters", value: DEFAULT_SKIN_PARAMETERS });
    await writeAudit(tx, {
      clinicId: row!.id,
      actorType: "staff",
      actorId: c.adminId,
      entity: "clinic",
      entityId: row!.id,
      action: "clinic.create",
      before: null,
      after: { slug: body.slug, name: body.name, brand_mode: body.brand_mode, first_admin: { id: adm!.id, email: body.admin_email } },
      at: c.now,
    });
    return clinicView(row!);
  });
}

export async function verifyDomain(c: Ctx, clinicId: string, verified: boolean) {
  return c.db.db.transaction(async (tx) => {
    const [before] = await tx.select().from(clinics).where(eq(clinics.id, clinicId));
    if (!before) throw new AuthError(404, "clinic_not_found", "Klinik ini belum ditemukan.");
    if (!before.customDomain) throw new AuthError(409, "no_domain", "Klinik ini belum mengisi domain khusus.");
    const [row] = await tx.update(clinics).set({ customDomainVerified: verified }).where(eq(clinics.id, clinicId)).returning();
    await writeAudit(tx, { clinicId, actorType: "staff", actorId: c.adminId, entity: "clinic", entityId: clinicId, action: verified ? "domain.verify" : "domain.unverify", before: { domain_verified: before.customDomainVerified, custom_domain: before.customDomain }, after: { domain_verified: verified }, at: c.now });
    return clinicView(row!);
  });
}

export async function assistantQueue(db: Db) {
  const rows = await db.db.select().from(clinics).where(and(eq(clinics.assistantNameStatus, "pending"), isNotNull(clinics.assistantSubmittedAt))).orderBy(desc(clinics.assistantSubmittedAt));
  return rows.map((r) => ({
    clinic_id: r.id,
    slug: r.slug,
    clinic_name: r.name,
    current_name: r.assistantName,
    pending_name: r.pendingAssistantName,
    has_pending_avatar: Boolean(r.pendingAvatarKey),
    submitted_at: r.assistantSubmittedAt?.toISOString() ?? null,
  }));
}

export async function reviewAssistant(c: Ctx & { storage: StorageProvider }, clinicId: string, decision: "approve" | "reject", note: string) {
  const removals: string[] = [];
  const out = await c.db.db.transaction(async (tx) => {
    const [before] = await tx.select().from(clinics).where(eq(clinics.id, clinicId));
    if (!before) throw new AuthError(404, "clinic_not_found", "Klinik ini belum ditemukan.");
    if (before.assistantNameStatus !== "pending") throw new AuthError(409, "not_pending", "Usulan ini sudah ditanggapi atau tidak ada yang menunggu.");
    let set: Partial<typeof clinics.$inferInsert>;
    if (decision === "approve") {
      if (before.pendingAvatarKey && before.avatarKey) removals.push(before.avatarKey);
      set = {
        assistantName: before.pendingAssistantName ?? before.assistantName,
        ...(before.pendingAvatarKey ? { avatarKey: before.pendingAvatarKey, avatarUrl: assetPath(before.slug, "avatar", c.now) } : {}),
        pendingAssistantName: null,
        pendingAvatarKey: null,
        assistantNameStatus: "approved",
        assistantReviewNote: note || null,
      };
    } else {
      if (before.pendingAvatarKey) removals.push(before.pendingAvatarKey);
      set = { pendingAvatarKey: null, assistantNameStatus: "rejected", assistantReviewNote: note };
    }
    const [row] = await tx.update(clinics).set(set).where(eq(clinics.id, clinicId)).returning();
    await writeAudit(tx, {
      clinicId,
      actorType: "staff",
      actorId: c.adminId,
      entity: "clinic",
      entityId: clinicId,
      action: decision === "approve" ? "assistant.approve" : "assistant.reject",
      before: { name: before.assistantName, pending_name: before.pendingAssistantName, has_pending_avatar: Boolean(before.pendingAvatarKey), status: before.assistantNameStatus },
      after: { name: row!.assistantName, status: row!.assistantNameStatus, note },
      at: c.now,
    });
    return clinicView(row!);
  });
  for (const k of removals) await c.storage.remove(k);
  return out;
}

export async function resolveDomain(db: Db, host: string) {
  const [c] = await db.db.select({ slug: clinics.slug }).from(clinics).where(and(eq(clinics.customDomain, host), eq(clinics.customDomainVerified, true)));
  return c ?? null;
}
