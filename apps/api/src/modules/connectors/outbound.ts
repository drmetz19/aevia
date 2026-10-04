import { and, eq, lte, sql } from "drizzle-orm";
import { clinicConnectors, connectorDeliveries, consultationRequests, consultations, events, patients, programs, staff, type Db, type Tx } from "@aevia/db";
import { decryptSecret } from "../integrations/crypto";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, signBody } from "../integrations/sign";
import type { DispatchDeps, DispatchResult } from "../integrations/dispatcher";

const CLAIM_MS = 120_000;
const TIMEOUT_MS = 10_000;

export interface KsConfig extends Record<string, unknown> {
  base_url?: string;
  secret?: string; // terenkripsi (enc:v1:…)
  enabled?: boolean;
  push_requested?: boolean;
}

/** Event yang didorong ke KlinikSistem: accepted selalu; requested bila diaktifkan klinik. */
export const KS_EVENTS = (c: KsConfig) => (c.push_requested ? ["consultation.accepted", "consultation.requested"] : ["consultation.accepted"]);

export async function fanOutConnectors(tx: Tx, clinicId: string, pending: { id: string; type: string }[], now: Date): Promise<void> {
  const [con] = await tx.select().from(clinicConnectors).where(and(eq(clinicConnectors.kind, "kliniksistem")));
  const cfg = (con?.config ?? {}) as KsConfig;
  if (!con || !cfg.enabled || !cfg.base_url || !cfg.secret) return;
  const wanted = new Set(KS_EVENTS(cfg));
  for (const ev of pending) {
    if (wanted.has(ev.type)) await tx.insert(connectorDeliveries).values({ clinicId, connectorId: con.id, eventId: ev.id, nextAttemptAt: now, createdAt: now }).onConflictDoNothing();
  }
}

/** Kontrak payload booking (docs/integrasi/kliniksistem.md). Data kontak hanya dikirim ke sistem klinik itu sendiri. */
export async function buildBooking(tx: Tx, ev: { id: string; type: string; payload: Record<string, unknown> }, clinicSlug: string) {
  const p = ev.payload as { request_id?: string; consultation_id?: string; patient_id?: string };
  const [req] = await tx.select().from(consultationRequests).where(eq(consultationRequests.id, String(p.request_id)));
  if (!req) return null;
  const [pt] = await tx.select().from(patients).where(eq(patients.id, req.patientId));
  const [pr] = await tx.select().from(programs).where(eq(programs.id, req.programId));
  const [k] = await tx.select().from(consultations).where(eq(consultations.requestId, req.id));
  const [prof] = k ? await tx.select().from(staff).where(eq(staff.id, k.professionalId)) : [];
  const prior = await tx
    .select({ ref: connectorDeliveries.externalRef })
    .from(connectorDeliveries)
    .innerJoin(events, eq(events.id, connectorDeliveries.eventId))
    .where(and(sql`${events.payload}->>'request_id' = ${req.id}`, sql`${connectorDeliveries.externalRef} is not null`))
    .limit(1);
  return {
    event: ev.type,
    clinic: clinicSlug,
    booking_id: k?.externalRef ?? prior[0]?.ref ?? null,
    aevia_request_id: req.id,
    aevia_consultation_id: k?.id ?? null,
    patient: { aevia_patient_id: pt!.id, name: pt!.name ?? null, email: pt!.email },
    program: { id: pr!.id, name: pr!.name },
    scheduled_at: k?.scheduledAt.toISOString() ?? null,
    professional: prof ? { id: prof.id, name: prof.name } : null,
    meeting_url: k?.meetingUrl ?? null,
  };
}

export async function attemptConnectorsDue(d: DispatchDeps, clinicId: string, res: DispatchResult): Promise<void> {
  const now = d.now();
  const f = d.fetchFn ?? fetch;
  const claimed = await d.db.withTenant(clinicId, (tx) =>
    tx
      .update(connectorDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MS) })
      .where(and(eq(connectorDeliveries.status, "pending"), lte(connectorDeliveries.nextAttemptAt, now)))
      .returning(),
  );
  for (const dl of claimed) {
    const ctx = await d.db.withTenant(clinicId, async (tx) => {
      const [con] = await tx.select().from(clinicConnectors).where(eq(clinicConnectors.id, dl.connectorId));
      const [ev] = await tx.select().from(events).where(eq(events.id, dl.eventId));
      const slug = (await tx.execute(sql`select slug from clinics where id = ${clinicId}`)) as unknown as { rows: { slug: string }[] };
      return { con, ev, booking: con && ev ? await buildBooking(tx, ev, slug.rows[0]?.slug ?? "") : null };
    });
    res.attempted++;
    const attempts = dl.attempts + 1;
    const cfg = (ctx.con?.config ?? {}) as KsConfig;
    let status: "delivered" | "pending" | "failed" = "failed";
    let code: number | null = null;
    let error: string | null = null;
    let next: Date | null = null;
    let ref: string | null = null;
    if (!ctx.con || !ctx.ev || !ctx.booking || !cfg.enabled || !cfg.base_url || !cfg.secret) {
      error = "Konektor dinonaktifkan atau data booking tidak ditemukan.";
    } else {
      const body = JSON.stringify(ctx.booking);
      const ts = Math.floor(d.now().getTime() / 1000);
      try {
        const r = await f(`${cfg.base_url}/aevia/bookings`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(d.timeoutMs ?? TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "user-agent": "AEVIA-Connector/1.0",
            "x-aevia-signature": signBody(decryptSecret(cfg.secret, d.encryptionKey), ts, body),
            "x-aevia-event": ctx.ev.type,
            "x-aevia-delivery": dl.id,
          },
          body,
        });
        code = r.status;
        if (r.status >= 200 && r.status < 300) {
          status = "delivered";
          const j = (await r.json().catch(() => ({}))) as { booking_id?: unknown };
          ref = typeof j.booking_id === "string" || typeof j.booking_id === "number" ? String(j.booking_id).slice(0, 120) : null;
        } else error = `KlinikSistem membalas HTTP ${r.status}.`;
      } catch (e) {
        error = (e as Error)?.name === "TimeoutError" ? "KlinikSistem tidak membalas tepat waktu." : "KlinikSistem tidak dapat dihubungi.";
      }
      if (status !== "delivered" && attempts < MAX_ATTEMPTS) {
        status = "pending";
        next = new Date(d.now().getTime() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!));
      }
    }
    if (status === "delivered") res.delivered++;
    else if (status === "pending") res.retrying++;
    else res.failed++;
    await d.db.withTenant(clinicId, async (tx) => {
      await tx
        .update(connectorDeliveries)
        .set({ status, attempts, lastStatusCode: code, lastError: status === "delivered" ? null : error, externalRef: ref, nextAttemptAt: next, deliveredAt: status === "delivered" ? d.now() : null })
        .where(eq(connectorDeliveries.id, dl.id));
      if (status === "delivered" && ctx.con) {
        await tx.update(clinicConnectors).set({ lastSyncAt: d.now() }).where(eq(clinicConnectors.id, ctx.con.id));
        const kid = (ctx.ev?.payload as { consultation_id?: string } | undefined)?.consultation_id;
        if (ref && kid) await tx.update(consultations).set({ externalRef: ref }).where(eq(consultations.id, kid));
      }
    });
  }
}
