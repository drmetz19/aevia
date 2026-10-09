import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";
import { dispatchOnce, RETRY_DELAYS_MS } from "../integrations/dispatcher";
import { createMockKlinikSistem } from "../../testing/mock-kliniksistem";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const ENC = new Uint8Array(32).fill(5);
const KS = "https://ks.drmetz.test";
const mock = createMockKlinikSistem("", { nowMs: () => clock.getTime() });

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-con-")), secret: new TextEncoder().encode(SECRET) });
  app = await buildApp({ db, jwtSecret: SECRET, now: () => clock, storage, anthropicApiKey: "", encryptionKey: ENC, fetchFn: mock.fetch, otpSender: { send: async (m) => void (m.code && sent.push({ email: m.email, code: m.code })) } });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, payload?: object, extra: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra } });
const staffToken = async (email: string) => {
  await call("POST", "/v1/staff/auth/otp", null, { email });
  return (await call("POST", "/v1/staff/auth/verify", null, { email, code: code(email) })).json().token as string;
};
async function patient(slug: string, email: string) {
  await call("POST", `/v1/clinics/${slug}/auth/otp`, null, { email });
  const t = (await call("POST", `/v1/clinics/${slug}/auth/verify`, null, { email, code: code(email) })).json().token as string;
  const me = (await call("GET", `/v1/clinics/${slug}/me`, t)).json();
  return { token: t, id: me.id as string, email };
}
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;
const run = () => dispatchOnce({ db, now: () => clock, fetchFn: mock.fetch, encryptionKey: ENC });

let adminA: string;
let adminB: string;
let proA: string;
let keyW: string; // integrations:write klinik A
let keyNoScope: string;
let keyB: string;
let secretA = "";

async function mkKey(admin: string, scopes: string[]) {
  return (await call("POST", "/v1/staff/integrations/api-keys", admin, { name: "Konektor", scopes })).json().secret as string;
}
async function requestAndAccept(pat: { token: string; id: string }, programIdx = 0) {
  const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
  const rq = (await call("POST", "/v1/consultation-requests", pat.token, { program_id: progs[programIdx].id, prep: { tujuan: "Tidur lebih baik", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
  const acc = await call("POST", `/v1/staff/consultation-requests/${rq.id}/accept`, proA, { scheduled_at: "2026-10-10T03:00:00.000Z", meeting_url: "https://meet.contoh.id/abc" });
  expect(acc.statusCode).toBe(200);
  return { requestId: rq.id as string, consultationId: acc.json().consultation.id as string, programName: progs[programIdx].name as string };
}

beforeAll(async () => {
  adminA = await staffToken("admin@drmetz.test");
  adminB = await staffToken("admin@demo-partner.test");
  proA = await staffToken("dr.metz@drmetz.test");
  keyW = await mkKey(adminA, ["integrations:write"]);
  keyNoScope = await mkKey(adminA, ["read:patients"]);
  keyB = await mkKey(adminB, ["integrations:write"]);
});

describe("konfigurasi konektor (konsol)", () => {
  it("hanya admin klinik; alamat harus https dan bukan internal; rahasia tampil sekali dan terenkripsi at-rest", async () => {
    for (const t of [proA]) expect((await call("GET", "/v1/staff/connectors", t)).statusCode).toBe(403);
    expect((await call("GET", "/v1/staff/connectors", null)).statusCode).toBe(401);
    for (const base_url of ["http://ks.drmetz.test", "https://localhost", "https://192.168.0.5", "bukan-url"]) {
      expect((await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url, enabled: true })).statusCode, base_url).toBe(400);
    }
    const ov0 = (await call("GET", "/v1/staff/connectors", adminA)).json();
    expect(ov0.connectors.map((c: { kind: string; configured: boolean }) => `${c.kind}:${c.configured}`)).toEqual(["kliniksistem:false", "beautycode:false"]);

    const r = await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: `${KS}/`, enabled: true });
    expect(r.statusCode).toBe(200);
    secretA = r.json().secret;
    expect(secretA).toMatch(/^kssec_/);
    expect(r.json()).toMatchObject({ base_url: KS, enabled: true, push_requested: false, has_secret: true });
    mock.secret.value = secretA;
    const [st] = await rows<{ config: { secret: string; base_url: string } }>(sql`SELECT config FROM clinic_connectors WHERE kind = 'kliniksistem'`);
    expect(st!.config.secret).toMatch(/^enc:v1:/);
    expect(JSON.stringify(st)).not.toContain(secretA);
    const ov = JSON.stringify((await call("GET", "/v1/staff/connectors", adminA)).json());
    expect(ov).not.toContain(secretA);
    // simpan ulang tanpa memutar → rahasia tetap, tidak ditampilkan lagi
    const again = (await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: true })).json();
    expect(again.secret).toBeNull();
    expect((await call("GET", "/v1/staff/connectors", adminB)).json().connectors[0].configured).toBe(false);
    const aud = await rows<{ action: string; after: { secret_rotated: boolean } }>(sql`SELECT action, after FROM audit_logs WHERE entity = 'connector' AND action = 'connector.update' ORDER BY at, id`);
    expect(aud.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(aud)).not.toContain(secretA);
  });

  it("Uji koneksi: ping bertanda tangan diterima mock; salah rahasia → gagal dengan pesan jelas; belum diatur → 409", async () => {
    const ok = await call("POST", "/v1/staff/connectors/kliniksistem/test", adminA);
    expect(ok.json()).toMatchObject({ ok: true, status_code: 200 });
    expect(mock.pings.at(-1)!.headers["x-aevia-event"]).toBe("aevia.ping");
    mock.secret.value = "rahasia-lain";
    const bad = (await call("POST", "/v1/staff/connectors/kliniksistem/test", adminA)).json();
    expect(bad).toMatchObject({ ok: false, status_code: 401 });
    expect(bad.message).toMatch(/tanda tangan/);
    mock.secret.value = secretA;
    mock.failWith = () => 0;
    expect((await call("POST", "/v1/staff/connectors/kliniksistem/test", adminA)).json()).toMatchObject({ ok: false, status_code: null });
    mock.failWith = null;
    expect((await call("POST", "/v1/staff/connectors/kliniksistem/test", adminB)).statusCode).toBe(409);
  });

  it("rotasi rahasia menghasilkan rahasia baru (sekali) dan yang lama tak lagi valid", async () => {
    const rot = (await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: true, rotate_secret: true })).json();
    expect(rot.secret).toMatch(/^kssec_/);
    expect(rot.secret).not.toBe(secretA);
    secretA = rot.secret;
    mock.secret.value = secretA;
    expect((await call("POST", "/v1/staff/connectors/kliniksistem/test", adminA)).json().ok).toBe(true);
  });
});

describe("KlinikSistem outbound", () => {
  let pat: { token: string; id: string; email: string };
  let k: { requestId: string; consultationId: string; programName: string };
  it("konsultasi diterima → mock menerima booking sesuai kontrak, bertanda tangan; external_ref tersimpan", async () => {
    pat = await patient("drmetz", "ks-1@contoh.test");
    mock.bookings.length = 0;
    mock.rejected = 0;
    k = await requestAndAccept(pat);
    const res = await run();
    expect(res).toMatchObject({ delivered: 1, failed: 0 });
    expect(mock.bookings).toHaveLength(1);
    const b = mock.bookings[0]!;
    expect(b.headers["x-aevia-event"]).toBe("consultation.accepted");
    expect(b.headers["x-aevia-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.body).toMatchObject({
      event: "consultation.accepted",
      clinic: "drmetz",
      booking_id: null,
      aevia_request_id: k.requestId,
      aevia_consultation_id: k.consultationId,
      patient: { aevia_patient_id: pat.id, email: pat.email },
      program: { name: k.programName },
      scheduled_at: "2026-10-10T03:00:00.000Z",
      professional: { name: "dr. Metz" },
      meeting_url: "https://meet.contoh.id/abc",
    });
    expect(b.body.patient).toHaveProperty("name");
    expect(mock.rejected).toBe(0);
    const [c] = await rows<{ external_ref: string }>(sql`SELECT external_ref FROM consultations WHERE id = ${k.consultationId}`);
    expect(c!.external_ref).toBe("KS-1001");
    const ov = (await call("GET", "/v1/staff/connectors", adminA)).json();
    expect(ov.connectors[0].last_sync_at).not.toBeNull();
    expect(ov.deliveries[0]).toMatchObject({ event_type: "consultation.accepted", status: "delivered", external_ref: "KS-1001" });
    expect((await run()).attempted).toBe(0); // tidak dikirim ulang
  });

  it("consultation.requested hanya dikirim bila diaktifkan; accepted berikutnya menautkan booking_id lama", async () => {
    mock.bookings.length = 0;
    const p2 = await patient("drmetz", "ks-2@contoh.test");
    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    await call("POST", "/v1/consultation-requests", p2.token, { program_id: progs[1].id, prep: { tujuan: "x", keluhan: "", pertanyaan: [], konteks_assessment: "" } });
    await run();
    expect(mock.bookings).toHaveLength(0);
    await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: true, push_requested: true });
    const p3 = await patient("drmetz", "ks-3@contoh.test");
    const rq = (await call("POST", "/v1/consultation-requests", p3.token, { program_id: progs[2].id, prep: { tujuan: "y", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
    await run();
    expect(mock.bookings).toHaveLength(1);
    expect(mock.bookings[0]!.body).toMatchObject({ event: "consultation.requested", aevia_request_id: rq.id, aevia_consultation_id: null, scheduled_at: null, professional: null, meeting_url: null });
    const first = mock.bookings[0]!.booking_id;
    await call("POST", `/v1/staff/consultation-requests/${rq.id}/accept`, proA, { scheduled_at: "2026-10-11T03:00:00.000Z", meeting_url: "https://meet.contoh.id/def" });
    await run();
    expect(mock.bookings[1]!.body).toMatchObject({ event: "consultation.accepted", booking_id: first });
    await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: true, push_requested: false });
  });

  it("gagal → retry dengan backoff 1 lalu 5 menit, tepat 3 percobaan, lalu failed", async () => {
    mock.bookings.length = 0;
    const p = await patient("drmetz", "ks-4@contoh.test");
    mock.failWith = () => 503;
    const k2 = await requestAndAccept(p, 1);
    expect(await run()).toMatchObject({ attempted: 1, retrying: 1 });
    expect((await run()).attempted).toBe(0);
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[0]);
    expect(await run()).toMatchObject({ attempted: 1, retrying: 1 });
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[1]);
    expect(await run()).toMatchObject({ attempted: 1, failed: 1 });
    const d = (await call("GET", "/v1/staff/connectors", await staffToken("admin@drmetz.test"))).json().deliveries.find((x: { attempts: number }) => x.attempts === 3);
    expect(d).toMatchObject({ status: "failed", attempts: 3, last_status_code: 503 });
    expect(mock.bookings).toHaveLength(0);
    mock.failWith = null;
    void k2;
    adminA = await staffToken("admin@drmetz.test");
    proA = await staffToken("dr.metz@drmetz.test");
    adminB = await staffToken("admin@demo-partner.test");
  });

  it("pulih pada percobaan ke-2 → delivered; konektor dinonaktifkan → tidak dikirim", async () => {
    mock.bookings.length = 0;
    const p = await patient("drmetz", "ks-5@contoh.test");
    let n = 0;
    mock.failWith = () => (n++ === 0 ? 0 : null);
    await requestAndAccept(p, 2);
    expect(await run()).toMatchObject({ retrying: 1 });
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[0]);
    expect(await run()).toMatchObject({ delivered: 1 });
    mock.failWith = null;
    await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: false });
    mock.bookings.length = 0;
    const p6 = await patient("drmetz", "ks-6@contoh.test");
    await requestAndAccept(p6, 0);
    await run();
    expect(mock.bookings).toHaveLength(0);
    await call("PUT", "/v1/staff/connectors/kliniksistem", adminA, { base_url: KS, enabled: true });
  });
});

describe("KlinikSistem inbound: visits", () => {
  let k: { requestId: string; consultationId: string };
  const visit = (token: string | null, body: object, eventId?: string) => call("POST", "/v1/integrations/kliniksistem/visits", token, body, eventId ? { "x-event-id": eventId } : {});
  const status = async (id: string) => (await rows<{ status: string; payment_status: string | null; external_ref: string | null }>(sql`SELECT status, payment_status, external_ref FROM consultations WHERE id = ${id}`))[0]!;

  it("wajib auth + cakupan integrations:write; kunci klinik lain ditolak; tanpa kredensial 401", async () => {
    const pat = await patient("drmetz", "ks-v1@contoh.test");
    k = await requestAndAccept(pat);
    await run();
    const body = { aevia_consultation_id: k.consultationId, status: "Completed", occurred_at: "2026-10-10T04:00:00Z" };
    expect((await visit(null, body)).statusCode).toBe(401);
    const no = await visit(keyNoScope, body);
    expect(no.statusCode).toBe(403);
    expect(no.json().message).toMatch(/integrations:write/);
    expect((await visit(await staffToken("admin@drmetz.test"), body)).statusCode).toBe(401);
    const other = await visit(keyB, body);
    expect(other.statusCode).toBe(404); // konsultasi klinik A tak terjangkau dari klinik B
    expect((await status(k.consultationId)).status).toBe("scheduled");
  });

  it("Completed (via booking_id) mengubah status konsultasi, menyimpan pembayaran, memicu event, diaudit", async () => {
    const ref = (await status(k.consultationId)).external_ref!;
    expect(ref).toMatch(/^KS-/);
    const r = await visit(keyW, { booking_id: ref, status: "Completed", payment_status: "Paid", occurred_at: "2026-10-10T04:00:00Z" }, "evt-1");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ consultation_id: k.consultationId, status: "completed", payment_status: "paid", changed: true });
    expect(await status(k.consultationId)).toMatchObject({ status: "completed", payment_status: "paid" });
    const ev = await rows<{ payload: { status: string } }>(sql`SELECT payload FROM events WHERE type = 'consultation.status_changed' AND payload->>'consultation_id' = ${k.consultationId}`);
    expect(ev.map((e) => e.payload.status)).toEqual(["completed"]);
    const a = await rows<{ actor_type: string; action: string; after: { via: string } }>(sql`SELECT actor_type, action, after FROM audit_logs WHERE entity_id = ${k.consultationId} AND action = 'integration.kliniksistem.visit'`);
    expect(a).toHaveLength(1);
    expect(a[0]!.actor_type).toBe("api");
    expect(a[0]!.after.via).toMatch(/^api:aev_live_/);
  });

  it("idempoten: event id yang sama mengembalikan hasil sama tanpa efek ganda; tanpa header pun aman", async () => {
    const ref = (await status(k.consultationId)).external_ref!;
    const rep = await visit(keyW, { booking_id: ref, status: "Completed", payment_status: "Paid", occurred_at: "2026-10-10T04:00:00Z" }, "evt-1");
    expect(rep.statusCode).toBe(200);
    expect(rep.headers["x-idempotent-replay"]).toBe("true");
    expect(rep.json().changed).toBe(true); // hasil pertama diputar ulang
    const noHdr = await visit(keyW, { booking_id: ref, status: "Completed", occurred_at: "2026-10-10T04:00:00Z" });
    expect(noHdr.json().changed).toBe(false);
    const ev = await rows<{ n: string }>(sql`SELECT count(*)::text n FROM events WHERE type = 'consultation.status_changed' AND payload->>'consultation_id' = ${k.consultationId}`);
    expect(ev[0]!.n).toBe("1");
  });

  it("urutan: Scheduled setelah Completed → 409; kejadian lebih lama (stale) diabaikan; koreksi ke status akhir lain diizinkan", async () => {
    const ref = (await status(k.consultationId)).external_ref!;
    const back = await visit(keyW, { booking_id: ref, status: "Scheduled", occurred_at: "2026-10-10T05:00:00Z" });
    expect(back.statusCode).toBe(409);
    expect(back.json().error).toBe("invalid_transition");
    const stale = await visit(keyW, { booking_id: ref, status: "No-show", occurred_at: "2026-10-10T03:00:00Z" });
    expect(stale.json()).toMatchObject({ status: "completed", changed: false });
    const fix = await visit(keyW, { booking_id: ref, status: "No-show", payment_status: "Unpaid", occurred_at: "2026-10-10T06:00:00Z" });
    expect(fix.json()).toMatchObject({ status: "no_show", payment_status: "unpaid", changed: true });
  });

  it("No-show / Cancelled terpetakan; booking_id tak dikenal 404; booking_id bentrok 409; validasi badan", async () => {
    const pat = await patient("drmetz", "ks-v2@contoh.test");
    const k2 = await requestAndAccept(pat, 1);
    expect((await visit(keyW, { aevia_consultation_id: k2.consultationId, status: "Cancelled", occurred_at: "2026-10-10T04:00:00Z" })).json().status).toBe("cancelled");
    expect((await visit(keyW, { booking_id: "KS-TIDAK-ADA", status: "Completed", occurred_at: "2026-10-10T04:00:00Z" })).statusCode).toBe(404);
    // tautkan booking pertama lewat id, lalu booking_id berbeda → 409
    const linked = await visit(keyW, { aevia_consultation_id: k2.consultationId, booking_id: "KS-LINK-1", status: "Cancelled", occurred_at: "2026-10-10T04:30:00Z" });
    expect(linked.statusCode).toBe(200);
    expect((await status(k2.consultationId)).external_ref).toBe("KS-LINK-1");
    expect((await visit(keyW, { aevia_consultation_id: k2.consultationId, booking_id: "KS-LAIN", status: "Cancelled", occurred_at: "2026-10-10T05:00:00Z" })).json().error).toBe("booking_mismatch");
    for (const bad of [{ status: "Completed", occurred_at: "2026-10-10T04:00:00Z" }, { booking_id: "x", status: "Selesai", occurred_at: "2026-10-10T04:00:00Z" }, { booking_id: "x", status: "Completed", payment_status: "Lunas", occurred_at: "2026-10-10T04:00:00Z" }, { booking_id: "x", status: "Completed", occurred_at: "kemarin" }]) {
      expect((await visit(keyW, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it("webhook consultation.status_changed ikut dikirim ke endpoint webhook (payload minimal: id + status)", async () => {
    const hook = (await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/status", events: ["consultation.status_changed"] })).json();
    expect(hook.id).toBeTruthy();
    const pat = await patient("drmetz", "ks-v3@contoh.test");
    const k3 = await requestAndAccept(pat, 2);
    await visit(keyW, { aevia_consultation_id: k3.consultationId, status: "Completed", occurred_at: "2026-10-10T04:00:00Z" });
    mock.bookings.length = 0;
    const seen: string[] = [];
    const f = (async (u: string, init: { body: string }) => {
      if (u === "https://contoh.id/status") seen.push(init.body);
      return mock.fetch(u, init as RequestInit);
    }) as unknown as typeof fetch;
    await dispatchOnce({ db, now: () => clock, fetchFn: f, encryptionKey: ENC });
    const mine = seen.map((b) => JSON.parse(b)).filter((b) => b.data.consultation_id === k3.consultationId);
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("consultation.status_changed");
    expect(mine[0].data).toEqual({ consultation_id: k3.consultationId, patient_id: pat.id, status: "completed" });
  });
});

describe("BeautyCode inbound: tracker", () => {
  const track = (token: string | null, body: object, eventId?: string) => call("POST", "/v1/integrations/beautycode/tracker", token, body, eventId ? { "x-event-id": eventId } : {});
  const grant = (p: { token: string }, granted: boolean) => call("PUT", "/v1/me/consents", p.token, { scope: "external_context", granted });
  let pat: { token: string; id: string; email: string };
  const reading = { recorded_at: "2026-10-03T22:00:00Z", skin_barrier: 62, sleep_hours: 5.5, diet_triggers: ["gula", "susu"] };

  it("tanpa consent external_context → 403 consent_required (tidak ada baris tersimpan)", async () => {
    pat = await patient("drmetz", "bc-1@contoh.test");
    const r = await track(keyW, { aevia_patient_id: pat.id, ...reading });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("consent_required");
    const n = await rows<{ n: string }>(sql`SELECT count(*)::text n FROM external_context WHERE patient_id = ${pat.id}`);
    expect(n[0]!.n).toBe("0");
  });

  it("wajib cakupan integrations:write dan kunci klinik yang sama; pasien klinik lain 404", async () => {
    await grant(pat, true);
    expect((await track(null, { aevia_patient_id: pat.id, ...reading })).statusCode).toBe(401);
    expect((await track(keyNoScope, { aevia_patient_id: pat.id, ...reading })).statusCode).toBe(403);
    expect((await track(keyB, { aevia_patient_id: pat.id, ...reading })).statusCode).toBe(404);
    expect((await track(keyB, { email: pat.email, ...reading })).statusCode).toBe(404);
  });

  it("dengan consent: tersimpan (lewat id atau email), idempoten, diaudit; validasi badan", async () => {
    const r = await track(keyW, { aevia_patient_id: pat.id, ...reading }, "bc-evt-1");
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ patient_id: pat.id });
    expect(JSON.stringify(r.json())).not.toContain(pat.email);
    const rep = await track(keyW, { aevia_patient_id: pat.id, ...reading }, "bc-evt-1");
    expect(rep.statusCode).toBe(200);
    expect(rep.headers["x-idempotent-replay"]).toBe("true");
    expect(rep.json().id).toBe(r.json().id);
    const byEmail = await track(keyW, { email: pat.email.toUpperCase(), recorded_at: "2026-10-04T08:00:00Z", skin_barrier: 70, sleep_hours: 7, diet_triggers: ["gula"], raw: { catatan: "ok" } });
    expect(byEmail.statusCode).toBe(201);
    const n = await rows<{ n: string }>(sql`SELECT count(*)::text n FROM external_context WHERE patient_id = ${pat.id}`);
    expect(n[0]!.n).toBe("2");
    const a = await rows<{ actor_type: string; after: { fields: string[] } }>(sql`SELECT actor_type, after FROM audit_logs WHERE entity = 'external_context' ORDER BY at, id`);
    expect(a).toHaveLength(2);
    expect(a[0]!.actor_type).toBe("api");
    for (const bad of [{ ...reading }, { aevia_patient_id: pat.id, recorded_at: "2026-10-03T22:00:00Z" }, { aevia_patient_id: pat.id, recorded_at: "2026-10-03T22:00:00Z", sleep_hours: 30 }, { aevia_patient_id: pat.id, recorded_at: "2026-10-03T22:00:00Z", skin_barrier: 101 }, { aevia_patient_id: pat.id, recorded_at: "2026-10-03T22:00:00Z", raw: { x: "a".repeat(5000) } }]) {
      expect((await track(keyW, bad)).statusCode, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    expect((await track(keyW, { email: "tidak-ada@contoh.test", ...reading })).statusCode).toBe(404);
  });

  it("detail pasien di konsol memuat snapshot terbaru (berdasarkan recorded_at), hanya bila consent aktif", async () => {
    const d = (await call("GET", `/v1/staff/patients/${pat.id}`, proA)).json();
    expect(d.external_context.consent_active).toBe(true);
    expect(d.external_context.beautycode).toEqual({ recorded_at: "2026-10-04T08:00:00.000Z", skin_barrier: 70, sleep_hours: 7, diet_triggers: ["gula"] });
    await grant(pat, false);
    const hidden = (await call("GET", `/v1/staff/patients/${pat.id}`, proA)).json();
    expect(hidden.external_context).toEqual({ consent_active: false, beautycode: null });
    expect((await track(keyW, { aevia_patient_id: pat.id, ...reading })).statusCode).toBe(403);
    await grant(pat, true);
  });

  it("draf persiapan Sovia memuat konteks Beauty Code (tanpa kata terlarang); hilang saat consent dicabut", async () => {
    const draft = (await call("POST", "/v1/consultation-requests/draft", pat.token, {})).json();
    expect(draft.prep.konteks_assessment).toContain("Catatan Beauty Code terakhir Anda");
    expect(draft.prep.konteks_assessment).toContain("skor skin barrier 70");
    expect(draft.prep.konteks_assessment).toContain("tidur sekitar 7 jam");
    expect(draft.prep.konteks_assessment).toContain("gula");
    expect(draft.prep.konteks_assessment).not.toMatch(/diagnosis pasti|wajib|garansi|sembuh total|bahaya/i);
    await grant(pat, false);
    const off = (await call("POST", "/v1/consultation-requests/draft", pat.token, {})).json();
    expect(off.prep.konteks_assessment).not.toContain("Beauty Code");
    await grant(pat, true);
  });

  it("konektor BeautyCode dinonaktifkan admin → 409 connector_disabled; diaktifkan lagi → jalan", async () => {
    expect((await call("PUT", "/v1/staff/connectors/beautycode", adminA, { enabled: false })).json()).toMatchObject({ kind: "beautycode", enabled: false });
    const r = await track(keyW, { aevia_patient_id: pat.id, ...reading });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("connector_disabled");
    await call("PUT", "/v1/staff/connectors/beautycode", adminA, { enabled: true });
    expect((await track(keyW, { aevia_patient_id: pat.id, ...reading })).statusCode).toBe(201);
  });
});

describe("OpenAPI memuat route konektor", () => {
  it("path inbound dan konsol tercantum dengan keamanan apiKey/oauth2", async () => {
    const spec = (await app.inject("/v1/openapi.json")).json();
    expect(spec.paths["/v1/integrations/kliniksistem/visits"].post.security).toEqual([{ apiKey: [] }, { oauth2: [] }]);
    expect(spec.paths["/v1/integrations/beautycode/tracker"].post).toBeTruthy();
    expect(spec.paths["/v1/staff/connectors/kliniksistem/test"].post).toBeTruthy();
  });
});
