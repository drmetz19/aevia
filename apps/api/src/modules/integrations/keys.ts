import { and, desc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { createApiKeySchema, createOauthClientSchema } from "@aevia/core";
import { apiKeys, oauthClients, writeAudit, type Db } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { newApiKey, newClient, sha256 } from "./secrets";

type Ctx = { db: Db; clinicId: string; actorId: string; now: Date };
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const keyView = (k: typeof apiKeys.$inferSelect) => ({
  id: k.id,
  name: k.name,
  mode: k.mode,
  prefix: k.prefix,
  scopes: k.scopes,
  created_at: k.createdAt.toISOString(),
  last_used_at: iso(k.lastUsedAt),
  revoked_at: iso(k.revokedAt),
});
const clientView = (c: typeof oauthClients.$inferSelect) => ({
  id: c.id,
  name: c.name,
  client_id: c.clientId,
  scopes: c.scopes,
  created_at: c.createdAt.toISOString(),
  last_used_at: iso(c.lastUsedAt),
  revoked_at: iso(c.revokedAt),
});

export async function listKeys(c: Ctx) {
  return (await c.db.db.select().from(apiKeys).where(eq(apiKeys.clinicId, c.clinicId)).orderBy(desc(apiKeys.createdAt))).map(keyView);
}
export async function listClients(c: Ctx) {
  return (await c.db.db.select().from(oauthClients).where(eq(oauthClients.clinicId, c.clinicId)).orderBy(desc(oauthClients.createdAt))).map(clientView);
}

export async function createKey(c: Ctx, body: z.infer<typeof createApiKeySchema>) {
  const k = newApiKey(body.mode);
  return c.db.ownerTx(c.clinicId, async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({ clinicId: c.clinicId, name: body.name, mode: body.mode, prefix: k.prefix, keyHash: k.hash, scopes: [...new Set(body.scopes)], createdBy: c.actorId, createdAt: c.now })
      .returning();
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "api_key", entityId: row!.id, action: "api_key.create", before: null, after: { name: body.name, prefix: k.prefix, scopes: row!.scopes }, at: c.now });
    return { ...keyView(row!), secret: k.secret };
  });
}

export async function revokeKey(c: Ctx, id: string) {
  return c.db.ownerTx(c.clinicId, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: c.now })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.clinicId, c.clinicId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) throw new AuthError(404, "key_not_found", "Kunci API ini belum ditemukan atau sudah dicabut.");
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "api_key", entityId: id, action: "api_key.revoke", before: { prefix: row.prefix }, after: { revoked: true }, at: c.now });
    return keyView(row);
  });
}

export async function createClient(c: Ctx, body: z.infer<typeof createOauthClientSchema>) {
  const n = newClient();
  return c.db.ownerTx(c.clinicId, async (tx) => {
    const [row] = await tx
      .insert(oauthClients)
      .values({ clinicId: c.clinicId, name: body.name, clientId: n.clientId, secretHash: sha256(n.secret), scopes: [...new Set(body.scopes)], createdBy: c.actorId, createdAt: c.now })
      .returning();
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "oauth_client", entityId: row!.id, action: "oauth_client.create", before: null, after: { name: body.name, client_id: n.clientId, scopes: row!.scopes }, at: c.now });
    return { ...clientView(row!), client_secret: n.secret };
  });
}

export async function revokeClient(c: Ctx, id: string) {
  return c.db.ownerTx(c.clinicId, async (tx) => {
    const [row] = await tx
      .update(oauthClients)
      .set({ revokedAt: c.now })
      .where(and(eq(oauthClients.id, id), eq(oauthClients.clinicId, c.clinicId), isNull(oauthClients.revokedAt)))
      .returning();
    if (!row) throw new AuthError(404, "client_not_found", "Klien OAuth ini belum ditemukan atau sudah dicabut.");
    await writeAudit(tx, { clinicId: c.clinicId, actorType: "staff", actorId: c.actorId, entity: "oauth_client", entityId: id, action: "oauth_client.revoke", before: { client_id: row.clientId }, after: { revoked: true }, at: c.now });
    return clientView(row);
  });
}
