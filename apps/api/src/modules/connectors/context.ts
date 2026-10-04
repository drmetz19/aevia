import { and, desc, eq } from "drizzle-orm";
import type { BeautySnapshot } from "@aevia/core";
import { consents, externalContext, type Tx } from "@aevia/db";

export async function externalConsentActive(tx: Tx, patientId: string): Promise<boolean> {
  const [c] = await tx.select().from(consents).where(and(eq(consents.patientId, patientId), eq(consents.scope, "external_context")));
  return Boolean(c?.grantedAt && !c.revokedAt);
}

/** Cuplikan Beauty Code terbaru; hanya bila pasien menyetujui konteks eksternal (dicek SAAT dibaca). */
export async function beautySnapshotFor(tx: Tx, patientId: string): Promise<{ consent_active: boolean; beautycode: BeautySnapshot | null }> {
  if (!(await externalConsentActive(tx, patientId))) return { consent_active: false, beautycode: null };
  const [r] = await tx
    .select()
    .from(externalContext)
    .where(and(eq(externalContext.patientId, patientId), eq(externalContext.source, "beautycode")))
    .orderBy(desc(externalContext.recordedAt), desc(externalContext.createdAt))
    .limit(1);
  if (!r) return { consent_active: true, beautycode: null };
  const d = r.data as { skin_barrier?: number; sleep_hours?: number; diet_triggers?: string[] };
  return {
    consent_active: true,
    beautycode: {
      recorded_at: r.recordedAt.toISOString(),
      skin_barrier: typeof d.skin_barrier === "number" ? d.skin_barrier : null,
      sleep_hours: typeof d.sleep_hours === "number" ? d.sleep_hours : null,
      diet_triggers: Array.isArray(d.diet_triggers) ? d.diet_triggers : [],
    },
  };
}
