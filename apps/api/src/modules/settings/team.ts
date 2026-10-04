import { and, asc, eq } from "drizzle-orm";
import { platformAdmins, staff, writeAudit, type Db } from "@aevia/db";
import { AuthError } from "../auth/otp";

type Ctx = { db: Db; clinicId: string; actorId: string; now: Date };
type Row = typeof staff.$inferSelect;
const view = (s: Row) => ({ id: s.id, email: s.email, name: s.name, role: s.role, active: s.active });

export async function listTeam(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => (await tx.select().from(staff).orderBy(asc(staff.createdAt))).map(view));
}

/** Email staf unik di seluruh platform (satu login per email), jadi cek dilakukan dengan koneksi pemilik. */
export async function inviteStaff(c: Ctx, body: { email: string; name: string; role: "professional" | "clinic_admin" }) {
  const [a] = await c.db.db.select({ id: staff.id }).from(staff).where(eq(staff.email, body.email));
  const [b] = await c.db.db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, body.email));
  if (a || b) throw new AuthError(409, "email_taken", "Email ini sudah terdaftar sebagai staf. Gunakan email lain.");
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [row] = await tx.insert(staff).values({ clinicId: c.clinicId, email: body.email, name: body.name, role: body.role, createdAt: c.now }).returning();
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "staff", entityId: row!.id, action: "staff.invite", before: null, after: { email: body.email, name: body.name, role: body.role }, at: c.now });
    return view(row!);
  });
}

export async function setStaffActive(c: Ctx, id: string, active: boolean) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [target] = await tx.select().from(staff).where(eq(staff.id, id));
    if (!target) throw new AuthError(404, "staff_not_found", "Anggota tim ini belum ditemukan di klinik Anda.");
    if (target.active === active) return view(target);
    if (!active) {
      if (target.id === c.actorId) throw new AuthError(409, "self_deactivate", "Anda tidak dapat menonaktifkan akun Anda sendiri.");
      if (target.role === "clinic_admin") {
        const admins = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.role, "clinic_admin"), eq(staff.active, true)));
        if (admins.length <= 1) throw new AuthError(409, "last_admin", "Klinik harus memiliki minimal satu admin aktif.");
      }
    }
    const [row] = await tx.update(staff).set({ active }).where(eq(staff.id, id)).returning();
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "staff", entityId: id, action: active ? "staff.activate" : "staff.deactivate", before: { active: target.active }, after: { active }, at: c.now });
    return view(row!);
  });
}

export async function isStaffActive(db: Db, staffId: string, clinicId: string): Promise<boolean> {
  const rows = await db.withTenant(clinicId, (tx) => tx.select({ active: staff.active }).from(staff).where(eq(staff.id, staffId)));
  return rows[0]?.active === true;
}
