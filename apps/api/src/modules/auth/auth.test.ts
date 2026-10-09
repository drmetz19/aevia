import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";

const lastCode = (email: string) => [...sent].reverse().find((m) => m.email === email)!.code;
const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(slug: string, email: string): Promise<string> {
  await post(`/v1/clinics/${slug}/auth/otp`, { email });
  const res = await post(`/v1/clinics/${slug}/auth/verify`, { email, code: lastCode(email) });
  expect(res.statusCode).toBe(200);
  return res.json().token;
}

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({
    db,
    jwtSecret: SECRET,
    now: () => clock,
    otpSender: { send: async (m) => void (m.code && sent.push({ email: m.email, code: m.code })) },
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("akun pasien per klinik", () => {
  it("email sama → dua akun terpisah di drmetz dan demo-partner", async () => {
    const t1 = await login("drmetz", "sama@contoh.test");
    const t2 = await login("demo-partner", "sama@contoh.test");
    const a = (await app.inject({ url: "/v1/clinics/drmetz/me", headers: { authorization: `Bearer ${t1}` } })).json();
    const b = (await app.inject({ url: "/v1/clinics/demo-partner/me", headers: { authorization: `Bearer ${t2}` } })).json();
    expect(a.email).toBe("sama@contoh.test");
    expect(a.id).not.toBe(b.id);
    // login ulang di klinik yang sama → akun yang sama
    const t1b = await login("drmetz", "sama@contoh.test");
    const a2 = (await app.inject({ url: "/v1/clinics/drmetz/me", headers: { authorization: `Bearer ${t1b}` } })).json();
    expect(a2.id).toBe(a.id);
  });

  it("token pasien klinik A ditolak (403) di endpoint klinik B", async () => {
    const t = await login("drmetz", "lintas@contoh.test");
    const res = await app.inject({ url: "/v1/clinics/demo-partner/me", headers: { authorization: `Bearer ${t}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/tidak memiliki akses/);
  });

  it("tanpa token → 401 dengan pesan sesi berakhir; token rusak ditolak", async () => {
    const res = await app.inject("/v1/clinics/drmetz/me");
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("Sepertinya sesi Anda sudah berakhir. Silakan masuk kembali.");
    const bad = await app.inject({ url: "/v1/me/consents", headers: { authorization: "Bearer abc.def.ghi" } });
    expect(bad.statusCode).toBe(401);
  });

  it("email tak valid → 400 pesan manusiawi", async () => {
    const res = await post("/v1/clinics/drmetz/auth/otp", { email: "bukan-email" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/belum terisi atau belum sesuai/);
  });
});

describe("OTP", () => {
  it("salah 5× → dikunci, kode benar pun ditolak sampai minta kode baru", async () => {
    const email = "kunci@contoh.test";
    await post("/v1/clinics/drmetz/auth/otp", { email });
    const good = lastCode(email);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      const r = await post("/v1/clinics/drmetz/auth/verify", { email, code: wrong });
      expect(r.statusCode).toBe(400);
      expect(r.json().message).toMatch(/kesempatan/);
    }
    const fifth = await post("/v1/clinics/drmetz/auth/verify", { email, code: wrong });
    expect(fifth.statusCode).toBe(429);
    const withGood = await post("/v1/clinics/drmetz/auth/verify", { email, code: good });
    expect(withGood.statusCode).toBe(429);
    expect(withGood.json().message).toMatch(/minta kode baru/);
    // kode baru memulihkan
    await post("/v1/clinics/drmetz/auth/otp", { email });
    const ok = await post("/v1/clinics/drmetz/auth/verify", { email, code: lastCode(email) });
    expect(ok.statusCode).toBe(200);
  });

  it("kedaluwarsa setelah 10 menit; kode dipakai sekali", async () => {
    const email = "exp@contoh.test";
    await post("/v1/clinics/drmetz/auth/otp", { email });
    const code = lastCode(email);
    clock = new Date(clock.getTime() + 10 * 60_000 + 1000);
    const r = await post("/v1/clinics/drmetz/auth/verify", { email, code });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/kedaluwarsa/);

    await post("/v1/clinics/drmetz/auth/otp", { email });
    const fresh = lastCode(email);
    expect((await post("/v1/clinics/drmetz/auth/verify", { email, code: fresh })).statusCode).toBe(200);
    expect((await post("/v1/clinics/drmetz/auth/verify", { email, code: fresh })).statusCode).toBe(400);
  });

  it("permintaan kode dibatasi 3× per 10 menit", async () => {
    const email = "limit@contoh.test";
    for (let i = 0; i < 3; i++) expect((await post("/v1/clinics/drmetz/auth/otp", { email })).statusCode).toBe(200);
    const r = await post("/v1/clinics/drmetz/auth/otp", { email });
    expect(r.statusCode).toBe(429);
  });

  it("klinik tak dikenal → 404 manusiawi", async () => {
    const r = await post("/v1/clinics/tidak-ada/auth/otp", { email: "a@b.test" });
    expect(r.statusCode).toBe(404);
  });
});

describe("consent", () => {
  it("diberi lalu dicabut, status + timestamp tersimpan; empat cakupan selalu tampil", async () => {
    const t = await login("drmetz", "consent@contoh.test");
    const auth = { authorization: `Bearer ${t}` };
    const first = (await app.inject({ url: "/v1/me/consents", headers: auth })).json().consents;
    expect(first.map((c: { scope: string }) => c.scope)).toEqual(["assessment", "medical_record", "photos", "external_context"]);
    expect(first.every((c: { granted: boolean; decided: boolean }) => !c.granted && !c.decided)).toBe(true);

    const put = (granted: boolean) =>
      app.inject({ method: "PUT", url: "/v1/me/consents", headers: auth, payload: { scope: "photos", granted } });
    const g = (await put(true)).json().consents.find((c: { scope: string }) => c.scope === "photos");
    expect(g).toMatchObject({ granted: true, revoked_at: null, decided: true });
    expect(g.granted_at).toBe(clock.toISOString());

    clock = new Date(clock.getTime() + 60_000);
    const r = (await put(false)).json().consents.find((c: { scope: string }) => c.scope === "photos");
    expect(r).toMatchObject({ granted: false, decided: true });
    expect(r.revoked_at).toBe(clock.toISOString());
    expect(r.granted_at).not.toBeNull();

    const again = (await put(true)).json().consents.find((c: { scope: string }) => c.scope === "photos");
    expect(again).toMatchObject({ granted: true, revoked_at: null });
  });

  it("scope tak dikenal → 400; consent pasien lain tidak terlihat", async () => {
    const t1 = await login("drmetz", "c1@contoh.test");
    const t2 = await login("drmetz", "c2@contoh.test");
    const bad = await app.inject({ method: "PUT", url: "/v1/me/consents", headers: { authorization: `Bearer ${t1}` }, payload: { scope: "x", granted: true } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: "PUT", url: "/v1/me/consents", headers: { authorization: `Bearer ${t1}` }, payload: { scope: "assessment", granted: true } });
    const other = (await app.inject({ url: "/v1/me/consents", headers: { authorization: `Bearer ${t2}` } })).json().consents;
    expect(other.find((c: { scope: string }) => c.scope === "assessment").granted).toBe(false);
  });
});

describe("staf", () => {
  it("dr. Metz masuk via OTP → role professional di klinik drmetz; email tak dikenal tak membocorkan apa-apa", async () => {
    const unknown = await post("/v1/staff/auth/otp", { email: "asing@contoh.test" });
    expect(unknown.statusCode).toBe(200);
    expect(sent.some((m) => m.email === "asing@contoh.test")).toBe(false);

    const email = "dr.metz@drmetz.test";
    await post("/v1/staff/auth/otp", { email });
    const v = await post("/v1/staff/auth/verify", { email, code: lastCode(email) });
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({ role: "professional", clinic_slug: "drmetz" });
    const me = await app.inject({ url: "/v1/staff/me", headers: { authorization: `Bearer ${v.json().token}` } });
    expect(me.json()).toMatchObject({ name: "dr. Metz", role: "professional" });
  });

  it("platform admin → aevia_admin; token pasien ditolak di /v1/staff/me", async () => {
    const email = "admin@aevia.test";
    await post("/v1/staff/auth/otp", { email });
    const v = await post("/v1/staff/auth/verify", { email, code: lastCode(email) });
    expect(v.json()).toMatchObject({ role: "aevia_admin", clinic_slug: null });
    const pt = await login("drmetz", "pasien@contoh.test");
    const r = await app.inject({ url: "/v1/staff/me", headers: { authorization: `Bearer ${pt}` } });
    expect(r.statusCode).toBe(403);
  });

  it("clinic_admin per klinik bisa masuk", async () => {
    const email = "admin@demo-partner.test";
    await post("/v1/staff/auth/otp", { email });
    const v = await post("/v1/staff/auth/verify", { email, code: lastCode(email) });
    expect(v.json()).toMatchObject({ role: "clinic_admin", clinic_slug: "demo-partner" });
  });
});

describe("pengirim email OTP", () => {
  it("Resend: mengirim email netral tanpa merek; galat penyedia dilempar; env menentukan adapter", async () => {
    const { resendOtpSender, otpSenderFromEnv, consoleOtpSender } = await import("./otp-sender");
    const seen: { url: string; body: { to: string[]; subject: string; text: string; from: string }; auth: string }[] = [];
    const f = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      seen.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization! });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await resendOtpSender({ apiKey: "re_x", from: "Klinik <masuk@k.id>", fetchFn: f }).send({ email: "a@b.id", code: "123456", purpose: "patient", clinicSlug: "demo-partner" });
    expect(seen[0]).toMatchObject({ url: "https://api.resend.com/emails", auth: "Bearer re_x" });
    expect(seen[0]!.body).toMatchObject({ to: ["a@b.id"], from: "Klinik <masuk@k.id>" });
    expect(seen[0]!.body.text).toContain("123456");
    expect(JSON.stringify(seen[0]!.body)).not.toMatch(/aevia/i);
    const bad = (async () => new Response("no", { status: 422 })) as unknown as typeof fetch;
    await expect(resendOtpSender({ apiKey: "k", from: "f", fetchFn: bad }).send({ email: "a@b.id", code: "1", purpose: "staff" })).rejects.toThrow(/gagal/);
    expect(otpSenderFromEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(consoleOtpSender);
    expect(() => otpSenderFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/MAILKETING_API_TOKEN/);
    expect(() => otpSenderFromEnv({ RESEND_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(/OTP_FROM_EMAIL/);
    expect(otpSenderFromEnv({ RESEND_API_KEY: "k", OTP_FROM_EMAIL: "f" } as NodeJS.ProcessEnv)).not.toBe(consoleOtpSender);
  });

  it("Mailketing: form-urlencoded ke /api/v1/send; status 'failed' dengan HTTP 200 tetap dianggap gagal; diprioritaskan di env", async () => {
    const { mailketingOtpSender, otpSenderFromEnv, parseFrom } = await import("./otp-sender");
    const seen: { url: string; body: URLSearchParams; ct: string }[] = [];
    const ok = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      seen.push({ url, body: new URLSearchParams(init.body), ct: init.headers["content-type"]! });
      return new Response(JSON.stringify({ status: "success", response: "Mail Sent" }), { status: 200 });
    }) as unknown as typeof fetch;
    await mailketingOtpSender({ apiToken: "tok", from: "Klinik DrMetz <masuk@drmetz.id>", fetchFn: ok }).send({ email: "a@b.id", code: "654321", purpose: "patient" });
    expect(seen[0]!.url).toBe("https://api.mailketing.co.id/api/v1/send");
    expect(seen[0]!.ct).toBe("application/x-www-form-urlencoded");
    const b = seen[0]!.body;
    expect([b.get("api_token"), b.get("from_name"), b.get("from_email"), b.get("recipient")]).toEqual(["tok", "Klinik DrMetz", "masuk@drmetz.id", "a@b.id"]);
    expect(b.get("content")).toContain("654321");
    expect(b.toString()).not.toMatch(/aevia/i);
    const failed = (async () => new Response(JSON.stringify({ status: "failed", response: "No Credits, Please Top Up" }), { status: 200 })) as unknown as typeof fetch;
    await expect(mailketingOtpSender({ apiToken: "t", from: "x@y.id", fetchFn: failed }).send({ email: "a@b.id", code: "1", purpose: "staff" })).rejects.toThrow(/No Credits/);
    expect(parseFrom("masuk@k.id")).toEqual({ name: "masuk@k.id", email: "masuk@k.id" });
    expect(() => otpSenderFromEnv({ MAILKETING_API_TOKEN: "t" } as NodeJS.ProcessEnv)).toThrow(/OTP_FROM_EMAIL/);
    const viaEnv = otpSenderFromEnv({ MAILKETING_API_TOKEN: "t", RESEND_API_KEY: "r", OTP_FROM_EMAIL: "A <a@k.id>" } as NodeJS.ProcessEnv, ok);
    seen.length = 0;
    await viaEnv.send({ email: "z@b.id", code: "111111", purpose: "staff" });
    expect(seen[0]!.url).toContain("mailketing");
  });
});
