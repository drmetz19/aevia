import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
const sent: { email: string; code: string }[] = [];
let clock = new Date("2026-10-04T10:00:00Z");
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (x: { message?: string; cause?: { message?: string } }) => x);
  expect(e, "harus ditolak").not.toBeNull();
  expect(`${e!.message} ${e!.cause?.message ?? ""}`).toMatch(re);
}
const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({ db, jwtSecret: "test-secret-test-secret-test-secret-123", now: () => clock, otpSender: { send: async ({ email, code }) => void sent.push({ email, code }) } });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

async function patient(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  return (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json().token as string;
}
const cache = new Map<string, string>();
async function staff(email: string) {
  if (cache.has(email)) return cache.get(email)!;
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  const t = (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
  cache.set(email, t);
  return t;
}
const call = (method: "GET" | "POST" | "PUT", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function setup(email: string, slug = "drmetz") {
  const pt = await patient(slug, email);
  const programs = (await app.inject(`/v1/clinics/${slug}/programs`)).json().programs;
  const r = (await call("POST", "/v1/consultation-requests", pt, { program_id: programs[0].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
  const st = await staff(slug === "drmetz" ? "dr.metz@drmetz.test" : "admin@demo-partner.test");
  const acc = (await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: "2026-10-20T02:00:00.000Z", meeting_url: "https://meet.google.com/a-b-c" })).json();
  return { pt, st, id: acc.consultation.id as string };
}
const content = (extra = {}) => ({
  focus: ["Memperbaiki kualitas tidur"],
  next_steps: ["Rutinitas malam 3 minggu"],
  monitor: [{ metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" }],
  review_at: "2026-11-15",
  ...extra,
});
const summary = { discussed: "Pola tidur dan energi.", priorities: ["Tidur", "Energi"] };
const rx = { items: [{ name: "Tretinoin 0,025%", strength: "0,025%", dose: "pea-size", frequency: "malam", route: "topikal", duration: "8 minggu", notes: "Hindari matahari" }] };

describe("resep", () => {
  it("draf → terbit; terbit tidak bisa diubah; edit membuat versi baru; versi lama superseded", async () => {
    const { st, id } = await setup("rx1@contoh.test");
    const d1 = (await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx)).json();
    expect(d1).toMatchObject({ version: 1, status: "draft" });
    const rx2 = { items: [{ ...rx.items[0], dose: "sebiji kacang" }] };
    expect((await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx2)).json()).toMatchObject({ id: d1.id, version: 1 });
    const issued = await call("POST", `/v1/staff/prescriptions/${d1.id}/issue`, st);
    expect(issued.json()).toMatchObject({ status: "issued", issued_by_name: "dr. Metz" });
    expect((await call("POST", `/v1/staff/prescriptions/${d1.id}/issue`, st)).statusCode).toBe(409);

    const v2 = (await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx)).json();
    expect(v2).toMatchObject({ version: 2, status: "draft" });
    expect(v2.id).not.toBe(d1.id);
    await call("POST", `/v1/staff/prescriptions/${v2.id}/issue`, st);
    const list = (await call("GET", `/v1/staff/consultations/${id}/prescriptions`, st)).json().prescriptions;
    expect(list.map((r: { version: number; status: string }) => `${r.version}:${r.status}`)).toEqual(["2:issued", "1:superseded"]);
    expect(list[1].items[0].dose).toBe("sebiji kacang"); // isi versi lama utuh
  });

  it("DB menolak mengubah isi resep terbit (trigger), walau lewat SQL langsung", async () => {
    const { st, id } = await setup("rx2@contoh.test");
    const d = (await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx)).json();
    await call("POST", `/v1/staff/prescriptions/${d.id}/issue`, st);
    await rejectsWith(db.db.execute(sql`UPDATE prescriptions SET items = '[]'::jsonb WHERE id = ${d.id}`), /tidak dapat diubah/);
  });

  it("validasi: item kosong 400; audit mencatat create/issue", async () => {
    const { st, id } = await setup("rx3@contoh.test");
    expect((await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, { items: [] })).statusCode).toBe(400);
    const d = (await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx)).json();
    await call("POST", `/v1/staff/prescriptions/${d.id}/issue`, st);
    const acts = (await call("GET", `/v1/staff/consultations/${id}/audit`, st)).json().entries.map((e: { action: string }) => e.action);
    expect(acts).toEqual(expect.arrayContaining(["rx.create", "rx.issue"]));
  });
});

describe("rencana personal", () => {
  it("hanya professional: admin klinik, pasien, aevia_admin, anonim ditolak", async () => {
    const { pt, st, id } = await setup("pl0@contoh.test");
    const plan = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content(), summary })).json();
    const admin = await staff("admin@drmetz.test");
    const platform = await staff("admin@aevia.test");
    const reqs: [string, string, object?][] = [
      ["GET", `/v1/staff/consultations/${id}/prescriptions`],
      ["PUT", `/v1/staff/consultations/${id}/prescriptions`, rx],
      ["GET", `/v1/staff/consultations/${id}/care-plans`],
      ["PUT", `/v1/staff/consultations/${id}/care-plans`, { content: content(), summary }],
      ["POST", `/v1/staff/care-plans/${plan.id}/sign`, { confirm: true }],
      ["POST", `/v1/staff/prescriptions/${plan.id}/issue`],
    ];
    for (const [m, url, body] of reqs) {
      for (const [who, tok] of [["pasien", pt], ["admin klinik", admin], ["aevia_admin", platform]] as const) {
        expect((await call(m as "GET", url, tok, body)).statusCode, `${m} ${url} ${who}`).toBe(403);
      }
      expect((await call(m as "GET", url, null, body)).statusCode, `${m} ${url} anon`).toBe(401);
    }
    expect((await call("GET", `/v1/staff/consultations/${id}/care-plans`, await staff("admin@demo-partner.test"))).statusCode).toBe(403);
  });

  it("empty state sebelum signed; draf tidak terlihat pasien; tanda tangan butuh konfirmasi dan kelengkapan", async () => {
    const { pt, st, id } = await setup("pl1@contoh.test");
    const none = await call("GET", "/v1/care-plans/current", pt);
    expect(none.statusCode).toBe(404);
    expect(none.json().message).toBe("Rencana akan tersedia setelah konsultasi selesai ditinjau profesional.");

    const draft = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content(), summary })).json();
    expect(draft).toMatchObject({ version: 1, status: "draft" });
    expect((await call("GET", "/v1/care-plans/current", pt)).statusCode).toBe(404); // draf tak terlihat
    expect((await call("GET", `/v1/consultations/${id}/summary`, pt)).json().plan).toBeNull();

    expect((await call("POST", `/v1/staff/care-plans/${draft.id}/sign`, st, { confirm: false })).statusCode).toBe(400);
    expect((await call("POST", `/v1/staff/care-plans/${draft.id}/sign`, st, {})).statusCode).toBe(400);
    const empty = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content({ focus: [] }), summary })).json();
    const bad = await call("POST", `/v1/staff/care-plans/${empty.id}/sign`, st, { confirm: true });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/belum lengkap/);
  });

  it("tanda tangan: signed + hash + event plan.approved; pasien melihat versi signed terbaru dengan penjelasan Sovia dan resep terbit", async () => {
    const { pt, st, id } = await setup("pl2@contoh.test");
    const draft = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content(), summary })).json();
    const r = (await call("PUT", `/v1/staff/consultations/${id}/prescriptions`, st, rx)).json();
    const unissued = (await call("GET", `/v1/consultations/${id}/summary`, pt)).json();
    expect(unissued.plan).toBeNull();

    const signed = await call("POST", `/v1/staff/care-plans/${draft.id}/sign`, st, { confirm: true });
    expect(signed.statusCode).toBe(200);
    expect(signed.json()).toMatchObject({ status: "signed", signed_by_name: "dr. Metz" });
    const hash = ((await db.db.execute(sql`SELECT signature_hash FROM care_plans WHERE id = ${draft.id}`)) as unknown as { rows: { signature_hash: string }[] }).rows[0]!.signature_hash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const ev = (await db.db.execute(sql`SELECT payload FROM events WHERE type = 'plan.approved'`)) as unknown as { rows: { payload: { plan_id: string } }[] };
    expect(ev.rows.some((e) => e.payload.plan_id === draft.id)).toBe(true);

    // resep draf belum tampil; terbit → tampil read-only
    expect((await call("GET", "/v1/care-plans/current", pt)).json().prescription).toBeNull();
    await call("POST", `/v1/staff/prescriptions/${r.id}/issue`, st);
    const cur = (await call("GET", "/v1/care-plans/current", pt)).json();
    expect(cur).toMatchObject({ version: 1, clinic_name: "DrMetz", signed_by_name: "dr. Metz" });
    expect(cur.content.focus).toEqual(["Memperbaiki kualitas tidur"]);
    expect(cur.explanation).toMatch(/Sovia/);
    expect(cur.explanation).toMatch(/Memperbaiki kualitas tidur/);
    expect(cur.prescription).toMatchObject({ issued_by_name: "dr. Metz", items: [{ name: "Tretinoin 0,025%" }] });
    expect((await call("GET", `/v1/consultations/${id}/summary`, pt)).json().plan.summary.discussed).toBe("Pola tidur dan energi.");
    const acts = (await call("GET", `/v1/staff/consultations/${id}/audit`, st)).json().entries.map((e: { action: string }) => e.action);
    expect(acts).toEqual(expect.arrayContaining(["plan.create", "plan.sign"]));
  });

  it("signed tidak bisa diedit/ditandatangani ulang; edit → versi baru draft; pasien tetap melihat signed lama sampai versi baru ditandatangani; versi lama superseded", async () => {
    const { pt, st, id } = await setup("pl3@contoh.test");
    const v1 = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content(), summary })).json();
    await call("POST", `/v1/staff/care-plans/${v1.id}/sign`, st, { confirm: true });
    expect((await call("POST", `/v1/staff/care-plans/${v1.id}/sign`, st, { confirm: true })).statusCode).toBe(409);
    await rejectsWith(db.db.execute(sql`UPDATE care_plans SET content = '{}'::jsonb WHERE id = ${v1.id}`), /tidak dapat diubah/);

    const v2 = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content({ focus: ["Fokus baru"] }), summary })).json();
    expect(v2).toMatchObject({ version: 2, status: "draft" });
    expect(v2.id).not.toBe(v1.id);
    expect((await call("GET", "/v1/care-plans/current", pt)).json().content.focus).toEqual(["Memperbaiki kualitas tidur"]);

    clock = new Date(clock.getTime() + 60_000);
    expect((await call("POST", `/v1/staff/care-plans/${v2.id}/sign`, st, { confirm: true })).statusCode).toBe(200);
    expect((await call("GET", "/v1/care-plans/current", pt)).json()).toMatchObject({ version: 2, content: { focus: ["Fokus baru"] } });
    const list = (await call("GET", `/v1/staff/consultations/${id}/care-plans`, st)).json().plans;
    expect(list.map((p: { version: number; status: string }) => `${p.version}:${p.status}`)).toEqual(["2:signed", "1:superseded"]);
    expect(list[1].content.focus).toEqual(["Memperbaiki kualitas tidur"]);
  });

  it("isolasi: pasien lain/klinik lain tidak melihat; staf klinik lain 404", async () => {
    const { pt, st, id } = await setup("pl4@contoh.test");
    const p = (await call("PUT", `/v1/staff/consultations/${id}/care-plans`, st, { content: content(), summary })).json();
    await call("POST", `/v1/staff/care-plans/${p.id}/sign`, st, { confirm: true });
    expect((await call("GET", "/v1/care-plans/current", pt)).statusCode).toBe(200);
    const other = await patient("drmetz", "pl4-other@contoh.test");
    expect((await call("GET", "/v1/care-plans/current", other)).statusCode).toBe(404);
    expect((await call("GET", `/v1/consultations/${id}/summary`, other)).statusCode).toBe(404);
    const wl = await patient("demo-partner", "pl4@contoh.test");
    expect((await call("GET", "/v1/care-plans/current", wl)).statusCode).toBe(404);
    expect((await call("POST", `/v1/staff/care-plans/${p.id}/sign`, await staff("admin@demo-partner.test"), { confirm: true })).statusCode).toBe(403);
  });
});
