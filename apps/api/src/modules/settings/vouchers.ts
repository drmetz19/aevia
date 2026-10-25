import { desc, eq } from "drizzle-orm";
import type { StaffVoucher, VoucherStatus, voucherInputSchema } from "@aevia/core";
import { programs, vouchers, writeAudit, type Db, type Tx } from "@aevia/db";
import type { z } from "zod";
import { AuthError } from "../auth/otp";

type Input = z.infer<typeof voucherInputSchema>;
type Ctx = { db: Db; clinicId: string; actorId: string; now: Date };
type Row = typeof vouchers.$inferSelect;

export function voucherStatus(v: Pick<Row, "active" | "expiresAt" | "maxUses" | "usedCount">, now: Date): VoucherStatus {
  if (!v.active) return "inactive";
  if (v.expiresAt && v.expiresAt.getTime() <= now.getTime()) return "expired";
  if (v.maxUses !== null && v.usedCount >= v.maxUses) return "exhausted";
  return "active";
}

const view = (v: Row, programName: string | null, now: Date): StaffVoucher => ({
  id: v.id,
  code: v.code,
  program_id: v.programId,
  program_name: programName,
  max_uses: v.maxUses,
  used_count: v.usedCount,
  expires_at: v.expiresAt?.toISOString() ?? null,
  active: v.active,
  status: voucherStatus(v, now),
  created_at: v.createdAt.toISOString(),
});
const audit = (tx: Tx, c: Ctx, id: string, action: string, before: unknown, after: unknown) =>
  writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "voucher", entityId: id, action, before, after, at: c.now });

const duplicate = () => new AuthError(409, "voucher_code_taken", "Kode ini sudah dipakai di klinik Anda.");
const isUniqueViolation = (e: unknown): boolean => {
  for (let x = e as { code?: string; cause?: unknown } | undefined, i = 0; x && i < 4; x = x.cause as typeof x, i++) if (x.code === "23505") return true;
  return false;
};

export async function listVouchers(c: Ctx): Promise<StaffVoucher[]> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const rows = await tx
      .select({ v: vouchers, programName: programs.name })
      .from(vouchers)
      .leftJoin(programs, eq(programs.id, vouchers.programId))
      .orderBy(desc(vouchers.createdAt), desc(vouchers.id));
    return rows.map((r) => view(r.v, r.programName, c.now));
  });
}

export async function createVoucher(c: Ctx, body: Input): Promise<StaffVoucher> {
  try {
    return await c.db.withTenant(c.clinicId, async (tx) => {
      let programName: string | null = null;
      if (body.program_id) {
        const [p] = await tx.select({ name: programs.name }).from(programs).where(eq(programs.id, body.program_id));
        if (!p) throw new AuthError(404, "program_not_found", "Program ini belum ditemukan di klinik Anda.");
        programName = p.name;
      }
      const [dup] = await tx.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.code, body.code));
      if (dup) throw duplicate();
      const [row] = await tx
        .insert(vouchers)
        .values({ clinicId: c.clinicId, code: body.code, programId: body.program_id, maxUses: body.max_uses, expiresAt: body.expires_at ? new Date(body.expires_at) : null, createdAt: c.now })
        .returning();
      await audit(tx, c, row!.id, "voucher.create", null, { code: body.code, program_id: body.program_id, max_uses: body.max_uses, expires_at: body.expires_at });
      return view(row!, programName, c.now);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicate();
    throw e;
  }
}

export async function setVoucherActive(c: Ctx, id: string, active: boolean): Promise<StaffVoucher> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(vouchers).where(eq(vouchers.id, id));
    if (!before) throw new AuthError(404, "voucher_not_found", "Voucher ini belum ditemukan di klinik Anda.");
    const [row] = await tx.update(vouchers).set({ active }).where(eq(vouchers.id, id)).returning();
    await audit(tx, c, id, active ? "voucher.activate" : "voucher.deactivate", { active: before.active }, { active });
    const [p] = row!.programId ? await tx.select({ name: programs.name }).from(programs).where(eq(programs.id, row!.programId)) : [];
    return view(row!, p?.name ?? null, c.now);
  });
}
