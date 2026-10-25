import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { questions } from "@aevia/core";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
const sent: { email: string; code: string }[] = [];
const now = new Date("2026-10-04T10:00:00Z");
const FUTURE = "2026-10-12T02:00:00.000Z";
const URL_OK = "https://meet.google.com/abc-defg-hij";

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({
    db,
    jwtSecret: "test-secret-test-secret-test-secret-123",
    now: () => now,
    otpSender: { send: async (m) => void (m.code && sent.push({ email: m.email, code: m.code })) },
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const code = (email: string) => [...sent].reverse().find((m) => m.email === email)!.code;
async function patient(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  return (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json().token as string;
}
async function staff(email: string) {
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
}
const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function completedAssessment(t: string, consent: boolean) {
  if (consent) await call("PUT", "/v1/me/consents", t, { scope: "assessment", granted: true });
  const s = (await call("POST", "/v1/assessments", t)).json();
  for (const q of questions) {
    await call("POST", `/v1/assessments/${s.id}/answers`, t, q.type === "choice" ? { question_id: q.id, value: q.area === "tidur" ? 4 : 1 } : { question_id: q.id, text: q.id === "kulit-t" ? "kulit terasa kering" : "" });
  }
  // selesai hanya mungkin dengan consent; tanpa consent beri lalu cabut sesudahnya
  if (!consent) {
    await call("PUT", "/v1/me/consents", t, { scope: "assessment", granted: true });
    await call("POST", `/v1/assessments/${s.id}/complete`, t);
    await call("PUT", "/v1/me/consents", t, { scope: "assessment", granted: false });
  } else await call("POST", `/v1/assessments/${s.id}/complete`, t);
}

describe("katalog program", () => {
  it("hanya milik klinik itu, harga dari DB, urut", async () => {
    const dm = (await app.inject("/v1/clinics/drmetz/public")).statusCode;
    expect(dm).toBe(200);
    const a = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    expect(a.map((p: { name: string }) => p.name)).toEqual([
      "Konsultasi Healthy Aging",
      "Program Pendampingan Kulit 8 Minggu",
      "Program Komposisi Tubuh 12 Minggu",
    ]);
    expect(a[0]).toMatchObject({ price_idr: 450000, price_mode: "amount", access: "open" });
    expect(a[1]).toMatchObject({ price_idr: null, price_mode: "coming_soon", access: "voucher" });
    expect(a[1].duration_weeks).toBe(8);
    const b = (await app.inject("/v1/clinics/demo-partner/programs")).json().programs;
    expect(b.map((p: { name: string }) => p.name)).toEqual(["Konsultasi Awal"]);
    expect((await app.inject("/v1/clinics/tidak-ada/programs")).statusCode).toBe(404);
  });
  it("tidak memuat klaim terlarang", async () => {
    const txt = JSON.stringify((await app.inject("/v1/clinics/drmetz/programs")).json());
    expect(txt).not.toMatch(/permanen|body reset|garansi|instan/i);
  });
});

describe("prep + permintaan konsultasi", () => {
  it("draf terisi dari assessment, bisa diedit, lalu dikirim; event tercatat; duplikat 409", async () => {
    const t = await patient("drmetz", "p1@contoh.test");
    const empty = (await call("POST", "/v1/consultation-requests/draft", t, {})).json();
    expect(empty).toMatchObject({ status: "draft", from_assessment: false });

    await completedAssessment(t, true);
    const d = (await call("POST", "/v1/consultation-requests/draft", t, {})).json();
    expect(d.from_assessment).toBe(true);
    expect(d.prep.keluhan).toMatch(/Tidur/);
    expect(d.prep.keluhan).toMatch(/kulit terasa kering/);
    expect(d.prep.pertanyaan.length).toBe(3);

    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const edited = { ...d.prep, tujuan: "Tidur lebih nyenyak" };
    const res = await call("POST", "/v1/consultation-requests", t, { program_id: programs[0].id, prep: edited });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "submitted", program_name: "Konsultasi Healthy Aging" });
    expect(res.json().prep.tujuan).toBe("Tidur lebih nyenyak");
    expect((await call("POST", "/v1/consultation-requests", t, { program_id: programs[0].id, prep: edited })).statusCode).toBe(409);

    const ev = (await db.db.execute(sql`SELECT type FROM events WHERE type = 'consultation.requested'`)) as unknown as { rows: unknown[] };
    expect(ev.rows.length).toBeGreaterThan(0);
    const mine = (await call("GET", "/v1/consultation-requests/mine", t)).json().requests;
    expect(mine).toHaveLength(1);
  });

  it("program klinik lain ditolak 404; tanpa token 401; staf 403", async () => {
    const t = await patient("drmetz", "p2@contoh.test");
    const other = (await app.inject("/v1/clinics/demo-partner/programs")).json().programs[0];
    const prep = { tujuan: "x", keluhan: "", pertanyaan: [], konteks_assessment: "" };
    expect((await call("POST", "/v1/consultation-requests", t, { program_id: other.id, prep })).statusCode).toBe(404);
    expect((await call("POST", "/v1/consultation-requests", null, { program_id: other.id, prep })).statusCode).toBe(401);
    const st = await staff("dr.metz@drmetz.test");
    expect((await call("POST", "/v1/consultation-requests", st, { program_id: other.id, prep })).statusCode).toBe(403);
  });
});

describe("antrean dokter", () => {
  it("melihat permintaan; tanpa consent assessment → isi tersembunyi + alasan; dengan consent → tampil", async () => {
    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const prep = { tujuan: "Tujuan rahasia", keluhan: "Keluhan rahasia", pertanyaan: ["Q?"], konteks_assessment: "ctx" };

    const tNo = await patient("drmetz", "q-noconsent@contoh.test");
    await completedAssessment(tNo, false); // consent dicabut sesudah selesai
    const rNo = (await call("POST", "/v1/consultation-requests", tNo, { program_id: programs[0].id, prep })).json();

    const tYes = await patient("drmetz", "q-consent@contoh.test");
    await completedAssessment(tYes, true);
    const rYes = (await call("POST", "/v1/consultation-requests", tYes, { program_id: programs[1].id, voucher_code: "COBA-AEVIA", prep })).json();

    const st = await staff("dr.metz@drmetz.test");
    const q = (await call("GET", "/v1/staff/queue", st)).json().items;
    const iNo = q.find((x: { id: string }) => x.id === rNo.id);
    const iYes = q.find((x: { id: string }) => x.id === rYes.id);
    expect(iNo).toMatchObject({ assessment_visible: false, flagged: null, status: "submitted" });
    expect(iYes).toMatchObject({ assessment_visible: true, flagged: false });

    const dNo = (await call("GET", `/v1/staff/patients/${iNo.patient_id}`, st)).json();
    expect(dNo.assessment_visible).toBe(false);
    expect(dNo.assessment).toBeNull();
    expect(dNo.hidden_reason).toMatch(/persetujuan/);
    expect(dNo.requests[0].prep).toBeNull();
    expect(JSON.stringify(dNo)).not.toMatch(/Tujuan rahasia|Keluhan rahasia/);

    const dYes = (await call("GET", `/v1/staff/patients/${iYes.patient_id}`, st)).json();
    expect(dYes.assessment_visible).toBe(true);
    expect(dYes.assessment.result.priorities[0]).toBe("tidur");
    expect(dYes.requests[0].prep.tujuan).toBe("Tujuan rahasia");
  });

  it("terima → consultation terjadwal + link; pasien melihat; event; tidak bisa dua kali", async () => {
    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const t = await patient("drmetz", "acc@contoh.test");
    const prep = { tujuan: "t", keluhan: "k", pertanyaan: [], konteks_assessment: "c" };
    const r = (await call("POST", "/v1/consultation-requests", t, { program_id: programs[2].id, prep })).json();
    const st = await staff("dr.metz@drmetz.test");

    expect((await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: FUTURE, meeting_url: "http://x.test" })).statusCode).toBe(400);
    expect((await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: "2020-01-01T00:00:00Z", meeting_url: URL_OK })).statusCode).toBe(400);
    const ok = await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: FUTURE, meeting_url: URL_OK });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: "accepted", consultation: { meeting_url: URL_OK, status: "scheduled", scheduled_at: FUTURE } });
    expect((await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: FUTURE, meeting_url: URL_OK })).statusCode).toBe(409);

    const mine = (await call("GET", "/v1/consultation-requests/mine", t)).json().requests[0];
    expect(mine.status).toBe("accepted");
    expect(mine.consultation.meeting_url).toBe(URL_OK);
    const ev = (await db.db.execute(sql`SELECT type FROM events WHERE type = 'consultation.accepted'`)) as unknown as { rows: unknown[] };
    expect(ev.rows.length).toBe(1);
  });

  it("isolasi: staf demo-partner tidak melihat/menerima permintaan drmetz; pasien & aevia_admin ditolak", async () => {
    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const t = await patient("drmetz", "iso@contoh.test");
    const r = (await call("POST", "/v1/consultation-requests", t, { program_id: programs[0].id, prep: { tujuan: "", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
    const other = await staff("admin@demo-partner.test");
    expect((await call("GET", "/v1/staff/queue", other)).json().items).toEqual([]);
    expect((await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, other, { scheduled_at: FUTURE, meeting_url: URL_OK })).statusCode).toBe(404);
    const detail = await call("GET", `/v1/staff/patients/${(await call("GET", "/v1/consultation-requests/mine", t)).json().requests[0].id}`, other);
    expect(detail.statusCode).toBe(404);
    expect((await call("GET", "/v1/staff/queue", t)).statusCode).toBe(403);
    expect((await call("GET", "/v1/staff/queue", await staff("admin@aevia.test"))).statusCode).toBe(403);
  });
});

describe("tukar voucher saat kirim permintaan", () => {
  const prep = { tujuan: "Tujuan", keluhan: "", pertanyaan: [], konteks_assessment: "" };
  const rows = async (q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: Record<string, unknown>[] }).rows;
  let admin: string;
  let programs: { id: string; access: string }[];
  const mk = async (body: object) => (await call("POST", "/v1/staff/vouchers", admin, body)).json() as { id: string; code: string };
  const requestCount = async (email: string) => Number((await rows(sql`SELECT count(*)::int AS n FROM consultation_requests r JOIN patients p ON p.id = r.patient_id WHERE p.email = ${email}`))[0]!.n);
  const submit = (t: string, programId: string, code?: string) => call("POST", "/v1/consultation-requests", t, { program_id: programId, prep, ...(code === undefined ? {} : { voucher_code: code }) });
  let open: { id: string };
  let locked: { id: string };
  beforeAll(async () => {
    admin = await staff("admin@drmetz.test");
    programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    open = programs.find((p) => p.access === "open")!;
    locked = programs.find((p) => p.access === "voucher")!;
  });

  it("program voucher tanpa kode → voucher_required (400), permintaan tidak dibuat; program open tanpa kode tetap jalan", async () => {
    const t = await patient("drmetz", "v-req@contoh.test");
    const r = await submit(t, locked.id);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("voucher_required");
    expect(r.json().message).toMatch(/kode voucher/);
    expect(await submit(t, locked.id, "   ")).toMatchObject({ statusCode: 400 });
    expect(await requestCount("v-req@contoh.test")).toBe(0);
    expect((await submit(t, open.id)).statusCode).toBe(201);
  });

  it("kode valid (huruf kecil + spasi) → terkirim, used_count +1, redemption + audit voucher.redeem, kode tampil di antrean dan detail pasien", async () => {
    const v = await mk({ code: "TUKAR-OK", program_id: null, max_uses: 3 });
    const t = await patient("drmetz", "v-ok@contoh.test");
    const r = await submit(t, locked.id, "  tukar-ok ");
    expect(r.statusCode).toBe(201);
    const rid = r.json().id;
    expect((await rows(sql`SELECT used_count FROM vouchers WHERE id = ${v.id}`))[0]!.used_count).toBe(1);
    expect(await rows(sql`SELECT 1 FROM voucher_redemptions WHERE voucher_id = ${v.id} AND request_id = ${rid}`)).toHaveLength(1);
    expect((await rows(sql`SELECT actor_type FROM audit_logs WHERE entity_id = ${v.id} AND action = 'voucher.redeem'`))).toEqual([{ actor_type: "patient" }]);
    const st = admin;
    expect((await call("GET", "/v1/staff/queue", st)).json().items.find((x: { id: string }) => x.id === rid).voucher_code).toBe("TUKAR-OK");
    const pid = (await rows(sql`SELECT id FROM patients WHERE email = 'v-ok@contoh.test'`))[0]!.id as string;
    expect((await call("GET", `/v1/staff/patients/${pid}`, st)).json().requests[0].voucher_code).toBe("TUKAR-OK");
    const stats = (await call("GET", "/v1/staff/vouchers", admin)).json().vouchers.find((x: { id: string }) => x.id === v.id);
    expect(stats).toMatchObject({ used_count: 1, max_uses: 3, status: "active" });
    // permintaan tanpa kode lain tidak punya kode
    const t2 = await patient("drmetz", "v-nokode@contoh.test");
    const r2 = await submit(t2, open.id);
    expect((await call("GET", "/v1/staff/queue", st)).json().items.find((x: { id: string }) => x.id === r2.json().id).voucher_code).toBeNull();
  });

  it("kode opsional di program open tetap ditukar", async () => {
    const v = await mk({ code: "OPEN-OK1" });
    const t = await patient("drmetz", "v-open@contoh.test");
    expect((await submit(t, open.id, "open-ok1")).statusCode).toBe(201);
    expect((await rows(sql`SELECT used_count FROM vouchers WHERE id = ${v.id}`))[0]!.used_count).toBe(1);
  });

  it.each([
    ["tak dikenal", "ZZZZ-9999", "voucher_invalid", 400],
    ["nonaktif", "TUKAR-OFF", "voucher_invalid", 400],
    ["kedaluwarsa", "TUKAR-EXP", "voucher_expired", 400],
    ["kuota habis", "TUKAR-FULL", "voucher_exhausted", 409],
    ["bukan untuk program", "TUKAR-PRG", "voucher_not_for_program", 400],
  ])("kode %s → %s (%i), permintaan tidak dibuat dan hitungan tidak berubah", async (_n, code, err, status) => {
    const vs: Record<string, object> = {
      "TUKAR-OFF": { code: "TUKAR-OFF" },
      "TUKAR-EXP": { code: "TUKAR-EXP", expires_at: "2026-10-01T00:00:00.000Z" },
      "TUKAR-FULL": { code: "TUKAR-FULL", max_uses: 1 },
      "TUKAR-PRG": { code: "TUKAR-PRG", program_id: open.id },
    };
    const v = vs[code] ? await mk(vs[code]!) : null;
    if (code === "TUKAR-OFF") await call("PATCH", `/v1/staff/vouchers/${v!.id}`, admin, { active: false });
    if (code === "TUKAR-FULL") expect((await submit(await patient("drmetz", "v-full-a@contoh.test"), locked.id, code)).statusCode).toBe(201);
    const email = `v-err-${err}-${code.toLowerCase()}@contoh.test`;
    const t = await patient("drmetz", email);
    const r = await submit(t, locked.id, code);
    expect(r.statusCode).toBe(status);
    expect(r.json().error).toBe(err);
    expect(r.json().message).toMatch(/\.$/);
    expect(await requestCount(email)).toBe(0);
    if (v) expect((await rows(sql`SELECT used_count FROM vouchers WHERE id = ${v.id}`))[0]!.used_count).toBe(code === "TUKAR-FULL" ? 1 : 0);
  });

  it("pasien yang sama memakai kode yang sama lagi → voucher_already_used (409), tak ada permintaan baru", async () => {
    await mk({ code: "SEKALI-1", max_uses: 10 });
    const t = await patient("drmetz", "v-twice@contoh.test");
    expect((await submit(t, programs[0]!.id, "SEKALI-1")).statusCode).toBe(201);
    const second = programs.find((p) => p.id !== programs[0]!.id)!;
    const r = await submit(t, second.id, "SEKALI-1");
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("voucher_already_used");
    expect(await requestCount("v-twice@contoh.test")).toBe(1);
  });

  it("dua penukaran bersamaan pada sisa kuota 1 → tepat satu berhasil", async () => {
    const v = await mk({ code: "BALAP-1", max_uses: 1 });
    const [t1, t2] = [await patient("drmetz", "v-race1@contoh.test"), await patient("drmetz", "v-race2@contoh.test")];
    const res = await Promise.all([submit(t1, locked.id, "BALAP-1"), submit(t2, locked.id, "BALAP-1")]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.statusCode === 409)!.json().error).toBe("voucher_exhausted");
    expect((await rows(sql`SELECT used_count FROM vouchers WHERE id = ${v.id}`))[0]!.used_count).toBe(1);
    expect((await requestCount("v-race1@contoh.test")) + (await requestCount("v-race2@contoh.test"))).toBe(1);
  });
});
