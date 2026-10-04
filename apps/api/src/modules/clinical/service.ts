import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  DEFAULT_SKIN_PARAMETERS,
  PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  annotationSchema,
  skinParametersSchema,
  sniffImage,
  type Annotation,
} from "@aevia/core";
import {
  clinicSettings,
  consents,
  consultations,
  consultationRequests,
  patients,
  programs,
  prescriptions,
  carePlans,
  skinAnalyses,
  skinPhotos,
  soapNotes,
  staff,
  writeAudit,
  auditLogs,
  type Db,
  type Tx,
} from "@aevia/db";
import { AuthError } from "../auth/otp";
import type { StorageProvider } from "../../storage";

export type Ctx = { db: Db; clinicId: string; staffId: string; now: Date; storage: StorageProvider };

export const URL_TTL_SECONDS = 300;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const notFound = () => new AuthError(404, "consultation_not_found", "Konsultasi ini belum ditemukan di klinik Anda.");
const photosDenied = () =>
  new AuthError(403, "photos_consent_required", "Pasien belum memberi persetujuan untuk foto, atau persetujuannya sudah dicabut. Foto tidak dapat diakses.");

async function getConsultation(tx: Tx, id: string) {
  const [k] = await tx.select().from(consultations).where(eq(consultations.id, id));
  if (!k) throw notFound();
  return k;
}

async function hasConsent(tx: Tx, patientId: string, scope: "photos" | "assessment") {
  const [c] = await tx.select().from(consents).where(and(eq(consents.patientId, patientId), eq(consents.scope, scope)));
  return Boolean(c?.grantedAt && !c.revokedAt);
}

const audit = (tx: Tx, c: Ctx, entity: string, entityId: string, action: string, before: unknown, after: unknown) =>
  writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.staffId, entity, entityId, action, before, after, at: c.now });

export async function consultationDetail(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const k = await getConsultation(tx, id);
    const [p] = await tx.select().from(patients).where(eq(patients.id, k.patientId));
    const [r] = await tx
      .select({ name: programs.name })
      .from(consultationRequests)
      .innerJoin(programs, eq(programs.id, consultationRequests.programId))
      .where(eq(consultationRequests.id, k.requestId));
    const [soap] = await tx.select().from(soapNotes).where(eq(soapNotes.consultationId, id));
    return {
      id: k.id,
      status: k.status,
      scheduled_at: k.scheduledAt.toISOString(),
      meeting_url: k.meetingUrl,
      program_name: r?.name ?? "",
      patient: { id: k.patientId, email: p?.email ?? "" },
      photos_consent: await hasConsent(tx, k.patientId, "photos"),
      assessment_visible: await hasConsent(tx, k.patientId, "assessment"),
      soap: soapView(soap),
    };
  });
}

type SoapRow = typeof soapNotes.$inferSelect;
const soapView = (s?: SoapRow) => ({
  subjective: s?.subjective ?? "",
  objective: s?.objective ?? "",
  assessment: s?.assessment ?? "",
  plan: s?.plan ?? "",
  updated_at: iso(s?.updatedAt ?? null),
  updated_by: s?.updatedBy ?? null,
});
const soapFields = (s?: SoapRow) => (s ? { subjective: s.subjective, objective: s.objective, assessment: s.assessment, plan: s.plan } : null);

export async function saveSoap(c: Ctx, id: string, body: { subjective: string; objective: string; assessment: string; plan: string }) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    await getConsultation(tx, id);
    const [before] = await tx.select().from(soapNotes).where(eq(soapNotes.consultationId, id));
    const [row] = before
      ? await tx.update(soapNotes).set({ ...body, updatedBy: c.staffId, updatedAt: c.now }).where(eq(soapNotes.id, before.id)).returning()
      : await tx.insert(soapNotes).values({ ...body, clinicId: c.clinicId, consultationId: id, updatedBy: c.staffId, createdAt: c.now, updatedAt: c.now }).returning();
    await audit(tx, c, "soap_note", row!.id, before ? "soap.update" : "soap.create", soapFields(before), soapFields(row));
    return soapView(row);
  });
}

async function parameters(tx: Tx) {
  const [s] = await tx.select().from(clinicSettings).where(eq(clinicSettings.key, "skin_parameters"));
  const parsed = skinParametersSchema.safeParse(s?.value);
  return parsed.success ? parsed.data : DEFAULT_SKIN_PARAMETERS;
}

const photoView = (p: typeof skinPhotos.$inferSelect) => ({
  id: p.id,
  angle: p.angle,
  taken_at: p.takenAt.toISOString(),
  annotations: annotationSchema.array().catch([]).parse(p.annotations),
});

export async function skinView(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const k = await getConsultation(tx, id);
    const [a] = await tx.select().from(skinAnalyses).where(eq(skinAnalyses.consultationId, id));
    const consent = await hasConsent(tx, k.patientId, "photos");
    const photos = consent
      ? await tx.select().from(skinPhotos).where(eq(skinPhotos.consultationId, id)).orderBy(asc(skinPhotos.takenAt))
      : [];
    return {
      parameters: await parameters(tx),
      scores: a?.scores ?? {},
      notes: a?.notes ?? "",
      updated_at: iso(a?.updatedAt ?? null),
      photos_consent: consent,
      photos: photos.map(photoView),
    };
  });
}

export async function saveSkin(c: Ctx, id: string, body: { scores: Record<string, number>; notes: string }) {
  await c.db.withTenant(c.clinicId, async (tx) => {
    await getConsultation(tx, id);
    const keys = new Set((await parameters(tx)).map((p) => p.key));
    const unknown = Object.keys(body.scores).filter((k) => !keys.has(k));
    if (unknown.length) throw new AuthError(400, "unknown_parameter", "Ada parameter kulit yang tidak dikenal oleh klinik ini.");
    const [before] = await tx.select().from(skinAnalyses).where(eq(skinAnalyses.consultationId, id));
    const [row] = before
      ? await tx.update(skinAnalyses).set({ ...body, updatedBy: c.staffId, updatedAt: c.now }).where(eq(skinAnalyses.id, before.id)).returning()
      : await tx.insert(skinAnalyses).values({ ...body, clinicId: c.clinicId, consultationId: id, updatedBy: c.staffId, createdAt: c.now, updatedAt: c.now }).returning();
    await audit(tx, c, "skin_analysis", row!.id, before ? "skin.update" : "skin.create", before ? { scores: before.scores, notes: before.notes } : null, { scores: row!.scores, notes: row!.notes });
  });
  return skinView(c, id);
}

export async function uploadPhoto(c: Ctx, id: string, angle: "front" | "left" | "right" | "other", data: Buffer) {
  if (!data.length) throw new AuthError(400, "empty_file", "Berkas foto kosong. Silakan pilih foto lain.");
  if (data.length > MAX_PHOTO_BYTES) throw new AuthError(413, "file_too_large", "Ukuran foto melebihi 10 MB. Silakan pilih foto yang lebih kecil.");
  const mime = sniffImage(data);
  if (!mime) throw new AuthError(415, "unsupported_type", "Format foto belum didukung. Gunakan JPG, PNG, atau WebP.");
  const photoId = randomUUID();
  const key = `${c.clinicId}/${id}/${photoId}.${PHOTO_TYPES[mime]}`;
  const created = await c.db.withTenant(c.clinicId, async (tx) => {
    const k = await getConsultation(tx, id);
    if (!(await hasConsent(tx, k.patientId, "photos"))) throw photosDenied();
    await c.storage.put(key, data, mime);
    try {
      const [row] = await tx
        .insert(skinPhotos)
        .values({ id: photoId, clinicId: c.clinicId, consultationId: id, patientId: k.patientId, storageKey: key, contentType: mime, angle, takenAt: c.now, createdBy: c.staffId, createdAt: c.now })
        .returning();
      await audit(tx, c, "skin_photo", photoId, "photo.upload", null, { angle, content_type: mime, bytes: data.length, consultation_id: id });
      return row!;
    } catch (e) {
      await c.storage.remove(key);
      throw e;
    }
  });
  return photoView(created);
}

async function loadPhoto(tx: Tx, photoId: string) {
  const [p] = await tx.select().from(skinPhotos).where(eq(skinPhotos.id, photoId));
  if (!p) throw new AuthError(404, "photo_not_found", "Foto ini belum ditemukan.");
  return p;
}

export async function photoUrl(c: Ctx, photoId: string) {
  const p = await c.db.withTenant(c.clinicId, async (tx) => {
    const photo = await loadPhoto(tx, photoId);
    if (!(await hasConsent(tx, photo.patientId, "photos"))) throw photosDenied();
    return photo;
  });
  const url = await c.storage.signedUrl({ key: p.storageKey, photoId: p.id, clinicId: c.clinicId, ttlSeconds: URL_TTL_SECONDS, now: c.now });
  return { url, expires_in: URL_TTL_SECONDS };
}

export async function saveAnnotations(c: Ctx, photoId: string, annotations: Annotation[]) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const p = await loadPhoto(tx, photoId);
    if (!(await hasConsent(tx, p.patientId, "photos"))) throw photosDenied();
    const [row] = await tx.update(skinPhotos).set({ annotations }).where(eq(skinPhotos.id, photoId)).returning();
    await audit(tx, c, "skin_photo", photoId, "photo.annotations", { annotations: p.annotations }, { annotations });
    return photoView(row!);
  });
}

/** Dipakai endpoint berkas bertanda tangan: cek consent saat permintaan (bukan saat URL diterbitkan). */
export async function readPhotoForServing(db: Db, storage: StorageProvider, clinicId: string, photoId: string) {
  const p = await db.withTenant(clinicId, async (tx) => {
    const [photo] = await tx.select().from(skinPhotos).where(eq(skinPhotos.id, photoId));
    if (!photo) return null;
    return (await hasConsent(tx, photo.patientId, "photos")) ? photo : "denied";
  });
  if (!p) return { status: 404 as const };
  if (p === "denied") return { status: 403 as const };
  const data = await storage.read?.(p.storageKey);
  if (!data) return { status: 404 as const };
  return { status: 200 as const, data, contentType: p.contentType };
}

export async function auditFor(c: Ctx, consultationId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    await getConsultation(tx, consultationId);
    const [soap] = await tx.select({ id: soapNotes.id }).from(soapNotes).where(eq(soapNotes.consultationId, consultationId));
    const [skin] = await tx.select({ id: skinAnalyses.id }).from(skinAnalyses).where(eq(skinAnalyses.consultationId, consultationId));
    const photos = await tx.select({ id: skinPhotos.id }).from(skinPhotos).where(eq(skinPhotos.consultationId, consultationId));
    const rx = await tx.select({ id: prescriptions.id }).from(prescriptions).where(eq(prescriptions.consultationId, consultationId));
    const plans = await tx.select({ id: carePlans.id }).from(carePlans).where(eq(carePlans.consultationId, consultationId));
    const ids = new Set([soap?.id, skin?.id, ...photos.map((p) => p.id), ...rx.map((r) => r.id), ...plans.map((r) => r.id)].filter((x): x is string => Boolean(x)));
    if (!ids.size) return [];
    const rows = await tx
      .select({ a: auditLogs, name: staff.name })
      .from(auditLogs)
      .leftJoin(staff, eq(staff.id, auditLogs.actorId))
      .where(inArray(auditLogs.entityId, [...ids]))
      .orderBy(desc(auditLogs.at));
    return rows.map((r) => ({
        id: r.a.id,
        at: r.a.at.toISOString(),
        actor_type: r.a.actorType,
        actor_id: r.a.actorId,
        actor_name: r.name,
        entity: r.a.entity,
        entity_id: r.a.entityId,
        action: r.a.action,
        before: r.a.before,
        after: r.a.after,
      }));
  });
}
