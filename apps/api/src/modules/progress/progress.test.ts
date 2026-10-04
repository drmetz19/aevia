import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
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
/** Majukan jam. Token berumur 12 jam, jadi cache login staf dibuang dan pasien login ulang lewat relogin(). */
function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
  cache.clear();
}
const relogin = (email: string) => patient("drmetz", email);
async function staff(email: string) {
  if (cache.has(email)) return cache.get(email)!;
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  const t = (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
  cache.set(email, t);
  return t;
}
const call = (method: "GET" | "POST" | "PUT", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const eventsOf = async (type: string) => ((await db.db.execute(sql`SELECT payload FROM events WHERE type = ${type}`)) as unknown as { rows: { payload: Record<string, unknown> }[] }).rows;

async function withSignedPlan(email: string, review_at: string | null = "2026-11-15") {
  const pt = await patient("drmetz", email);
  const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
  const r = (await call("POST", "/v1/consultation-requests", pt, { program_id: programs[0].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
  const st = await staff("dr.metz@drmetz.test");
  const k = (await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: "2027-06-01T02:00:00.000Z", meeting_url: "https://meet.google.com/a-b-c" })).json().consultation.id;
  const plan = (await call("PUT", `/v1/staff/consultations/${k}/care-plans`, st, {
    content: {
      focus: ["Berat badan stabil"],
      next_steps: ["Jalan kaki"],
      monitor: [
        { metric_key: "berat", label: "Berat badan", unit: "kg", baseline: 70, target: 65, direction: "down" },
        { metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" },
      ],
      review_at,
    },
    summary: { discussed: "d", priorities: [] },
  })).json();
  await call("POST", `/v1/staff/care-plans/${plan.id}/sign`, st, { confirm: true });
  return { pt, st };
}

describe("check-in umum (tanpa rencana)", () => {
  it("diperbolehkan: metrik umum tidur/energi/stres; belum ada data → progres kosong", async () => {
    const pt = await patient("drmetz", "g1@contoh.test");
    const form = (await call("GET", "/v1/checkins/form", pt)).json();
    expect(form).toMatchObject({ general: true, plan_id: null });
    expect(form.fields.map((f: { key: string }) => f.key)).toEqual(["tidur", "energi", "stres"]);
    expect(form.fields.find((f: { key: string }) => f.key === "stres").label).toBe("Ketenangan (kebalikan stres)");
    const empty = (await call("GET", "/v1/progress", pt)).json();
    expect(empty).toMatchObject({ checkin_count: 0, last_checkin_at: null, general: true });
    expect(empty.metrics.every((m: { current: number | null }) => m.current === null)).toBe(true);
  });

  it("check-in kedua menghitung delta % vs sebelumnya; event checkin.submitted & progress.updated", async () => {
    const pt = await patient("drmetz", "g2@contoh.test");
    const n0 = (await eventsOf("checkin.submitted")).length;
    const p0 = (await eventsOf("progress.updated")).length;
    const first = await call("POST", "/v1/checkins", pt, { values: { tidur: 2, energi: 3, stres: 2 }, note: "minggu pertama" });
    expect(first.statusCode).toBe(201);
    expect(first.json().metrics.find((m: { key: string }) => m.key === "tidur")).toMatchObject({ current: 2, previous: null, delta_text: null, status: "first" });

    advance(14 * 86_400_000);
    const second = (await call("POST", "/v1/checkins", await relogin("g2@contoh.test"), { values: { tidur: 3, energi: 3, stres: 3 } })).json();
    const tidur = second.metrics.find((m: { key: string }) => m.key === "tidur");
    expect(tidur).toMatchObject({ current: 3, previous: 2, change_pct: 50, delta_text: "Naik 50% sejak check-in terakhir", status: "positive" });
    expect(second.metrics.find((m: { key: string }) => m.key === "stres")).toMatchObject({ change_pct: 50, delta_text: "Naik 50% sejak check-in terakhir", status: "positive", direction: "up" });
    expect(second.metrics.find((m: { key: string }) => m.key === "energi").status).toBe("stable");
    expect(second.checkin_count).toBe(2);
    expect(JSON.stringify(second)).not.toMatch(/buruk|gagal/i);

    expect((await eventsOf("checkin.submitted")).length - n0).toBe(2);
    const pu = await eventsOf("progress.updated");
    expect(pu.length - p0).toBe(2);
    expect(pu.at(-1)!.payload).toMatchObject({ checkin_count: 2, previous_checkin_count: 1 });
  });

  it("validasi: kosong, kunci asing, skala di luar 1–5, bukan bilangan bulat → 400 humane", async () => {
    const pt = await patient("drmetz", "g3@contoh.test");
    expect((await call("POST", "/v1/checkins", pt, { values: {} })).json().message).toBe("Ada satu bagian yang belum terisi.");
    expect((await call("POST", "/v1/checkins", pt, { values: { asing: 3 } })).statusCode).toBe(400);
    const range = await call("POST", "/v1/checkins", pt, { values: { tidur: 6 } });
    expect(range.statusCode).toBe(400);
    expect(range.json().message).toMatch(/antara 1 dan 5/);
    expect((await call("POST", "/v1/checkins", pt, { values: { tidur: 2.5 } })).statusCode).toBe(400);
    expect((await call("POST", "/v1/checkins", null, { values: { tidur: 3 } })).statusCode).toBe(401);
  });
});

describe("check-in dari rencana signed", () => {
  it("form memakai monitor[] rencana (skala vs numerik); nilai numerik diterima; delta direction-aware", async () => {
    const { pt } = await withSignedPlan("p1@contoh.test");
    const form = (await call("GET", "/v1/checkins/form", pt)).json();
    expect(form.general).toBe(false);
    expect(form.fields).toEqual([
      { key: "berat", label: "Berat badan", unit: "kg", scale: false, min: 0, max: 100000 },
      { key: "tidur", label: "Kualitas tidur", unit: "skor", scale: true, min: 1, max: 5 },
    ]);
    await call("POST", "/v1/checkins", pt, { values: { berat: 70, tidur: 2 } });
    advance(14 * 86_400_000);
    const p = (await call("POST", "/v1/checkins", await relogin("p1@contoh.test"), { values: { berat: 66, tidur: 2 } })).json();
    const berat = p.metrics.find((m: { key: string }) => m.key === "berat");
    expect(berat).toMatchObject({ current: 66, previous: 70, target: 65, direction: "down", status: "positive" });
    expect(berat.delta_text).toBe("Turun 5.7% sejak check-in terakhir");
    expect(p.metrics.find((m: { key: string }) => m.key === "tidur").status).toBe("stable");
  });
});

describe("pengingat", () => {
  it("setelah tanda tangan: kabar rencana (langsung), check-in 14 hari, tinjauan di review_at; muncul bila jatuh tempo", async () => {
    const { pt } = await withSignedPlan("r1@contoh.test", "2026-12-01");
    const now = (await call("GET", "/v1/reminders", pt)).json().reminders;
    expect(now.map((r: { kind: string }) => r.kind)).toEqual(["plan"]);
    expect(now[0].message).toBe("Rencana Anda sudah diperbarui.");

    advance(14 * 86_400_000 + 1000);
    expect((await call("GET", "/v1/reminders", await relogin("r1@contoh.test"))).json().reminders.map((r: { kind: string }) => r.kind)).toEqual(["checkin", "plan"]);
    advance(new Date("2026-12-01T03:00:00Z").getTime() - clock.getTime());
    const kinds = (await call("GET", "/v1/reminders", await relogin("r1@contoh.test"))).json().reminders.map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["review", "checkin", "plan"]));
  });

  it("check-in menyelesaikan pengingat check-in dan menjadwalkan ulang 14 hari; tandai dibaca; milik pasien lain 404", async () => {
    await withSignedPlan("r2@contoh.test", null);
    advance(15 * 86_400_000);
    const pt2 = await relogin("r2@contoh.test");
    const due = (await call("GET", "/v1/reminders", pt2)).json().reminders;
    expect(due.find((r: { kind: string }) => r.kind === "checkin").message).toBe("Waktunya check-in singkat.");
    await call("POST", "/v1/checkins", pt2, { values: { berat: 69, tidur: 3 } });
    const after = (await call("GET", "/v1/reminders", pt2)).json().reminders;
    expect(after.some((r: { kind: string }) => r.kind === "checkin")).toBe(false);
    const rows = ((await db.db.execute(sql`SELECT due_at FROM reminders WHERE kind='checkin' AND read_at IS NULL AND message='Waktunya check-in singkat.' ORDER BY due_at DESC LIMIT 1`)) as unknown as { rows: { due_at: string | Date }[] }).rows;
    expect(new Date(rows[0]!.due_at).getTime()).toBe(clock.getTime() + 14 * 86_400_000);

    const planReminder = due.find((r: { kind: string }) => r.kind === "plan");
    const other = await patient("drmetz", "r2-other@contoh.test");
    const pt = pt2;
    expect((await call("POST", `/v1/reminders/${planReminder.id}/read`, other)).statusCode).toBe(404);
    expect((await call("POST", `/v1/reminders/${planReminder.id}/read`, pt)).statusCode).toBe(200);
    expect((await call("GET", "/v1/reminders", pt)).json().reminders.some((r: { id: string }) => r.id === planReminder.id)).toBe(false);
  });
});

describe("progres di console", () => {
  it("profesional melihat progres yang sama bila consent rekam medis aktif; tanpa itu disembunyikan; role lain 403", async () => {
    const { pt, st } = await withSignedPlan("s1@contoh.test");
    await call("POST", "/v1/checkins", pt, { values: { berat: 70, tidur: 2 } });
    const mine = (await call("GET", "/v1/progress", pt)).json();
    const pid = (await call("GET", "/v1/clinics/drmetz/me", pt)).json().id;

    const hidden = (await call("GET", `/v1/staff/patients/${pid}/progress`, st)).json();
    expect(hidden).toMatchObject({ progress_visible: false, progress: null });
    expect(hidden.hidden_reason).toMatch(/rekam medis/);

    await call("PUT", "/v1/me/consents", pt, { scope: "medical_record", granted: true });
    const seen = (await call("GET", `/v1/staff/patients/${pid}/progress`, st)).json();
    expect(seen.progress_visible).toBe(true);
    expect(seen.progress).toEqual(mine);

    expect((await call("GET", `/v1/staff/patients/${pid}/progress`, pt)).statusCode).toBe(403);
    expect((await call("GET", `/v1/staff/patients/${pid}/progress`, await staff("admin@drmetz.test"))).statusCode).toBe(403);
    expect((await call("GET", `/v1/staff/patients/${pid}/progress`, await staff("admin@demo-partner.test"))).statusCode).toBe(403);
    expect((await call("GET", "/v1/progress", st)).statusCode).toBe(403);
  });
});
