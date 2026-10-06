import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { questions } from "@aevia/core";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
const sent: { email: string; code: string }[] = [];
const now = new Date("2026-10-04T10:00:00Z");

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

async function login(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  const code = [...sent].reverse().find((m) => m.email === email)!.code;
  return (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code } })).json().token as string;
}
const call = (method: "GET" | "POST" | "PUT", url: string, token: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
const grant = (t: string) => call("PUT", "/v1/me/consents", t, { scope: "assessment", granted: true });

async function fillAll(t: string, id: string, pick = (_q: { id: string }) => 2) {
  for (const q of questions) {
    const body = q.type === "choice" ? { question_id: q.id, value: pick(q) } : { question_id: q.id, text: "" };
    expect((await call("POST", `/v1/assessments/${id}/answers`, t, body)).statusCode).toBe(200);
  }
}

describe("assessment Sovia", () => {
  it("alur lengkap: mulai → jawab satu per satu → selesai → skor, disclaimer, event outbox", async () => {
    const t = await login("drmetz", "a1@contoh.test");
    await grant(t);
    const start = (await call("POST", "/v1/assessments", t)).json();
    expect(start).toMatchObject({ status: "in_progress", answered: 0, total: 20, flagged: false });
    expect(start.next_question.id).toBe("tujuan-1");
    // mulai lagi → lanjutkan yang sama
    expect((await call("POST", "/v1/assessments", t)).json().id).toBe(start.id);

    const first = (await call("POST", `/v1/assessments/${start.id}/answers`, t, { question_id: "tujuan-1", value: 2 })).json();
    expect(first.answered).toBe(1);
    expect(first.next_question.id).toBe("tujuan-t");

    await fillAll(t, start.id, (q) => (q.id.startsWith("tidur") ? 4 : 1));
    const done = await call("POST", `/v1/assessments/${start.id}/complete`, t);
    expect(done.statusCode).toBe(200);
    const r = done.json();
    expect(r.status).toBe("completed");
    expect(r.result.disclaimer).toBe("Hasil assessment bukan diagnosis.");
    expect(r.result.priorities[0]).toBe("tidur");
    expect(r.result.priorities).toHaveLength(3);
    const tidur = r.result.areas.find((a: { area: string }) => a.area === "tidur");
    expect(tidur).toMatchObject({ score: 0, level_label: "Prioritas untuk dibahas" });
    expect(r.flagged).toBe(false);

    const latest = (await call("GET", "/v1/assessments/latest", t)).json();
    expect(latest.id).toBe(start.id);

    const ev = await db.db.execute(sql`SELECT type, payload FROM events WHERE type = 'assessment.completed'`);
    const rows = (ev as unknown as { rows: { type: string; payload: { assessment_id: string } }[] }).rows;
    expect(rows.some((e) => e.payload.assessment_id === start.id)).toBe(true);
  });

  it("tanpa consent assessment → 403 humane; setelah diberi → berhasil", async () => {
    const t = await login("drmetz", "a2@contoh.test");
    const s = (await call("POST", "/v1/assessments", t)).json();
    await fillAll(t, s.id);
    const denied = await call("POST", `/v1/assessments/${s.id}/complete`, t);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toMatch(/persetujuan/);
    await grant(t);
    expect((await call("POST", `/v1/assessments/${s.id}/complete`, t)).statusCode).toBe(200);
  });

  it("teks bebas darurat → flagged + pesan rujukan IGD/119", async () => {
    const t = await login("drmetz", "a3@contoh.test");
    const s = (await call("POST", "/v1/assessments", t)).json();
    const r = (await call("POST", `/v1/assessments/${s.id}/answers`, t, { question_id: "tujuan-t", text: "Kadang nyeri dada dan sesak napas" })).json();
    expect(r.flagged).toBe(true);
    expect(r.emergency_message).toMatch(/IGD.*119/);
    const biasa = await login("drmetz", "a3b@contoh.test");
    const s2 = (await call("POST", "/v1/assessments", biasa)).json();
    const r2 = (await call("POST", `/v1/assessments/${s2.id}/answers`, biasa, { question_id: "tujuan-t", text: "ingin kulit lebih cerah" })).json();
    expect(r2.flagged).toBe(false);
    expect(r2.emergency_message).toBeNull();
  });

  it("validasi: jawaban kosong/di luar opsi 400; belum lengkap 400; pasien lain 404; tanpa token 401; staf 403", async () => {
    const t = await login("drmetz", "a4@contoh.test");
    await grant(t);
    const s = (await call("POST", "/v1/assessments", t)).json();
    expect((await call("POST", `/v1/assessments/${s.id}/answers`, t, { question_id: "tujuan-1" })).statusCode).toBe(400);
    expect((await call("POST", `/v1/assessments/${s.id}/answers`, t, { question_id: "tujuan-1", value: 5 })).statusCode).toBe(400);
    expect((await call("POST", `/v1/assessments/${s.id}/answers`, t, { question_id: "tidak-ada", value: 1 })).statusCode).toBe(400);
    const incomplete = await call("POST", `/v1/assessments/${s.id}/complete`, t);
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().message).toMatch(/belum terisi/);

    const other = await login("drmetz", "a5@contoh.test");
    expect((await call("POST", `/v1/assessments/${s.id}/answers`, other, { question_id: "tujuan-1", value: 1 })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/assessments" })).statusCode).toBe(401);

    await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email: "dr.metz@drmetz.test" } });
    const code = [...sent].reverse().find((m) => m.email === "dr.metz@drmetz.test")!.code;
    const st = (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email: "dr.metz@drmetz.test", code } })).json().token;
    expect((await call("POST", "/v1/assessments", st)).statusCode).toBe(403);
  });

  it("belum ada assessment → 404 manusiawi; assessment klinik lain tidak terlihat", async () => {
    const t = await login("demo-partner", "a6@contoh.test");
    const r = await call("GET", "/v1/assessments/latest", t);
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toMatch(/Belum ada assessment/);
    const same = await login("drmetz", "a6@contoh.test");
    await call("POST", "/v1/assessments", same);
    expect((await call("GET", "/v1/assessments/latest", t)).statusCode).toBe(404);
  });
});

describe("body JSON kosong", () => {
  it("POST dengan content-type JSON tanpa body tetap diterima (klien lama/integrasi)", async () => {
    const t = await login("drmetz", "body-kosong@contoh.test");
    const res = await app.inject({ method: "POST", url: "/v1/assessments", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, payload: "" });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.json().id).toBeTruthy();
  });
  it("JSON rusak tetap ditolak 400", async () => {
    const t = await login("drmetz", "body-rusak@contoh.test");
    const res = await app.inject({ method: "POST", url: "/v1/assessments", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, payload: "{rusak" });
    expect(res.statusCode).toBe(400);
  });
});

