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
    otpSender: { send: async ({ email, code }) => void sent.push({ email, code }) },
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
const call = (method: "GET" | "POST" | "PUT", url: string, token: string | null, payload?: object) =>
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
    expect(a[0].price_idr).toBe(450000);
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
    const rYes = (await call("POST", "/v1/consultation-requests", tYes, { program_id: programs[1].id, prep })).json();

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
