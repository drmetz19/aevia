import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import type { MailMessage } from "./otp-sender";
import { hashPassword, verifyPassword } from "./password";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-09T03:00:00Z");
const mails: MailMessage[] = [];
const CONSOLE = "https://console.contoh.test";

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({
    db,
    jwtSecret: "test-secret-test-secret-test-secret-123",
    now: () => clock,
    consoleUrl: CONSOLE,
    otpSender: { send: async (m) => void mails.push(m) },
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const post = (url: string, payload: object, token?: string) =>
  app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const lastLink = (email: string) => {
  const m = [...mails].reverse().find((x) => x.email === email && x.link);
  return m ? { purpose: m.purpose, link: m.link!, token: new URL(m.link!).searchParams.get("token")! } : null;
};
const tick = (min: number) => (clock = new Date(clock.getTime() + min * 60_000));

describe("hash password", () => {
  it("scrypt: cocok untuk password benar, tidak untuk yang salah, salt berbeda tiap hash", async () => {
    const h = await hashPassword("rahasia-panjang-1");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("rahasia-panjang-1", h)).toBe(true);
    expect(await verifyPassword("rahasia-panjang-2", h)).toBe(false);
    expect(await hashPassword("rahasia-panjang-1")).not.toBe(h);
  });
});

describe("login staf dengan password", () => {
  const email = "dr.metz@drmetz.test";

  it("belum punya password → ditolak dengan pesan umum", async () => {
    const r = await post("/v1/staff/auth/login", { email, password: "apa-saja-123" });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe("Email atau password belum sesuai.");
  });

  it("minta link: email tak terdaftar → jawaban sama, tanpa email terkirim", async () => {
    const before = mails.length;
    const r = await post("/v1/staff/auth/password/request", { email: "tidak-ada@contoh.test" });
    expect(r.statusCode).toBe(200);
    expect(mails.length).toBe(before);
  });

  it("minta link untuk staf tanpa password → link 'set' ke console", async () => {
    const r = await post("/v1/staff/auth/password/request", { email });
    expect(r.statusCode).toBe(200);
    const l = lastLink(email)!;
    expect(l.purpose).toBe("password_set");
    expect(l.link.startsWith(`${CONSOLE}/atur-password?token=`)).toBe(true);
  });

  it("atur password: terlalu pendek ditolak; valid → langsung dapat sesi; link tidak bisa dipakai ulang", async () => {
    const { token } = lastLink(email)!;
    expect((await post("/v1/staff/auth/password/set", { token, password: "pendek" })).statusCode).toBe(400);
    const ok = await post("/v1/staff/auth/password/set", { token, password: "Password-Kuat-2026" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe("professional");
    expect(ok.json().clinic_slug).toBe("drmetz");
    const again = await post("/v1/staff/auth/password/set", { token, password: "Password-Lain-2026" });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe("link_invalid");
  });

  it("login benar → sesi staf; sesi bisa membuka /v1/staff/me", async () => {
    const r = await post("/v1/staff/auth/login", { email, password: "Password-Kuat-2026" });
    expect(r.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/v1/staff/me", headers: { authorization: `Bearer ${r.json().token}` } });
    expect(me.json().email).toBe(email);
  });

  it("5× salah → terkunci 15 menit (password benar pun ditolak), lalu bisa lagi", async () => {
    for (let i = 0; i < 4; i++) expect((await post("/v1/staff/auth/login", { email, password: "salah-salah-1" })).statusCode).toBe(400);
    expect((await post("/v1/staff/auth/login", { email, password: "salah-salah-1" })).statusCode).toBe(429);
    expect((await post("/v1/staff/auth/login", { email, password: "Password-Kuat-2026" })).statusCode).toBe(429);
    tick(16);
    expect((await post("/v1/staff/auth/login", { email, password: "Password-Kuat-2026" })).statusCode).toBe(200);
  });

  it("sudah punya password → link berikutnya 'reset' dan kedaluwarsa setelah 60 menit", async () => {
    await post("/v1/staff/auth/password/request", { email });
    const l = lastLink(email)!;
    expect(l.purpose).toBe("password_reset");
    tick(61);
    expect((await post("/v1/staff/auth/password/set", { token: l.token, password: "Password-Baru-2026" })).json().error).toBe("link_invalid");
  });

  it("permintaan link dibatasi 3 per jam", async () => {
    const e = "admin@drmetz.test";
    for (let i = 0; i < 3; i++) expect((await post("/v1/staff/auth/password/request", { email: e })).statusCode).toBe(200);
    expect((await post("/v1/staff/auth/password/request", { email: e })).statusCode).toBe(429);
  });

  it("token palsu ditolak", async () => {
    expect((await post("/v1/staff/auth/password/set", { token: "x".repeat(43), password: "Password-Kuat-2026" })).json().error).toBe("link_invalid");
  });
});

describe("undangan otomatis", () => {
  it("admin platform membuat klinik → admin klinik menerima link 'set'; staf yang diundang juga", async () => {
    // admin platform masuk lewat password (link set → atur → sesi)
    tick(120);
    await post("/v1/staff/auth/password/request", { email: "admin@aevia.test" });
    const pa = (await post("/v1/staff/auth/password/set", { token: lastLink("admin@aevia.test")!.token, password: "Admin-Platform-2026" })).json().token;

    const c = await post("/v1/admin/clinics", { slug: "klinik-baru", name: "Klinik Baru", brand_mode: "cobrand", admin_email: "pemilik@klinikbaru.test" }, pa);
    expect(c.statusCode).toBe(201);
    expect(lastLink("pemilik@klinikbaru.test")?.purpose).toBe("password_set");

    const owner = (await post("/v1/staff/auth/password/set", { token: lastLink("pemilik@klinikbaru.test")!.token, password: "Pemilik-Klinik-2026" })).json();
    expect(owner.role).toBe("clinic_admin");
    expect(owner.clinic_slug).toBe("klinik-baru");

    const inv = await post("/v1/staff/team", { email: "dokter@klinikbaru.test", name: "dr. Baru", role: "professional" }, owner.token);
    expect(inv.statusCode).toBe(201);
    expect(lastLink("dokter@klinikbaru.test")?.purpose).toBe("password_set");
  });

  it("staf nonaktif tidak bisa masuk walau password benar", async () => {
    const owner = (await post("/v1/staff/auth/login", { email: "pemilik@klinikbaru.test", password: "Pemilik-Klinik-2026" })).json().token;
    const dok = (await post("/v1/staff/auth/password/set", { token: lastLink("dokter@klinikbaru.test")!.token, password: "Dokter-Baru-2026" })).json();
    expect(dok.role).toBe("professional");
    const team = await app.inject({ method: "GET", url: "/v1/staff/team", headers: { authorization: `Bearer ${owner}` } });
    const id = team.json().members.find((m: { email: string }) => m.email === "dokter@klinikbaru.test").id;
    expect(JSON.stringify(team.json())).not.toMatch(/scrypt|password/);
    await app.inject({ method: "PUT", url: `/v1/staff/team/${id}/active`, payload: { active: false }, headers: { authorization: `Bearer ${owner}` } });
    expect((await post("/v1/staff/auth/login", { email: "dokter@klinikbaru.test", password: "Dokter-Baru-2026" })).statusCode).toBe(400);
  });
});
