import { and, eq } from "drizzle-orm";
import { consentScopes, type ConsentScope, type ConsentStatus } from "@aevia/core";
import { consents, type Db } from "@aevia/db";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listConsents(db: Db, clinicId: string, patientId: string): Promise<ConsentStatus[]> {
  const rows = await db.withTenant(clinicId, (tx) => tx.select().from(consents).where(eq(consents.patientId, patientId)));
  return consentScopes.map((scope) => {
    const r = rows.find((x) => x.scope === scope);
    return {
      scope,
      granted: Boolean(r?.grantedAt && !r.revokedAt),
      granted_at: iso(r?.grantedAt ?? null),
      revoked_at: iso(r?.revokedAt ?? null),
      decided: Boolean(r),
    };
  });
}

export async function setConsent(db: Db, clinicId: string, patientId: string, scope: ConsentScope, granted: boolean, now: Date) {
  await db.withTenant(clinicId, async (tx) => {
    const [cur] = await tx.select().from(consents).where(and(eq(consents.patientId, patientId), eq(consents.scope, scope)));
    if (!cur) {
      await tx.insert(consents).values({
        clinicId,
        patientId,
        scope,
        grantedAt: granted ? now : null,
        revokedAt: granted ? null : now,
        updatedAt: now,
      });
      return;
    }
    await tx
      .update(consents)
      .set(granted ? { grantedAt: now, revokedAt: null, updatedAt: now } : { revokedAt: now, updatedAt: now })
      .where(eq(consents.id, cur.id));
  });
  return listConsents(db, clinicId, patientId);
}
