import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";
import { dispatchOnce, MAX_ATTEMPTS, RETRY_DELAYS_MS } from "./dispatcher";
import { decryptSecret, encryptSecret, reencryptWebhookSecrets, resolveEncryptionKey } from "./crypto";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let limited: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const CRON = "cron-secret-for-tests";
const ENC = new Uint8Array(32).fill(7);
type Call = { url: string; headers: Record<string, string>; body: string };
const hits: Call[] = [];
let respond: (c: Call) => number = () => 200;
const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
  const c = { url, headers: init.headers, body: init.body };
  hits.push(c);
  const status = respond(c);
  if (status === 0) throw new Error("ECONNREFUSED");
  return new Response(status === 204 ? null : "ok", { status });
}) as unknown as typeof fetch;

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-int-")), secret: new TextEncoder().encode(SECRET) });
  const base = { db, jwtSecret: SECRET, now: () => clock, storage, anthropicApiKey: "", fetchFn: fakeFetch, encryptionKey: ENC, cronSecret: CRON, otpSender: { send: async ({ email, code }: { email: string; code: string }) => void sent.push({ email, code }) } };
  app = await buildApp(base);
  limited = await buildApp({ ...base, rateLimit: { capacity: 3, perSecond: 0.5 } });
});
afterAll(async () => {
  await app.close();
  await limited.close();
  await db.close();
});

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
async function staffToken(email: string) {
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
}
async function patient(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  const r = (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json();
  const me = (await app.inject({ method: "GET", url: `/v1/clinics/${slug}/me`, headers: { authorization: `Bearer ${r.token}` } })).json();
  return { token: r.token as string, id: me.id as string };
}
const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, payload?: object, a = app) =>
  a.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;

let adminA: string; // drmetz
let adminB: string; // demo-partner
let keyAll: string;
let patA: { token: string; id: string };
let patB: { token: string; id: string };

beforeAll(async () => {
  adminA = await staffToken("admin@drmetz.test");
  adminB = await staffToken("admin@demo-partner.test");
  patA = await patient("drmetz", "int-a@contoh.test");
  patB = await patient("demo-partner", "int-b@contoh.test");
  keyAll = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "ERP", scopes: ["read:patients", "read:progress", "read:plans", "write:reminders", "write:consultation_requests", "webhooks:manage"] })).json().secret;
});

describe("kunci API", () => {
  it("rahasia tampil sekali, hanya hash tersimpan, prefix aev_live_/aev_test_, daftar tanpa rahasia", async () => {
    const res = await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "Uji", mode: "test", scopes: ["read:patients"] });
    expect(res.statusCode).toBe(201);
    const k = res.json();
    expect(k.secret).toMatch(/^aev_test_[A-Za-z0-9_-]{32}$/);
    expect(k.prefix).toBe(k.secret.slice(0, 17));
    const stored = await rows<{ key_hash: string; prefix: string }>(sql`SELECT key_hash, prefix FROM api_keys WHERE id = ${k.id}`);
    expect(stored[0]!.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(k.secret);
    const list = (await call("GET", "/v1/staff/integrations", adminA)).json();
    expect(JSON.stringify(list)).not.toContain(k.secret);
    expect(list.api_keys.find((x: { id: string }) => x.id === k.id).scopes).toEqual(["read:patients"]);
    expect((await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "X", scopes: ["bukan:cakupan"] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "X", scopes: [] })).statusCode).toBe(400);
  });

  it("hanya admin klinik yang mengelola; profesional dan pasien ditolak; klinik lain tak melihat/mencabut", async () => {
    const pro = await staffToken("dr.metz@drmetz.test");
    for (const t of [pro, patA.token]) {
      expect((await call("GET", "/v1/staff/integrations", t)).statusCode).toBe(403);
      expect((await call("POST", "/v1/staff/integrations/api-keys", t, { name: "x1", scopes: ["read:patients"] })).statusCode).toBe(403);
    }
    expect((await call("GET", "/v1/staff/integrations", null)).statusCode).toBe(401);
    const listB = (await call("GET", "/v1/staff/integrations", adminB)).json();
    expect(listB.api_keys).toEqual([]);
    const idA = (await call("GET", "/v1/staff/integrations", adminA)).json().api_keys[0].id;
    expect((await call("DELETE", `/v1/staff/integrations/api-keys/${idA}`, adminB)).statusCode).toBe(404);
  });

  it("dicabut → 401 seketika; pencabutan dan pembuatan diaudit", async () => {
    const k = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "Sementara", scopes: ["read:patients"] })).json();
    expect((await call("GET", "/v1/integrations/me", k.secret)).statusCode).toBe(200);
    expect((await call("DELETE", `/v1/staff/integrations/api-keys/${k.id}`, adminA)).json().revoked_at).not.toBeNull();
    expect((await call("GET", "/v1/integrations/me", k.secret)).statusCode).toBe(401);
    expect((await call("DELETE", `/v1/staff/integrations/api-keys/${k.id}`, adminA)).statusCode).toBe(404);
    const a = await rows<{ action: string }>(sql`SELECT action FROM audit_logs WHERE entity_id = ${k.id} ORDER BY at, id`);
    expect(a.map((x) => x.action).sort()).toEqual(["api_key.create", "api_key.revoke"]);
  });

  it("kredensial tidak valid / token staf / token pasien → 401", async () => {
    expect((await call("GET", "/v1/integrations/me", null)).statusCode).toBe(401);
    expect((await call("GET", "/v1/integrations/me", "aev_live_salah")).statusCode).toBe(401);
    expect((await call("GET", "/v1/integrations/me", adminA)).statusCode).toBe(401);
    expect((await call("GET", "/v1/integrations/me", patA.token)).statusCode).toBe(401);
  });
});

describe("cakupan & isolasi tenant", () => {
  it("ringkasan pasien: key read:patients boleh, tanpa cakupan 403, tanpa PII", async () => {
    const only = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "Hanya progres", scopes: ["read:progress"] })).json().secret;
    const denied = await call("GET", `/v1/integrations/patients/${patA.id}/summary`, only);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("insufficient_scope");
    const ok = await call("GET", `/v1/integrations/patients/${patA.id}/summary`, keyAll);
    expect(ok.statusCode).toBe(200);
    const b = ok.json();
    expect(b.patient.id).toBe(patA.id);
    expect(JSON.stringify(b)).not.toContain("int-a@contoh.test");
    expect(b.clinical_visible).toBe(false);
    expect(b.clinical).toBeNull();
    expect(b.consultation_requests).toEqual({ submitted: 0, accepted: 0, declined: 0 });
  });

  it("key klinik A tidak bisa membaca atau menulis untuk pasien klinik B (404)", async () => {
    for (const path of ["summary", "checkins", "progress", "care-plan"]) {
      expect((await call("GET", `/v1/integrations/patients/${patB.id}/${path}`, keyAll)).statusCode, path).toBe(404);
    }
    expect((await call("POST", "/v1/integrations/reminders", keyAll, { patient_id: patB.id, kind: "checkin" })).statusCode).toBe(404);
    const idMe = (await call("GET", "/v1/integrations/me", keyAll)).json();
    expect(idMe.scopes).toContain("read:plans");
  });

  it("data klinis butuh persetujuan rekam medis; setelah diberikan terbaca; dicabut → tertutup lagi", async () => {
    for (const path of ["checkins", "progress", "care-plan"]) {
      const r = await call("GET", `/v1/integrations/patients/${patA.id}/${path}`, keyAll);
      expect(r.statusCode, path).toBe(403);
      expect(r.json().error).toBe("consent_required");
    }
    const grant = (granted: boolean) => call("PUT", "/v1/me/consents", patA.token, { scope: "medical_record", granted });
    expect((await grant(true)).statusCode).toBe(200);
    const sum = (await call("GET", `/v1/integrations/patients/${patA.id}/summary`, keyAll)).json();
    expect(sum.clinical_visible).toBe(true);
    expect(sum.clinical).toMatchObject({ checkin_count: 0, signed_plan_version: null });
    expect((await call("GET", `/v1/integrations/patients/${patA.id}/checkins`, keyAll)).json()).toEqual({ checkins: [] });
    expect((await call("GET", `/v1/integrations/patients/${patA.id}/progress`, keyAll)).statusCode).toBe(200);
    expect((await call("GET", `/v1/integrations/patients/${patA.id}/care-plan`, keyAll)).json()).toEqual({ plan: null });
    await grant(false);
    expect((await call("GET", `/v1/integrations/patients/${patA.id}/progress`, keyAll)).statusCode).toBe(403);
    await grant(true);
  });

  it("tidak ada route integrasi untuk SOAP, resep, atau rencana (tulis)", async () => {
    for (const [m, u] of [
      ["POST", `/v1/integrations/patients/${patA.id}/soap`],
      ["PUT", `/v1/integrations/consultations/${patA.id}/soap`],
      ["POST", "/v1/integrations/prescriptions"],
      ["POST", "/v1/integrations/care-plans"],
      ["PUT", `/v1/integrations/patients/${patA.id}/care-plan`],
      ["POST", `/v1/integrations/patients/${patA.id}/care-plan`],
    ] as const) {
      expect([404, 405], `${m} ${u}`).toContain((await call(m, u, keyAll, {})).statusCode);
    }
    // kunci API juga tak berlaku di route staf/pasien
    expect((await call("PUT", `/v1/staff/consultations/${patA.id}/soap`, keyAll, { subjective: "a", objective: "b", assessment: "c", plan: "d" })).statusCode).toBe(401);
  });
});

describe("tulis terbatas", () => {
  it("pengingat: dibuat, tampil ke pasien, teks baku, diaudit sebagai api", async () => {
    const wo = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "Hanya baca", scopes: ["read:patients"] })).json().secret;
    expect((await call("POST", "/v1/integrations/reminders", wo, { patient_id: patA.id, kind: "checkin" })).statusCode).toBe(403);
    const r = await call("POST", "/v1/integrations/reminders", keyAll, { patient_id: patA.id, kind: "checkin" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ patient_id: patA.id, kind: "checkin" });
    expect((await call("POST", "/v1/integrations/reminders", keyAll, { patient_id: patA.id, kind: "plan" })).statusCode).toBe(400);
    const mine = (await call("GET", "/v1/reminders", patA.token)).json();
    expect(mine.reminders.some((x: { id: string }) => x.id === r.json().id)).toBe(true);
    const a = await rows<{ actor_type: string; actor_id: string; after: { via: string } }>(sql`SELECT actor_type, actor_id, after FROM audit_logs WHERE entity_id = ${r.json().id}`);
    expect(a).toHaveLength(1);
    expect(a[0]!.actor_type).toBe("api");
    expect(a[0]!.after.via).toMatch(/^api:aev_live_/);
  });

  it("permintaan konsultasi: dibuat atas nama pasien, event consultation.requested, duplikat 409, diaudit", async () => {
    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const r = await call("POST", "/v1/integrations/consultation-requests", keyAll, { patient_id: patA.id, program_id: progs[0].id, prep: { tujuan: "Tidur lebih baik" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ patient_id: patA.id, status: "submitted" });
    expect((await call("POST", "/v1/integrations/consultation-requests", keyAll, { patient_id: patA.id, program_id: progs[0].id })).statusCode).toBe(409);
    const mine = (await call("GET", "/v1/consultation-requests/mine", patA.token)).json();
    expect(JSON.stringify(mine)).toContain("Tidur lebih baik");
    const ev = await rows<{ type: string }>(sql`SELECT type FROM events WHERE payload->>'request_id' = ${r.json().id}`);
    expect(ev.map((e) => e.type)).toEqual(["consultation.requested"]);
    const a = await rows<{ action: string; actor_type: string }>(sql`SELECT action, actor_type FROM audit_logs WHERE entity_id = ${r.json().id}`);
    expect(a).toEqual([{ action: "integration.consultation_request.create", actor_type: "api" }]);
  });

  it("setiap panggilan baca tercatat (actor api:<prefix>); panggilan ditolak karena cakupan juga tercatat", async () => {
    const before = await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM audit_logs WHERE actor_type = 'api' AND action LIKE 'integration.read.%'`);
    await call("GET", `/v1/integrations/patients/${patA.id}/summary`, keyAll);
    const after = await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM audit_logs WHERE actor_type = 'api' AND action LIKE 'integration.read.%'`);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) + 1);
    const denied = await rows<{ after: { missing_scopes: string[] } }>(sql`SELECT after FROM audit_logs WHERE action = 'integration.denied' LIMIT 1`);
    expect(denied[0]!.after.missing_scopes).toEqual(["read:patients"]);
  });
});

describe("OAuth client-credentials", () => {
  let client: { client_id: string; client_secret: string; id: string };
  it("klien dibuat (rahasia sekali, hash tersimpan); token via form dan JSON; aud + scope; berlaku 15 menit", async () => {
    const c = await call("POST", "/v1/staff/integrations/oauth-clients", adminA, { name: "BI", scopes: ["read:patients", "read:progress"] });
    expect(c.statusCode).toBe(201);
    client = c.json();
    expect(client.client_id).toMatch(/^aev_cid_/);
    const st = await rows<{ secret_hash: string }>(sql`SELECT secret_hash FROM oauth_clients WHERE id = ${client.id}`);
    expect(st[0]!.secret_hash).not.toContain(client.client_secret);
    expect(JSON.stringify((await call("GET", "/v1/staff/integrations", adminA)).json())).not.toContain(client.client_secret);

    const form = await app.inject({ method: "POST", url: "/v1/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `grant_type=client_credentials&client_id=${client.client_id}&client_secret=${client.client_secret}&scope=read:patients` });
    expect(form.statusCode).toBe(200);
    const t = form.json();
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "read:patients" });
    const claims = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString());
    expect(claims.aud).toBe("aevia-api");
    expect(claims.scope).toBe("read:patients");
    expect(claims.exp - claims.iat).toBe(900);

    const json = await call("POST", "/v1/oauth/token", null, { grant_type: "client_credentials", client_id: client.client_id, client_secret: client.client_secret });
    expect(json.json().scope).toBe("read:patients read:progress");
    const basic = await app.inject({ method: "POST", url: "/v1/oauth/token", headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}` }, payload: { grant_type: "client_credentials" } });
    expect(basic.statusCode).toBe(200);

    expect((await call("GET", `/v1/integrations/patients/${patA.id}/summary`, t.access_token)).statusCode).toBe(200);
    expect((await call("GET", `/v1/integrations/patients/${patA.id}/progress`, t.access_token)).statusCode).toBe(403); // scope dipersempit
    expect((await call("GET", `/v1/integrations/patients/${patB.id}/summary`, t.access_token)).statusCode).toBe(404);
    // token OAuth tidak berlaku sebagai token staf/pasien
    expect((await call("GET", "/v1/staff/me", t.access_token)).statusCode).toBe(403);
    expect((await call("GET", "/v1/reminders", t.access_token)).statusCode).toBeGreaterThanOrEqual(401);
  });

  it("rahasia salah, grant_type lain, scope di luar izin ditolak; token kedaluwarsa setelah 15 menit; klien dicabut → token mati", async () => {
    const post = (b: object) => call("POST", "/v1/oauth/token", null, b);
    expect((await post({ grant_type: "client_credentials", client_id: client.client_id, client_secret: "salah" })).statusCode).toBe(401);
    expect((await post({ grant_type: "client_credentials", client_id: "tidak-ada", client_secret: "x" })).statusCode).toBe(401);
    expect((await post({ grant_type: "password", client_id: client.client_id, client_secret: client.client_secret })).json().error).toBe("unsupported_grant_type");
    expect((await post({ grant_type: "client_credentials", client_id: client.client_id, client_secret: client.client_secret, scope: "write:reminders" })).json().error).toBe("invalid_scope");

    const tok = (await post({ grant_type: "client_credentials", client_id: client.client_id, client_secret: client.client_secret })).json().access_token;
    expect((await call("GET", "/v1/integrations/me", tok)).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 15 * 60_000 + 1000);
    expect((await call("GET", "/v1/integrations/me", tok)).statusCode).toBe(401);
    const fresh = (await post({ grant_type: "client_credentials", client_id: client.client_id, client_secret: client.client_secret })).json().access_token;
    expect((await call("GET", "/v1/integrations/me", fresh)).statusCode).toBe(200);
    expect((await call("DELETE", `/v1/staff/integrations/oauth-clients/${client.id}`, adminA)).statusCode).toBe(200);
    expect((await call("GET", "/v1/integrations/me", fresh)).statusCode).toBe(401);
    expect((await post({ grant_type: "client_credentials", client_id: client.client_id, client_secret: client.client_secret })).statusCode).toBe(401);
    // sesi staf/pasien kedaluwarsa karena jam maju: login ulang
    adminA = await staffToken("admin@drmetz.test");
    adminB = await staffToken("admin@demo-partner.test");
    patA = await patient("drmetz", "int-a@contoh.test");
  });
});

describe("rate limit", () => {
  it("token bucket per kredensial: melewati kapasitas → 429 + Retry-After; kredensial lain tak terpengaruh; pulih seiring waktu", async () => {
    const k1 = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "RL1", scopes: ["read:patients"] })).json().secret;
    const k2 = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "RL2", scopes: ["read:patients"] })).json().secret;
    for (let i = 0; i < 3; i++) expect((await call("GET", "/v1/integrations/me", k1, undefined, limited)).statusCode).toBe(200);
    const r = await call("GET", "/v1/integrations/me", k1, undefined, limited);
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe("rate_limited");
    expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/v1/integrations/me", k2, undefined, limited)).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 3000);
    expect((await call("GET", "/v1/integrations/me", k1, undefined, limited)).statusCode).toBe(200);
  });
});

describe("webhook: pendaftaran", () => {
  it("hanya https, bukan host internal; rahasia tampil sekali; CRUD; isolasi klinik; diaudit", async () => {
    for (const url of ["http://contoh.id/hook", "https://localhost/hook", "https://127.0.0.1/x", "https://192.168.1.5/x", "https://10.0.0.2/x", "https://user:pw@contoh.id/x", "bukan-url", "https://intranet/x"]) {
      expect((await call("POST", "/v1/staff/integrations/webhooks", adminA, { url, events: ["plan.approved"] })).statusCode, url).toBe(400);
    }
    expect((await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/hook", events: ["tidak.dikenal"] })).statusCode).toBe(400);
    const w = (await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/hook", events: ["plan.approved", "checkin.submitted"] })).json();
    expect(w.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await call("GET", "/v1/staff/integrations", adminA)).json())).not.toContain(w.secret);
    expect((await call("GET", "/v1/staff/integrations", adminB)).json().webhooks).toEqual([]);
    expect((await call("PUT", `/v1/staff/integrations/webhooks/${w.id}`, adminB, { active: false })).statusCode).toBe(404);
    expect((await call("PUT", `/v1/staff/integrations/webhooks/${w.id}`, adminA, { events: ["*"] })).json().events).toEqual(["*"]);
    expect((await call("PUT", `/v1/staff/integrations/webhooks/${w.id}`, adminA, { url: "http://x.id/h" })).statusCode).toBe(400);
    const w2 = (await call("POST", "/v1/integrations/webhooks", keyAll, { url: "https://contoh.id/api-hook", events: ["*"] }));
    expect(w2.statusCode).toBe(201);
    expect((await call("DELETE", `/v1/integrations/webhooks/${w2.json().id}`, keyAll)).statusCode).toBe(200);
    expect((await call("DELETE", `/v1/staff/integrations/webhooks/${w.id}`, adminA)).statusCode).toBe(200);
    const a = await rows<{ action: string }>(sql`SELECT action FROM audit_logs WHERE entity_id = ${w.id}`);
    expect(a.map((x) => x.action).sort()).toEqual(["webhook.create", "webhook.delete", "webhook.update"]);
    const viaApi = await rows<{ actor_type: string }>(sql`SELECT actor_type FROM audit_logs WHERE entity_id = ${w2.json().id} AND action = 'webhook.create'`);
    expect(viaApi[0]!.actor_type).toBe("api");
  });
});

describe("dispatcher webhook", () => {
  let hook: { id: string; secret: string };
  const verify = (c: Call, secret: string) => {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(c.headers["x-aevia-signature"]!)!;
    const expected = createHmac("sha256", secret).update(`${m[1]}.${c.body}`).digest("hex");
    return expected === m[2];
  };
  const deliveries = async () => (await call("GET", `/v1/staff/integrations/webhooks/${hook.id}/deliveries`, adminA)).json().deliveries as { status: string; attempts: number; last_status_code: number | null; event_type: string; next_attempt_at: string | null }[];
  const run = () => dispatchOnce({ db, now: () => clock, fetchFn: fakeFetch, encryptionKey: ENC });

  it("event outbox dikirim bertanda tangan HMAC; header lengkap; payload minimal tanpa PII", async () => {
    await run(); // kuras event lama
    hits.length = 0;
    hook = (await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/hook", events: ["checkin.submitted", "consultation.requested"] })).json();
    respond = () => 200;
    // memicu event: check-in pasien (butuh consent rekam medis, sudah diberikan di tes sebelumnya)
    const form = (await call("GET", "/v1/checkins/form", patA.token)).json();
    const key = form.fields[0].key;
    expect((await call("POST", "/v1/checkins", patA.token, { values: { [key]: 4 } })).statusCode).toBe(201);
    const res = await run();
    expect(res.delivered).toBe(1); // checkin.submitted; progress.updated tidak dilanggan
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect(h.url).toBe("https://contoh.id/hook");
    expect(h.headers["x-aevia-event"]).toBe("checkin.submitted");
    expect(h.headers["x-aevia-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(verify(h, hook.secret)).toBe(true);
    expect(verify(h, "whsec_salah")).toBe(false);
    const body = JSON.parse(h.body);
    expect(body).toMatchObject({ type: "checkin.submitted", data: { patient_id: patA.id } });
    expect(Object.keys(body.data).sort()).toEqual(["care_plan_id", "checkin_id", "patient_id"].filter((k) => k in body.data).sort());
    expect(h.body).not.toContain("int-a@contoh.test");
    expect(h.body).not.toMatch(/"values"|"metrics"/);
    const ds = await deliveries();
    expect(ds.find((d) => d.event_type === "checkin.submitted")).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200 });
    // event yang sama tidak dikirim ulang
    hits.length = 0;
    expect((await run()).attempted).toBe(0);
  });

  it("gagal → retry dengan backoff, tepat 3 percobaan tercatat lalu failed; tidak ada percobaan sebelum waktunya", async () => {
    hits.length = 0;
    respond = () => 500;
    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const pat2 = await patient("drmetz", "int-a2@contoh.test");
    const rq = await call("POST", "/v1/consultation-requests", pat2.token, { program_id: progs[1].id, prep: { tujuan: "x", keluhan: "", pertanyaan: [], konteks_assessment: "" } });
    expect(rq.statusCode).toBe(201);
    let r = await run();
    expect(r).toMatchObject({ attempted: 1, retrying: 1 });
    let d = (await deliveries()).find((x) => x.event_type === "consultation.requested")!;
    expect(d).toMatchObject({ status: "pending", attempts: 1, last_status_code: 500 });
    expect(new Date(d.next_attempt_at!).getTime() - clock.getTime()).toBe(RETRY_DELAYS_MS[0]);
    expect((await run()).attempted).toBe(0); // belum waktunya
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[0]);
    r = await run();
    expect(r).toMatchObject({ attempted: 1, retrying: 1 });
    d = (await deliveries()).find((x) => x.event_type === "consultation.requested")!;
    expect(d.attempts).toBe(2);
    expect(new Date(d.next_attempt_at!).getTime() - clock.getTime()).toBe(RETRY_DELAYS_MS[1]);
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[1]);
    r = await run();
    expect(r).toMatchObject({ attempted: 1, failed: 1 });
    d = (await deliveries()).find((x) => x.event_type === "consultation.requested")!;
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, last_status_code: 500, next_attempt_at: null });
    expect(hits).toHaveLength(3);
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await run()).attempted).toBe(0);
    // header X-Aevia-Delivery konsisten antar percobaan
    expect(new Set(hits.map((h) => h.headers["x-aevia-delivery"])).size).toBe(1);
    // sesi kedaluwarsa karena jam maju
    adminA = await staffToken("admin@drmetz.test");
  });

  it("gagal jaringan lalu pulih pada percobaan ke-2 → delivered, attempts=2", async () => {
    hits.length = 0;
    respond = () => 0;
    const pat3 = await patient("drmetz", "int-a3@contoh.test");
    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    patA = await patient("drmetz", "int-a@contoh.test");
    await call("POST", "/v1/consultation-requests", pat3.token, { program_id: progs[2].id, prep: { tujuan: "y", keluhan: "", pertanyaan: [], konteks_assessment: "" } });
    expect(await run()).toMatchObject({ retrying: 1 });
    const d1 = (await deliveries()).find((x) => x.status === "pending")!;
    expect(d1).toBeTruthy();
    respond = () => 204;
    clock = new Date(clock.getTime() + RETRY_DELAYS_MS[0]);
    expect(await run()).toMatchObject({ delivered: 1 });
    expect((await deliveries()).filter((x) => x.status === "delivered").some((x) => x.attempts === 2)).toBe(true);
  });

  it("endpoint nonaktif tidak menerima; '*' menerima semua jenis; kirim tes mengembalikan hasil", async () => {
    await call("PUT", `/v1/staff/integrations/webhooks/${hook.id}`, adminA, { active: false });
    hits.length = 0;
    respond = () => 200;
    await call("POST", "/v1/checkins", patA.token, { values: { [(await call("GET", "/v1/checkins/form", patA.token)).json().fields[0].key]: 3 } });
    await run();
    expect(hits).toHaveLength(0);
    await call("PUT", `/v1/staff/integrations/webhooks/${hook.id}`, adminA, { active: true, events: ["*"] });
    const t = await call("POST", `/v1/staff/integrations/webhooks/${hook.id}/test`, adminA);
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ event_type: "webhook.test", status: "delivered", attempts: 1, last_status_code: 200 });
    expect(hits.at(-1)!.headers["x-aevia-event"]).toBe("webhook.test");
    expect(verify(hits.at(-1)!, hook.secret)).toBe(true);
    respond = () => 500;
    const bad = (await call("POST", `/v1/staff/integrations/webhooks/${hook.id}/test`, adminA)).json();
    expect(bad).toMatchObject({ status: "failed", attempts: 1, last_status_code: 500 });
    expect((await call("POST", `/v1/staff/integrations/webhooks/${hook.id}/test`, adminB)).statusCode).toBe(404);
    respond = () => 200;
  });
});

describe("rahasia webhook terenkripsi at-rest", () => {
  it("tersimpan AES-256-GCM (bukan polos), IV acak, bisa didekripsi hanya dengan kunci yang benar", async () => {
    const w = (await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/enc", events: ["*"] })).json();
    const [r] = await rows<{ secret: string }>(sql`SELECT secret FROM webhook_endpoints WHERE id = ${w.id}`);
    expect(r!.secret).toMatch(/^enc:v1:/);
    expect(r!.secret).not.toContain(w.secret);
    expect(decryptSecret(r!.secret, ENC)).toBe(w.secret);
    expect(() => decryptSecret(r!.secret, new Uint8Array(32).fill(9))).toThrow();
    expect(encryptSecret("x", ENC)).not.toBe(encryptSecret("x", ENC));
    // dikirim dengan rahasia yang benar
    hits.length = 0;
    respond = () => 200;
    const t = (await call("POST", `/v1/staff/integrations/webhooks/${w.id}/test`, adminA)).json();
    expect(t.status).toBe("delivered");
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(hits.at(-1)!.headers["x-aevia-signature"]!)!;
    expect(createHmac("sha256", w.secret).update(`${m[1]}.${hits.at(-1)!.body}`).digest("hex")).toBe(m[2]);
  });
  it("migrasi: rahasia lama yang polos dienkripsi ulang (idempoten) dan tetap dipakai menandatangani", async () => {
    const w = (await call("POST", "/v1/staff/integrations/webhooks", adminA, { url: "https://contoh.id/legacy", events: ["*"] })).json();
    await db.db.execute(sql`UPDATE webhook_endpoints SET secret = 'whsec_lama_polos' WHERE id = ${w.id}`);
    // dispatcher menoleransi nilai lama sebelum migrasi
    hits.length = 0;
    const t1 = (await call("POST", `/v1/staff/integrations/webhooks/${w.id}/test`, adminA)).json();
    expect(t1.status).toBe("delivered");
    const sig = (h: Call, s: string) => createHmac("sha256", s).update(`${/t=(\d+)/.exec(h.headers["x-aevia-signature"]!)![1]}.${h.body}`).digest("hex");
    expect(hits.at(-1)!.headers["x-aevia-signature"]).toContain(sig(hits.at(-1)!, "whsec_lama_polos"));
    expect(await reencryptWebhookSecrets(db, ENC)).toBe(1);
    expect(await reencryptWebhookSecrets(db, ENC)).toBe(0);
    const [r] = await rows<{ secret: string }>(sql`SELECT secret FROM webhook_endpoints WHERE id = ${w.id}`);
    expect(r!.secret).toMatch(/^enc:v1:/);
    expect(decryptSecret(r!.secret, ENC)).toBe("whsec_lama_polos");
    hits.length = 0;
    await call("POST", `/v1/staff/integrations/webhooks/${w.id}/test`, adminA);
    expect(hits.at(-1)!.headers["x-aevia-signature"]).toContain(sig(hits.at(-1)!, "whsec_lama_polos"));
  });
  it("ENCRYPTION_KEY: hex 64 atau base64 32 byte diterima; panjang salah ditolak", () => {
    expect(resolveEncryptionKey("ab".repeat(32))).toHaveLength(32);
    expect(resolveEncryptionKey(Buffer.alloc(32, 1).toString("base64"))).toHaveLength(32);
    expect(() => resolveEncryptionKey("pendek")).toThrow(/32 byte/);
  });
});

describe("dispatcher: rute cron", () => {
  it("dilindungi CRON_SECRET (POST dan GET); tanpa/salah → 401", async () => {
    expect((await call("POST", "/v1/internal/dispatch", null)).statusCode).toBe(401);
    expect((await call("POST", "/v1/internal/dispatch", "salah")).statusCode).toBe(401);
    expect((await call("POST", "/v1/internal/dispatch", adminA)).statusCode).toBe(401);
    const ok = await call("POST", "/v1/internal/dispatch", CRON);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("delivered");
    expect((await call("GET", "/v1/internal/dispatch", CRON)).statusCode).toBe(200);
  });
  it("tanpa CRON_SECRET terkonfigurasi → 503", async () => {
    const bare = await buildApp({ db, jwtSecret: SECRET, now: () => clock, cronSecret: "" });
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    // cronSecret "" jatuh ke env (kosong) → belum dikonfigurasi
    expect((await bare.inject({ method: "POST", url: "/v1/internal/dispatch", headers: { authorization: "Bearer apa-saja" } })).statusCode).toBe(503);
    if (prev) process.env.CRON_SECRET = prev;
    await bare.close();
  });
});

describe("OpenAPI 3.1 + docs", () => {
  it("valid secara struktur, memuat semua route /v1 dan skema keamanan; /docs dilayani tanpa CDN", async () => {
    const spec = (await app.inject("/v1/openapi.json")).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.components.securitySchemes)).toEqual(expect.arrayContaining(["apiKey", "oauth2", "staffToken"]));
    const paths = Object.keys(spec.paths);
    for (const p of [
      "/v1/oauth/token",
      "/v1/integrations/patients/{id}/summary",
      "/v1/integrations/patients/{id}/checkins",
      "/v1/integrations/patients/{id}/progress",
      "/v1/integrations/patients/{id}/care-plan",
      "/v1/integrations/reminders",
      "/v1/integrations/consultation-requests",
      "/v1/staff/integrations",
      "/v1/internal/dispatch",
      "/v1/staff/brand",
      "/v1/files/{id}",
      "/v1/clinics/{slug}/assets/{kind}",
      "/v1/admin/assistants/{id}/avatar",
    ]) expect(paths, p).toContain(p);
    for (const [path, item] of Object.entries<Record<string, { responses?: object; security?: unknown }>>(spec.paths)) {
      for (const [m, op] of Object.entries(item)) {
        if (!["get", "post", "put", "delete", "patch"].includes(m)) continue;
        expect(op.responses, `${m} ${path}`).toBeTruthy();
      }
    }
    expect(spec.paths["/v1/integrations/patients/{id}/summary"].get.security).toEqual([{ apiKey: [] }, { oauth2: [] }]);
    const json = JSON.stringify(spec);
    expect(json).not.toContain('"nullable":true'); // gaya 3.0
    for (const m of json.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) expect(spec.components?.schemas?.[m[1]!], m[1]).toBeTruthy();
    const docs = await app.inject("/docs/");
    expect(docs.statusCode).toBe(200);
    expect(docs.body).not.toMatch(/https?:\/\/(cdn|unpkg|cdnjs|fonts\.googleapis)/i);
  });

  it("setiap route /v1 terdaftar muncul di spesifikasi", async () => {
    const spec = (await app.inject("/v1/openapi.json")).json();
    const listed = new Set<string>();
    for (const [p, item] of Object.entries<Record<string, unknown>>(spec.paths)) for (const m of Object.keys(item)) listed.add(`${m.toUpperCase()} ${p}`);
    const tree = app.printRoutes({ commonPrefix: false, includeMeta: false });
    // printRoutes → daftar "/v1/..." per metode; ubah :param → {param}
    const found = [...tree.matchAll(/(\/v1\/[^\s(]*)\s+\(([A-Z, ]+)\)/g)].flatMap((m) => m[2]!.split(",").map((x) => `${x.trim()} ${m[1]!.replace(/:(\w+)/g, "{$1}")}`));
    const missing = found.filter((f) => !f.startsWith("HEAD") && !f.startsWith("OPTIONS") && !listed.has(f) && !f.endsWith("/v1/openapi.json"));
    expect(missing).toEqual([]);
    expect(found.length).toBeGreaterThan(60);
  });
});
