import { and, eq } from "drizzle-orm";
import type { Role } from "@aevia/core";
import { findClinicBySlug, patients, platformAdmins, staff, type Db } from "@aevia/db";
import { AuthError, checkOtp, issueOtp } from "./otp";
import type { OtpSender } from "./otp-sender";
import { signToken, TOKEN_TTL_SECONDS } from "./tokens";

export interface AuthCtx {
  db: Db;
  secret: Uint8Array;
  sender: OtpSender;
  now: () => Date;
}

export const OTP_SENT = "Jika email Anda terdaftar, kode masuk akan segera kami kirim. Kode berlaku 10 menit.";

const clinicNotFound = () =>
  new AuthError(404, "clinic_not_found", "Klinik yang Anda cari belum kami temukan. Periksa kembali tautan dari klinik Anda.");

export async function requestPatientOtp(ctx: AuthCtx, slug: string, email: string) {
  const clinic = await findClinicBySlug(ctx.db, slug);
  if (!clinic) throw clinicNotFound();
  const code = await issueOtp(ctx.db, ctx.secret, { subjectType: "patient", clinicId: clinic.id, email }, ctx.now());
  await ctx.sender.send({ email, code, purpose: "patient", clinicSlug: slug });
  return { message: OTP_SENT };
}

export async function verifyPatientOtp(ctx: AuthCtx, slug: string, email: string, code: string) {
  const clinic = await findClinicBySlug(ctx.db, slug);
  if (!clinic) throw clinicNotFound();
  await checkOtp(ctx.db, ctx.secret, { subjectType: "patient", clinicId: clinic.id, email }, code, ctx.now());
  const patientId = await ctx.db.withTenant(clinic.id, async (tx) => {
    await tx.insert(patients).values({ clinicId: clinic.id, email }).onConflictDoNothing();
    const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.email, email));
    return p!.id;
  });
  const token = await signToken(ctx.secret, { sub: patientId, clinic_id: clinic.id, role: "patient" }, ctx.now());
  return { token, expires_in: TOKEN_TTL_SECONDS, role: "patient" as Role, clinic_slug: clinic.slug };
}

interface StaffIdentity {
  id: string;
  clinicId: string | null;
  slug: string | null;
  role: Role;
}

async function findStaffIdentity(db: Db, email: string): Promise<StaffIdentity | null> {
  const [admin] = await db.db.select().from(platformAdmins).where(eq(platformAdmins.email, email));
  if (admin) return { id: admin.id, clinicId: null, slug: null, role: "aevia_admin" };
  // Lookup pra-login lintas klinik: koneksi pemilik (bypass RLS), hanya untuk identitas staf.
  const [s] = await db.db.select().from(staff).where(and(eq(staff.email, email), eq(staff.active, true)));
  if (!s) return null;
  const clinic = await db.db.query.clinics.findFirst({ where: (c, { eq: e }) => e(c.id, s.clinicId) });
  return { id: s.id, clinicId: s.clinicId, slug: clinic?.slug ?? null, role: s.role };
}

export async function requestStaffOtp(ctx: AuthCtx, email: string) {
  const who = await findStaffIdentity(ctx.db, email);
  if (who) {
    const code = await issueOtp(ctx.db, ctx.secret, { subjectType: "staff", clinicId: null, email }, ctx.now());
    await ctx.sender.send({ email, code, purpose: "staff", clinicSlug: who.slug ?? undefined });
  }
  return { message: OTP_SENT };
}

export async function verifyStaffOtp(ctx: AuthCtx, email: string, code: string) {
  await checkOtp(ctx.db, ctx.secret, { subjectType: "staff", clinicId: null, email }, code, ctx.now());
  const who = await findStaffIdentity(ctx.db, email);
  if (!who) throw new AuthError(400, "otp_invalid", "Kode belum sesuai. Silakan minta kode baru.");
  const token = await signToken(ctx.secret, { sub: who.id, clinic_id: who.clinicId, role: who.role }, ctx.now());
  return { token, expires_in: TOKEN_TTL_SECONDS, role: who.role, clinic_slug: who.slug };
}

export async function staffProfile(db: Db, sub: string, role: Role) {
  if (role === "aevia_admin") {
    const [a] = await db.db.select().from(platformAdmins).where(eq(platformAdmins.id, sub));
    return a ? { id: a.id, email: a.email, name: a.name, role, clinic_slug: null } : null;
  }
  const [s] = await db.db.select().from(staff).where(and(eq(staff.id, sub), eq(staff.active, true)));
  if (!s) return null;
  const clinic = await db.db.query.clinics.findFirst({ where: (c, { eq: e }) => e(c.id, s.clinicId) });
  return { id: s.id, email: s.email, name: s.name, role: s.role as Role, clinic_slug: clinic?.slug ?? null };
}

export async function patientProfile(db: Db, clinicId: string, patientId: string) {
  return db.withTenant(clinicId, async (tx) => {
    const [p] = await tx.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)));
    return p ?? null;
  });
}
