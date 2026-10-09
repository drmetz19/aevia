import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { beautycodeConfigInputSchema, connectorConfigInputSchema } from "@aevia/core";
import { clinicConnectors, connectorDeliveries, events, writeAudit, type Db } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { decryptSecret, encryptSecret } from "../integrations/crypto";
import { randomToken } from "../integrations/secrets";
import { signBody } from "../integrations/sign";
import type { KsConfig } from "./outbound";
import { pullBeautycode, type BcConfig } from "./pull";

type Ctx = { db: Db; clinicId: string; actorId: string; now: Date; encryptionKey: Uint8Array; fetchFn?: typeof fetch };
type Row = typeof clinicConnectors.$inferSelect;

const ksView = (r?: Row) => {
  const c = (r?.config ?? {}) as KsConfig;
  return { kind: "kliniksistem" as const, configured: Boolean(r && c.base_url), enabled: Boolean(c.enabled), base_url: c.base_url ?? null, push_requested: Boolean(c.push_requested), has_secret: Boolean(c.secret), last_sync_at: r?.lastSyncAt?.toISOString() ?? null, remote_clinic_id: null, last_pull: null };
};
const bcView = (r?: Row) => {
  const c = (r?.config ?? {}) as BcConfig;
  return { kind: "beautycode" as const, configured: Boolean(r), enabled: r ? c.enabled !== false : true, base_url: c.pull_base_url ?? null, push_requested: false, has_secret: Boolean(c.api_key), last_sync_at: r?.lastSyncAt?.toISOString() ?? null, remote_clinic_id: c.pull_clinic_id ?? null, last_pull: c.last_pull ?? null };
};

export async function overview(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const rows = await tx.select().from(clinicConnectors);
    const ds = await tx
      .select({ d: connectorDeliveries, type: events.type })
      .from(connectorDeliveries)
      .innerJoin(events, eq(events.id, connectorDeliveries.eventId))
      .orderBy(desc(connectorDeliveries.createdAt))
      .limit(20);
    return {
      connectors: [ksView(rows.find((r) => r.kind === "kliniksistem")), bcView(rows.find((r) => r.kind === "beautycode"))],
      deliveries: ds.map(({ d, type }) => ({ id: d.id, event_type: type, status: d.status, attempts: d.attempts, last_status_code: d.lastStatusCode, last_error: d.lastError, external_ref: d.externalRef, created_at: d.createdAt.toISOString() })),
    };
  });
}

export async function saveKliniksistem(c: Ctx, body: z.infer<typeof connectorConfigInputSchema>) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, "kliniksistem"));
    const old = (before?.config ?? {}) as KsConfig;
    let secretPlain: string | null = null;
    let secret = old.secret;
    if (!secret || body.rotate_secret) {
      secretPlain = `kssec_${randomToken(32)}`;
      secret = encryptSecret(secretPlain, c.encryptionKey);
    }
    const config: KsConfig = { base_url: body.base_url, secret, enabled: body.enabled, push_requested: body.push_requested };
    const [row] = before
      ? await tx.update(clinicConnectors).set({ config }).where(eq(clinicConnectors.id, before.id)).returning()
      : await tx.insert(clinicConnectors).values({ clinicId: c.clinicId, kind: "kliniksistem", config, createdAt: c.now }).returning();
    await writeAudit(tx, {
      clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "connector", entityId: row!.id, action: "connector.update",
      before: before ? { base_url: old.base_url, enabled: old.enabled, push_requested: old.push_requested } : null,
      after: { kind: "kliniksistem", base_url: body.base_url, enabled: body.enabled, push_requested: body.push_requested, secret_rotated: Boolean(secretPlain) },
      at: c.now,
    });
    return { ...ksView(row), secret: secretPlain };
  });
}

export async function saveBeautycode(c: Ctx, body: z.infer<typeof beautycodeConfigInputSchema>) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, "beautycode"));
    const old = (before?.config ?? {}) as BcConfig;
    const config: BcConfig = { ...old, enabled: body.enabled };
    if (body.pull_base_url !== undefined) config.pull_base_url = body.pull_base_url || undefined;
    if (body.pull_clinic_id !== undefined) config.pull_clinic_id = body.pull_clinic_id || undefined;
    if (body.api_key) config.api_key = encryptSecret(body.api_key, c.encryptionKey);
    if (!config.pull_base_url && !config.pull_clinic_id) delete config.api_key; // sinkron dimatikan sepenuhnya
    const [row] = before
      ? await tx.update(clinicConnectors).set({ config }).where(eq(clinicConnectors.id, before.id)).returning()
      : await tx.insert(clinicConnectors).values({ clinicId: c.clinicId, kind: "beautycode", config, createdAt: c.now }).returning();
    await writeAudit(tx, {
      clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "connector", entityId: row!.id, action: "connector.update",
      before: before ? { enabled: old.enabled, pull_base_url: old.pull_base_url ?? null, pull_clinic_id: old.pull_clinic_id ?? null } : null,
      after: { kind: "beautycode", enabled: body.enabled, pull_base_url: config.pull_base_url ?? null, pull_clinic_id: config.pull_clinic_id ?? null, api_key_changed: Boolean(body.api_key) },
      at: c.now,
    });
    return { ...bcView(row), secret: null };
  });
}

export async function syncBeautycode(c: Ctx) {
  return pullBeautycode({ db: c.db, clinicId: c.clinicId, now: c.now, encryptionKey: c.encryptionKey, fetchFn: c.fetchFn, actor: { type: "staff", id: c.actorId } });
}

/** Uji koneksi: kirim aevia.ping bertanda tangan ke {base_url}/aevia/ping; sukses bila 2xx. */
export async function testKliniksistem(c: Ctx) {
  const row = await c.db.withTenant(c.clinicId, async (tx) => (await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, "kliniksistem")))[0]);
  const cfg = (row?.config ?? {}) as KsConfig;
  if (!row || !cfg.base_url || !cfg.secret) throw new AuthError(409, "connector_not_configured", "Konektor KlinikSistem belum diatur. Isi alamat dan simpan lebih dulu.");
  const body = JSON.stringify({ event: "aevia.ping", clinic_id: c.clinicId, sent_at: c.now.toISOString() });
  const ts = Math.floor(c.now.getTime() / 1000);
  let result: { ok: boolean; status_code: number | null; message: string };
  try {
    const r = await (c.fetchFn ?? fetch)(`${cfg.base_url}/aevia/ping`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "user-agent": "AEVIA-Connector/1.0", "x-aevia-signature": signBody(decryptSecret(cfg.secret, c.encryptionKey), ts, body), "x-aevia-event": "aevia.ping" },
      body,
    });
    result = r.status >= 200 && r.status < 300 ? { ok: true, status_code: r.status, message: "Koneksi berhasil. KlinikSistem membalas dengan baik." } : { ok: false, status_code: r.status, message: `KlinikSistem membalas HTTP ${r.status}. Periksa alamat dan verifikasi tanda tangan di sisi KlinikSistem.` };
  } catch {
    result = { ok: false, status_code: null, message: "KlinikSistem tidak dapat dihubungi. Periksa alamat dan pastikan dapat diakses dari internet." };
  }
  await c.db.withTenant(c.clinicId, async (tx) => {
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "connector", entityId: row.id, action: "connector.test", before: null, after: { ok: result.ok, status_code: result.status_code }, at: c.now });
  });
  return result;
}
