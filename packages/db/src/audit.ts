import type { Tx } from "./client";
import { auditLogs } from "./schema";

export interface AuditEntry {
  clinicId: string;
  actorType: "staff" | "patient" | "system" | "api" | "mcp";
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  at?: Date;
}

/** Semua penulisan klinis WAJIB memanggil ini di transaksi yang sama dengan perubahannya. */
export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    clinicId: e.clinicId,
    actorType: e.actorType,
    actorId: e.actorId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    before: e.before ?? null,
    after: e.after ?? null,
    at: e.at ?? new Date(),
  });
}
