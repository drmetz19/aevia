import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";
import { pullBeautycodeDue } from "./pull";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-09T05:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const ENC = new Uint8Array(32).fill(7);
const BC = "https://beautycode.contoh.test";
const BC_CLINIC = "11111111-2222-4333-8444-555555555555";
const BC_KEY = "bcc_test_key_tracker_read_0123456789";

// ---- Beauty Code tiruan: hanya mengembalikan email yang terhubung; mencatat apa yang diminta AEVIA ----
const requests: { emails: string[]; since: string; auth: string | null; ts: string | null }[] = [];
let bcStatus = 200;
const bcData: Record<string, { date: string; [k: string]: unknown }[]> = {};
const day = (date: string, extra: Record<string, unknown> = {}) => ({
  date, sleepHours: 6.5, sleepQuality: "cukup", skinCondition: "kurang", wrinkleLevel: 1, eyebagLevel: 2, darkCircleLevel: null,
  skinComplaints: ["jerawat"], energy: 7, stress: 4, mood: 2, waterLiters: 1.5, activityMinutes: 30, activityType: "jalan", ...extra,
});
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith(`${BC}/api/v1/clinics/${BC_CLINIC}/tracker/export`)) return new Response("not found", { status: 404 });
  const h = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body));
  requests.push({ emails: body.emails, since: body.since, auth: h.get("authorization"), ts: h.get("x-clinic-timestamp") });
  if (bcStatus !== 200) return new Response(JSON.stringify({ error: { code: "X", message: "x" } }), { status: bcStatus });
  const data = (body.emails as string[]).filter((e) => bcData[e]).map((e) => ({ email: e, userId: "bc-user", days: bcData[e] }));
  return new Response(JSON.stringify({ data, meta: { nextCursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
};

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-pull-")), secret: new TextEncoder().encode(SECRET) });
  app = await buildApp({ db, jwtSecret: SECRET, now: () => clock, storage, anthropicApiKey: "", encryptionKey: ENC, fetchFn: fakeFetch, otpSender: { send: async (m) => void (m.code && sent.push({ email: m.email, code: m.code })) } });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
const call = (method: "GET" | "POST" | "PUT", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const staffToken = async (email: string) => {
  await call("POST", "/v1/staff/auth/otp", null, { email });
  return (await call("POST", "/v1/staff/auth/verify", null, { email, code: code(email) })).json().token as string;
};
async function patient(email: string, consent: boolean) {
  await call("POST", "/v1/clinics/drmetz/auth/otp", null, { email });
  const t = (await call("POST", "/v1/clinics/drmetz/auth/verify", null, { email, code: code(email) })).json().token as string;
  const me = (await call("GET", "/v1/clinics/drmetz/me", t)).json();
  if (consent) await call("PUT", "/v1/me/consents", t, { scope: "external_context", granted: true });
  return { token: t, id: me.id as string, email };
}
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;

let admin: string;
let pro: string;
let siti: { token: string; id: string; email: string };
let budi: { token: string; id: string; email: string };

beforeAll(async () => {
  admin = await staffToken("admin@drmetz.test");
  pro = await staffToken("dr.metz@drmetz.test");
  siti = await patient("siti.bc@contoh.test", true);
  budi = await patient("budi.bc@contoh.test", false); // tidak setuju berbagi data
  bcData["siti.bc@contoh.test"] = [day("2026-10-07", { skinCondition: "baik", energy: 6 }), day("2026-10-08")];
  bcData["budi.bc@contoh.test"] = [day("2026-10-08")];
});

describe("sinkron tarik Beauty Code", () => {
  it("belum diatur → 409 dengan pesan jelas", async () => {
    const r = await call("POST", "/v1/staff/connectors/beautycode/sync", admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("connector_not_configured");
  });

  it("simpan pengaturan: alamat https wajib, kunci tersimpan terenkripsi dan tidak pernah tampil", async () => {
    expect((await call("PUT", "/v1/staff/connectors/beautycode", admin, { enabled: true, pull_base_url: "http://insecure.test", pull_clinic_id: BC_CLINIC, api_key: BC_KEY })).statusCode).toBe(400);
    expect((await call("PUT", "/v1/staff/connectors/beautycode", admin, { enabled: true, pull_base_url: BC, pull_clinic_id: "bukan-uuid", api_key: BC_KEY })).statusCode).toBe(400);
    const r = await call("PUT", "/v1/staff/connectors/beautycode", admin, { enabled: true, pull_base_url: `${BC}/`, pull_clinic_id: BC_CLINIC, api_key: BC_KEY });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ kind: "beautycode", base_url: BC, remote_clinic_id: BC_CLINIC, has_secret: true, secret: null });
    const [stored] = await rows<{ config: Record<string, string> }>(sql`SELECT config FROM clinic_connectors WHERE kind = 'beautycode'`);
    expect(JSON.stringify(stored!.config)).not.toContain(BC_KEY);
    expect(JSON.stringify((await call("GET", "/v1/staff/connectors", admin)).json())).not.toContain(BC_KEY);
  });

  it("profesional tidak boleh memicu sinkron", async () => {
    expect((await call("POST", "/v1/staff/connectors/beautycode/sync", pro)).statusCode).toBe(403);
  });

  it("hanya email pasien yang setuju yang dikirim; data tersimpan per hari dan tampil di kartu snapshot", async () => {
    const r = await call("POST", "/v1/staff/connectors/beautycode/sync", admin);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, patients: 1, days: 2 });
    const last = requests.at(-1)!;
    expect(last.emails).toEqual(["siti.bc@contoh.test"]);
    expect(last.emails).not.toContain(budi.email);
    expect(last.auth).toBe(`Bearer ${BC_KEY}`);
    expect(Number(last.ts)).toBe(Math.floor(clock.getTime() / 1000));
    expect(last.since).toBe("2026-09-25");

    const detail = (await call("GET", `/v1/staff/patients/${siti.id}`, pro)).json();
    expect(detail.external_context.beautycode).toMatchObject({ skin_condition: "kurang", sleep_hours: 6.5, energy: 7, stress: 4, skin_barrier: null });
    const none = (await call("GET", `/v1/staff/patients/${budi.id}`, pro)).json();
    expect(none.external_context.beautycode).toBeNull();
  });

  it("tarik ulang: data sama tidak digandakan; hari yang berubah disimpan sebagai versi baru dan yang terbaru tampil", async () => {
    clock = new Date(clock.getTime() + 5 * 60_000);
    expect((await call("POST", "/v1/staff/connectors/beautycode/sync", admin)).json()).toMatchObject({ ok: true, days: 0 });
    bcData["siti.bc@contoh.test"] = [day("2026-10-07", { skinCondition: "baik", energy: 6 }), day("2026-10-08", { energy: 9 })];
    clock = new Date(clock.getTime() + 5 * 60_000);
    expect((await call("POST", "/v1/staff/connectors/beautycode/sync", admin)).json()).toMatchObject({ ok: true, days: 1 });
    const [cnt] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM external_context WHERE patient_id = ${siti.id}`);
    expect(cnt!.n).toBe(3);
    expect((await call("GET", `/v1/staff/patients/${siti.id}`, pro)).json().external_context.beautycode.energy).toBe(9);
  });

  it("pasien mencabut persetujuan → tidak lagi diminta, dan data langsung tersembunyi di konsol", async () => {
    await call("PUT", "/v1/me/consents", siti.token, { scope: "external_context", granted: false });
    clock = new Date(clock.getTime() + 5 * 60_000);
    const before = requests.length;
    const r = (await call("POST", "/v1/staff/connectors/beautycode/sync", admin)).json();
    expect(r).toMatchObject({ ok: true, patients: 0 });
    expect(requests.length).toBe(before); // tidak ada pasien yang setuju → Beauty Code tidak dihubungi
    expect((await call("GET", `/v1/staff/patients/${siti.id}`, pro)).json().external_context.beautycode).toBeNull();
    await call("PUT", "/v1/me/consents", siti.token, { scope: "external_context", granted: true });
  });

  it("kunci ditolak Beauty Code → ok:false dengan pesan manusiawi, tercatat di status terakhir", async () => {
    bcStatus = 401;
    clock = new Date(clock.getTime() + 5 * 60_000);
    const r = (await call("POST", "/v1/staff/connectors/beautycode/sync", admin)).json();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Kunci API Beauty Code tidak valid/);
    const bc = (await call("GET", "/v1/staff/connectors", admin)).json().connectors.find((c: { kind: string }) => c.kind === "beautycode");
    expect(bc.last_pull).toMatchObject({ ok: false });
    bcStatus = 200;
  });

  it("cron: tarik otomatis hanya bila ≥ 60 menit sejak tarikan terakhir", async () => {
    expect(await pullBeautycodeDue({ db, now: () => clock, encryptionKey: ENC, fetchFn: fakeFetch })).toBe(0);
    clock = new Date(clock.getTime() + 61 * 60_000);
    expect(await pullBeautycodeDue({ db, now: () => clock, encryptionKey: ENC, fetchFn: fakeFetch })).toBe(1);
    const bc = (await call("GET", "/v1/staff/connectors", admin)).json().connectors.find((c: { kind: string }) => c.kind === "beautycode");
    expect(bc.last_pull).toMatchObject({ ok: true, patients: 1 });
  });

  it("konektor dinonaktifkan → sinkron manual ditolak dan cron melewati klinik", async () => {
    await call("PUT", "/v1/staff/connectors/beautycode", admin, { enabled: false });
    expect((await call("POST", "/v1/staff/connectors/beautycode/sync", admin)).json().error).toBe("connector_disabled");
    clock = new Date(clock.getTime() + 61 * 60_000);
    expect(await pullBeautycodeDue({ db, now: () => clock, encryptionKey: ENC, fetchFn: fakeFetch })).toBe(0);
  });
});
