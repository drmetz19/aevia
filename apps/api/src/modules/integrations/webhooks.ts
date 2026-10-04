import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { webhookInputSchema, webhookUpdateSchema } from "@aevia/core";
import { events, webhookDeliveries, webhookEndpoints, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { newWebhookSecret } from "./secrets";
import { encryptSecret } from "./crypto";

export type Actor = { type: "staff" | "api"; id: string; label?: string };
type Ctx = { db: Db; clinicId: string; actor: Actor; now: Date; encryptionKey: Uint8Array };
const NOT_FOUND = "Endpoint webhook ini belum ditemukan.";

const view = (e: typeof webhookEndpoints.$inferSelect) => ({ id: e.id, url: e.url, events: e.events, active: e.active, created_at: e.createdAt.toISOString() });
const audit = (tx: Tx, c: Ctx, id: string, action: string, before: unknown, after: unknown) =>
  writeAudit(tx, {
    clinicId: c.clinicId,
    actorType: c.actor.type,
    actorId: c.actor.id,
    entity: "webhook_endpoint",
    entityId: id,
    action,
    before,
    after: c.actor.label && after && typeof after === "object" ? { ...(after as object), via: c.actor.label } : after,
    at: c.now,
  });

export async function listWebhooks(c: Ctx) {
  return c.db.withTenant(c.clinicId, async (tx) => (await tx.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt))).map(view));
}

export async function createWebhook(c: Ctx, body: z.infer<typeof webhookInputSchema>) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const secret = newWebhookSecret();
    const [row] = await tx.insert(webhookEndpoints).values({ clinicId: c.clinicId, url: body.url, secret: encryptSecret(secret, c.encryptionKey), events: [...new Set(body.events)], createdBy: c.actor.id, createdAt: c.now }).returning();
    await audit(tx, c, row!.id, "webhook.create", null, { url: row!.url, events: row!.events });
    return { ...view(row!), secret };
  });
}

export async function updateWebhook(c: Ctx, id: string, body: z.infer<typeof webhookUpdateSchema>) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [before] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    if (!before) throw new AuthError(404, "webhook_not_found", NOT_FOUND);
    const [row] = await tx
      .update(webhookEndpoints)
      .set({ ...(body.url !== undefined ? { url: body.url } : {}), ...(body.events ? { events: [...new Set(body.events)] } : {}), ...(body.active !== undefined ? { active: body.active } : {}) })
      .where(eq(webhookEndpoints.id, id))
      .returning();
    await audit(tx, c, id, "webhook.update", { url: before.url, events: before.events, active: before.active }, { url: row!.url, events: row!.events, active: row!.active });
    return view(row!);
  });
}

export async function deleteWebhook(c: Ctx, id: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [row] = await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning();
    if (!row) throw new AuthError(404, "webhook_not_found", NOT_FOUND);
    await audit(tx, c, id, "webhook.delete", { url: row.url, events: row.events }, null);
  });
}

export async function listDeliveries(c: Ctx, endpointId: string) {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [e] = await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId));
    if (!e) throw new AuthError(404, "webhook_not_found", NOT_FOUND);
    const rows = await tx
      .select({ d: webhookDeliveries, type: events.type })
      .from(webhookDeliveries)
      .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
      .where(eq(webhookDeliveries.endpointId, endpointId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return rows.map(({ d, type }) => ({
      id: d.id,
      event_id: d.eventId,
      event_type: type,
      status: d.status,
      attempts: d.attempts,
      last_status_code: d.lastStatusCode,
      last_error: d.lastError,
      next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
    }));
  });
}

/** Buat event uji + pengiriman terjadwal untuk satu endpoint (tidak disebar ke endpoint lain). Dikirim oleh dispatcher. */
export async function queueTest(c: Ctx, endpointId: string): Promise<string> {
  return c.db.withTenant(c.clinicId, async (tx) => {
    const [e] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId)));
    if (!e) throw new AuthError(404, "webhook_not_found", NOT_FOUND);
    const [ev] = await tx.insert(events).values({ clinicId: c.clinicId, type: "webhook.test", payload: { endpoint_id: endpointId }, createdAt: c.now, deliveredAt: c.now }).returning();
    const [d] = await tx.insert(webhookDeliveries).values({ clinicId: c.clinicId, eventId: ev!.id, endpointId, nextAttemptAt: c.now, createdAt: c.now }).returning();
    await audit(tx, c, endpointId, "webhook.test", null, { delivery_id: d!.id });
    return d!.id;
  });
}
