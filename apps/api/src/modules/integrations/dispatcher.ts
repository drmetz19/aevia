import { createHmac } from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { decryptSecret } from "./crypto";
import { clinics, events, webhookDeliveries, webhookEndpoints, type Db } from "@aevia/db";

export const MAX_ATTEMPTS = 3;
/** Jeda sebelum percobaan ke-2 dan ke-3 (eksponensial: 1 menit, 5 menit). */
export const RETRY_DELAYS_MS = [60_000, 300_000] as const;
const CLAIM_MS = 120_000;
const TIMEOUT_MS = 10_000;

export interface DispatchDeps {
  db: Db;
  now: () => Date;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  encryptionKey: Uint8Array;
}
export interface DispatchResult {
  fanned_out: number;
  attempted: number;
  delivered: number;
  retrying: number;
  failed: number;
}

/** Payload minimal: hanya id (…_id), versi, dan penanda flagged. Tanpa nama, email, atau data klinis. */
export function minimalPayload(p: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(p)) {
    if ((k.endsWith("_id") || k === "version" || k === "flagged") && ["string", "number", "boolean"].includes(typeof v)) out[k] = v as string | number | boolean;
  }
  return out;
}

export function signBody(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function fanOut(d: DispatchDeps, clinicId: string): Promise<number> {
  const now = d.now();
  return d.db.withTenant(clinicId, async (tx) => {
    const pending = await tx.select().from(events).where(isNull(events.deliveredAt)).orderBy(asc(events.createdAt)).limit(200);
    if (!pending.length) return 0;
    const eps = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.active, true));
    for (const ev of pending) {
      for (const ep of eps.filter((e) => e.events.includes("*") || e.events.includes(ev.type))) {
        await tx.insert(webhookDeliveries).values({ clinicId, eventId: ev.id, endpointId: ep.id, nextAttemptAt: now, createdAt: now }).onConflictDoNothing();
      }
      await tx.update(events).set({ deliveredAt: now }).where(eq(events.id, ev.id));
    }
    return pending.length;
  });
}

async function attemptDue(d: DispatchDeps, clinicId: string, res: DispatchResult) {
  const now = d.now();
  const f = d.fetchFn ?? fetch;
  // klaim atomik: pengiriman yang diambil tidak diambil dispatcher lain sampai CLAIM_MS berlalu
  const claimed = await d.db.withTenant(clinicId, (tx) =>
    tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MS) })
      .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now)))
      .returning(),
  );
  for (const dl of claimed) {
    const ctx = await d.db.withTenant(clinicId, async (tx) => {
      const [ep] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, dl.endpointId));
      const [ev] = await tx.select().from(events).where(eq(events.id, dl.eventId));
      return { ep, ev };
    });
    res.attempted++;
    const attempts = dl.attempts + 1;
    let status: "delivered" | "pending" | "failed" = "failed";
    let code: number | null = null;
    let error: string | null = null;
    let next: Date | null = null;
    const maxAttempts = ctx.ev?.type === "webhook.test" ? 1 : MAX_ATTEMPTS;

    if (!ctx.ep || !ctx.ev || (!ctx.ep.active && ctx.ev.type !== "webhook.test")) {
      error = "Endpoint sudah dinonaktifkan atau dihapus.";
    } else {
      const body = JSON.stringify({ id: ctx.ev.id, type: ctx.ev.type, created_at: ctx.ev.createdAt.toISOString(), clinic_id: clinicId, data: minimalPayload(ctx.ev.payload) });
      const ts = Math.floor(d.now().getTime() / 1000);
      try {
        const r = await f(ctx.ep.url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(d.timeoutMs ?? TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "user-agent": "AEVIA-Webhooks/1.0",
            "x-aevia-signature": signBody(decryptSecret(ctx.ep.secret, d.encryptionKey), ts, body),
            "x-aevia-event": ctx.ev.type,
            "x-aevia-delivery": dl.id,
          },
          body,
        });
        code = r.status;
        if (r.status >= 200 && r.status < 300) status = "delivered";
        else error = `Endpoint membalas HTTP ${r.status}.`;
      } catch (e) {
        error = (e as Error)?.name === "TimeoutError" ? "Endpoint tidak membalas tepat waktu." : "Endpoint tidak dapat dihubungi.";
      }
      if (status !== "delivered" && attempts < maxAttempts) {
        status = "pending";
        next = new Date(d.now().getTime() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!));
      }
    }
    if (status === "delivered") res.delivered++;
    else if (status === "pending") res.retrying++;
    else res.failed++;
    await d.db.withTenant(clinicId, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({ status, attempts, lastStatusCode: code, lastError: status === "delivered" ? null : error, nextAttemptAt: next, deliveredAt: status === "delivered" ? d.now() : null })
        .where(eq(webhookDeliveries.id, dl.id)),
    );
  }
}

/** Satu putaran: sebar event outbox ke endpoint, lalu kirim semua pengiriman yang jatuh tempo. Aman dijalankan paralel. */
export async function dispatchOnce(d: DispatchDeps): Promise<DispatchResult> {
  const res: DispatchResult = { fanned_out: 0, attempted: 0, delivered: 0, retrying: 0, failed: 0 };
  const all = await d.db.db.select({ id: clinics.id }).from(clinics);
  for (const { id } of all) {
    res.fanned_out += await fanOut(d, id);
    await attemptDue(d, id, res);
  }
  return res;
}
