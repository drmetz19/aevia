import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let appNoKey: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP"), Buffer.from("VP8 body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpg")]);
const good = { brand_mode: "whitelabel", colors: { primary: "#1F4D3F", accent: "#B5542F", background: "#F5F7F3", surface: "#FFFFFF" }, font: "Inter", custom_domain: null };

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-set-")), secret: new TextEncoder().encode(SECRET) });
  const base = { db, jwtSecret: SECRET, now: () => clock, storage, otpSender: { send: async ({ email, code }: { email: string; code: string }) => void sent.push({ email, code }) } };
  app = await buildApp({ ...base, anthropicApiKey: "sk-test" });
  appNoKey = await buildApp({ ...base, anthropicApiKey: "" });
});
afterAll(async () => {
  await app.close();
  await appNoKey.close();
  await db.close();
});

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
const cache = new Map<string, string>();
async function login(email: string) {
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
}
async function staff(email: string) {
  if (!cache.has(email)) cache.set(email, await login(email));
  return cache.get(email)!;
}
async function patient(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  return (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json().token as string;
}
const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, payload?: object, a = app) =>
  a.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const upload = (url: string, token: string, body: Buffer, type = "image/png") =>
  app.inject({ method: "POST", url, payload: body, headers: { authorization: `Bearer ${token}`, "content-type": type } });
const audits = async (entityId: string) => ((await db.db.execute(sql`SELECT action FROM audit_logs WHERE entity_id = ${entityId} ORDER BY at, id`)) as unknown as { rows: { action: string }[] }).rows.map((r) => r.action);

describe("brand: kontras, font, mode", () => {
  it("menolak warna tak lolos AA dengan penjelasan + rasio; menerima yang lolos; font allowlist", async () => {
    const t = await staff("admin@demo-partner.test");
    const bad = await call("PUT", "/v1/staff/brand", t, { ...good, colors: { ...good.colors, primary: "#AAAAAA", background: "#FFFFFF", surface: "#FFFFFF" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("brand_contrast");
    expect(bad.json().message).toMatch(/hanya 2,3\d:1, padahal minimal 4,5:1/);
    expect(bad.json().details.problems.length).toBeGreaterThan(0);

    expect((await call("PUT", "/v1/staff/brand", t, { ...good, colors: { ...good.colors, primary: "biru" } })).statusCode).toBe(400);
    expect((await call("PUT", "/v1/staff/brand", t, { ...good, font: "Comic Sans" })).statusCode).toBe(400);

    const ok = await call("PUT", "/v1/staff/brand", t, good);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ brand_mode: "whitelabel", font: "Inter", colors: good.colors });
    const pub = (await app.inject("/v1/clinics/demo-partner/public")).json();
    expect(pub).toMatchObject({ font: "Inter", brand_mode: "whitelabel" });
    expect(pub.colors.primary).toBe("#1F4D3F");
  });

  it("hanya clinic_admin: professional, pasien, aevia_admin, anonim ditolak; klinik lain tidak tersentuh", async () => {
    for (const tok of [await staff("dr.metz@drmetz.test"), await staff("admin@aevia.test"), await patient("drmetz", "set1@contoh.test")]) {
      expect((await call("GET", "/v1/staff/brand", tok)).statusCode).toBe(403);
      expect((await call("PUT", "/v1/staff/brand", tok, good)).statusCode).toBe(403);
    }
    expect((await call("GET", "/v1/staff/brand", null)).statusCode).toBe(401);
    const dm = await staff("admin@drmetz.test");
    expect((await call("GET", "/v1/staff/brand", dm)).json().slug).toBe("drmetz");
  });

  it("ganti ke whitelabel/cobrand terbaca publik; perubahan diaudit before/after", async () => {
    const t = await staff("admin@drmetz.test");
    await call("PUT", "/v1/staff/brand", t, { ...good, brand_mode: "whitelabel" });
    expect((await app.inject("/v1/clinics/drmetz/public")).json().brand_mode).toBe("whitelabel");
    await call("PUT", "/v1/staff/brand", t, { ...good, brand_mode: "cobrand" });
    expect((await app.inject("/v1/clinics/drmetz/public")).json().brand_mode).toBe("cobrand");
    const id = (await call("GET", "/v1/admin/clinics", await staff("admin@aevia.test"))).json().clinics.find((c: { slug: string }) => c.slug === "drmetz").id;
    expect(await audits(id)).toEqual(expect.arrayContaining(["brand.update"]));
    const rows = ((await db.db.execute(sql`SELECT before, after FROM audit_logs WHERE entity_id = ${id} AND action = 'brand.update'`)) as unknown as { rows: { before: { brand_mode: string }; after: { brand_mode: string } }[] }).rows.find((r) => r.after.brand_mode === "cobrand")!;
    expect(rows.before.brand_mode).toBe("whitelabel");
    expect(rows.after.brand_mode).toBe("cobrand");
  });
});

describe("logo & aset publik", () => {
  it("PNG/WebP diterima; SVG, JPEG, teks menyamar, kosong, >1 MB ditolak; aset dilayani publik dengan header aman", async () => {
    const t = await staff("admin@demo-partner.test");
    const up = await upload("/v1/staff/brand/logo", t, PNG);
    expect(up.statusCode).toBe(200);
    expect(up.json().logo_url).toMatch(/^\/v1\/clinics\/demo-partner\/assets\/logo\?v=\d+$/);
    const file = await app.inject(up.json().logo_url);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["content-security-policy"]).toContain("sandbox");
    expect((await app.inject("/v1/clinics/demo-partner/public")).json().logo_url).toBe(up.json().logo_url);

    expect((await upload("/v1/staff/brand/logo", t, WEBP, "image/webp")).statusCode).toBe(200);
    expect((await upload("/v1/staff/brand/logo", t, JPG, "image/jpeg")).statusCode).toBe(415);
    expect((await upload("/v1/staff/brand/logo", t, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), "image/png")).statusCode).toBe(415);
    expect((await upload("/v1/staff/brand/logo", t, Buffer.from("<svg/>"), "image/svg+xml")).statusCode).toBe(415);
    const big = await upload("/v1/staff/brand/logo", t, Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().message).toMatch(/1 MB/);
    const huge = await upload("/v1/staff/brand/logo", t, Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 4096)]));
    expect(huge.statusCode).toBe(413);
    expect(huge.json().message).toMatch(/1 MB/);

    expect((await upload("/v1/staff/brand/logo", await staff("dr.metz@drmetz.test"), PNG)).statusCode).toBe(403);
    expect((await call("DELETE", "/v1/staff/brand/logo", t)).json().logo_url).toBeNull();
    expect((await app.inject("/v1/clinics/demo-partner/assets/logo")).statusCode).toBe(404);
  });
});

describe("asisten: pending → disetujui admin AEVIA", () => {
  it("nama baru tidak tampil sampai disetujui; web publik tetap nama lama; setelah approve tampil + avatar", async () => {
    const ca = await staff("admin@drmetz.test");
    const plat = await staff("admin@aevia.test");
    const before = (await app.inject("/v1/clinics/drmetz/public")).json();
    expect(before.assistant_name).toBe("Sovia");

    expect((await call("PUT", "/v1/staff/brand/assistant", ca, { name: "A" })).statusCode).toBe(400);
    const prop = await call("PUT", "/v1/staff/brand/assistant", ca, { name: "Metz Guide" });
    expect(prop.json().assistant).toMatchObject({ name: "Sovia", status: "pending", pending_name: "Metz Guide" });
    expect((await upload("/v1/staff/brand/assistant-avatar", ca, PNG)).json().assistant.has_pending_avatar).toBe(true);
    expect((await upload("/v1/staff/brand/assistant-avatar", ca, Buffer.from("GIF89a"), "image/png")).statusCode).toBe(415);

    const pub = (await app.inject("/v1/clinics/drmetz/public")).json();
    expect(pub.assistant_name).toBe("Sovia");
    expect(pub.avatar_url).toBeNull();

    const q = (await call("GET", "/v1/admin/assistants", plat)).json().items;
    const item = q.find((i: { slug: string }) => i.slug === "drmetz");
    expect(item).toMatchObject({ pending_name: "Metz Guide", current_name: "Sovia", has_pending_avatar: true });
    expect((await call("GET", `/v1/admin/assistants/${item.clinic_id}/avatar`, plat)).statusCode).toBe(200);
    expect((await call("GET", `/v1/admin/assistants/${item.clinic_id}/avatar`, ca)).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/assistants", ca)).statusCode).toBe(403);

    const rev = await call("POST", `/v1/admin/assistants/${item.clinic_id}/review`, plat, { decision: "approve", note: "Sesuai pedoman." });
    expect(rev.statusCode).toBe(200);
    const after = (await app.inject("/v1/clinics/drmetz/public")).json();
    expect(after.assistant_name).toBe("Metz Guide");
    expect(after.avatar_url).toMatch(/assets\/avatar/);
    expect((await app.inject(after.avatar_url)).statusCode).toBe(200);
    expect((await call("POST", `/v1/admin/assistants/${item.clinic_id}/review`, plat, { decision: "approve" })).statusCode).toBe(409);
    expect((await call("GET", "/v1/admin/assistants", plat)).json().items.some((i: { slug: string }) => i.slug === "drmetz")).toBe(false);
    expect(await audits(item.clinic_id)).toEqual(expect.arrayContaining(["assistant.propose", "assistant.avatar_propose", "assistant.approve"]));
  });

  it("tolak butuh alasan; status rejected + catatan terlihat klinik; nama lama tetap", async () => {
    const ca = await staff("admin@demo-partner.test");
    const plat = await staff("admin@aevia.test");
    const item = (await call("GET", "/v1/admin/assistants", plat)).json().items.find((i: { slug: string }) => i.slug === "demo-partner");
    expect(item.pending_name).toBe("Luna"); // dari seed
    expect((await call("POST", `/v1/admin/assistants/${item.clinic_id}/review`, plat, { decision: "reject" })).statusCode).toBe(400);
    expect((await call("POST", `/v1/admin/assistants/${item.clinic_id}/review`, plat, { decision: "reject", note: "Mirip merek lain." })).statusCode).toBe(200);
    const mine = (await call("GET", "/v1/staff/brand", ca)).json();
    expect(mine.assistant).toMatchObject({ name: "Sovia", status: "rejected", review_note: "Mirip merek lain." });
    expect((await app.inject("/v1/clinics/demo-partner/public")).json().assistant_name).toBe("Sovia");
  });
});

describe("LLM", () => {
  it("tidak bisa dinyalakan tanpa ANTHROPIC_API_KEY platform; bisa bila ada; mematikan selalu boleh", async () => {
    const ca = await staff("admin@drmetz.test");
    const view = (await call("GET", "/v1/staff/brand", ca, undefined, appNoKey)).json();
    expect(view.llm_available).toBe(false);
    const denied = await call("PUT", "/v1/staff/brand/llm", ca, { enabled: true }, appNoKey);
    expect(denied.statusCode).toBe(409);
    expect(denied.json().message).toMatch(/kunci layanan/);
    expect((await call("PUT", "/v1/staff/brand/llm", ca, { enabled: false }, appNoKey)).statusCode).toBe(200);
    const ok = await call("PUT", "/v1/staff/brand/llm", ca, { enabled: true });
    expect(ok.json()).toMatchObject({ llm_enabled: true, llm_available: true });
    await call("PUT", "/v1/staff/brand/llm", ca, { enabled: false });
  });
});

describe("domain khusus", () => {
  it("disimpan belum terverifikasi; resolve hanya setelah admin AEVIA verifikasi; unik; ganti domain mereset verifikasi", async () => {
    const ca = await staff("admin@demo-partner.test");
    const plat = await staff("admin@aevia.test");
    const set = await call("PUT", "/v1/staff/brand", ca, { ...good, custom_domain: "Sehat.Lumina.id" });
    expect(set.json()).toMatchObject({ custom_domain: "sehat.lumina.id", domain_verified: false });
    expect((await app.inject("/v1/domains/resolve?host=sehat.lumina.id")).statusCode).toBe(404);
    expect((await call("PUT", "/v1/staff/brand", await staff("admin@drmetz.test"), { ...good, brand_mode: "cobrand", custom_domain: "sehat.lumina.id" })).statusCode).toBe(409);

    const id = (await call("GET", "/v1/admin/clinics", plat)).json().clinics.find((c: { slug: string }) => c.slug === "demo-partner").id;
    expect((await call("PUT", `/v1/admin/clinics/${id}/domain`, ca, { verified: true })).statusCode).toBe(403);
    expect((await call("PUT", `/v1/admin/clinics/${id}/domain`, plat, { verified: true })).json().domain_verified).toBe(true);
    expect((await app.inject("/v1/domains/resolve?host=SEHAT.lumina.id")).json()).toEqual({ slug: "demo-partner" });
    expect((await app.inject("/v1/domains/resolve?host=127.0.0.1")).statusCode).toBe(400);

    expect((await call("PUT", "/v1/staff/brand", ca, { ...good, custom_domain: "baru.lumina.id" })).json().domain_verified).toBe(false);
    expect((await app.inject("/v1/domains/resolve?host=sehat.lumina.id")).statusCode).toBe(404);
    await call("PUT", "/v1/staff/brand", ca, { ...good, custom_domain: null });
    expect((await call("PUT", `/v1/admin/clinics/${id}/domain`, plat, { verified: true })).statusCode).toBe(409);
  });
});

describe("program CRUD", () => {
  it("buat (harga null), ubah, nonaktif tak tampil di katalog publik, hapus; dipakai → 409; diaudit; hanya clinic_admin", async () => {
    const ca = await staff("admin@demo-partner.test");
    const created = await call("POST", "/v1/staff/programs", ca, { name: "Paket Glow", summary: "Ringkas", duration_weeks: 6, price_idr: null, includes: ["Analisis kulit"], active: true });
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ slug: "paket-glow", price_idr: null });
    expect((await app.inject("/v1/clinics/demo-partner/programs")).json().programs.map((x: { name: string }) => x.name)).toContain("Paket Glow");
    const dup = (await call("POST", "/v1/staff/programs", ca, { name: "Paket Glow", summary: "", duration_weeks: null, price_idr: 100000, includes: [], active: true })).json();
    expect(dup.slug).toBe("paket-glow-2");

    const upd = await call("PUT", `/v1/staff/programs/${p.id}`, ca, { name: "Paket Glow", summary: "Ringkas", duration_weeks: 6, price_idr: 750000, includes: ["Analisis kulit"], active: false });
    expect(upd.json()).toMatchObject({ price_idr: 750000, active: false });
    expect((await app.inject("/v1/clinics/demo-partner/programs")).json().programs.some((x: { id: string }) => x.id === p.id)).toBe(false);
    expect((await call("GET", "/v1/staff/programs", ca)).json().programs.some((x: { id: string }) => x.id === p.id)).toBe(true);
    expect((await call("POST", "/v1/staff/programs", ca, { name: "x", summary: "", duration_weeks: 0, price_idr: -5, includes: [] })).statusCode).toBe(400);

    // dipakai → 409
    const pt = await patient("demo-partner", "set-prog@contoh.test");
    const catalog = (await app.inject("/v1/clinics/demo-partner/programs")).json().programs;
    await call("POST", "/v1/consultation-requests", pt, { program_id: catalog[0].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } });
    const used = await call("DELETE", `/v1/staff/programs/${catalog[0].id}`, ca);
    expect(used.statusCode).toBe(409);
    expect(used.json().message).toMatch(/Nonaktifkan/);

    expect((await call("DELETE", `/v1/staff/programs/${p.id}`, ca)).statusCode).toBe(200);
    expect((await audits(p.id)).sort()).toEqual(["program.create", "program.delete", "program.update"]);
    for (const tok of [await staff("dr.metz@drmetz.test"), pt]) expect((await call("POST", "/v1/staff/programs", tok, { name: "Uji", summary: "", duration_weeks: null, price_idr: null, includes: [], active: true })).statusCode).toBe(403);
    // klinik lain tidak bisa menyentuh
    expect((await call("PUT", `/v1/staff/programs/${catalog[0].id}`, await staff("admin@drmetz.test"), { name: "Curang", summary: "", duration_weeks: null, price_idr: null, includes: [], active: true })).statusCode).toBe(404);
  });
});

describe("tim klinik", () => {
  it("undang staf; email unik platform; nonaktif → tak bisa masuk dan token lama ditolak; guard admin terakhir/diri sendiri; aktifkan lagi", async () => {
    const ca = await staff("admin@demo-partner.test");
    const inv = await call("POST", "/v1/staff/team", ca, { email: "Dokter.Baru@Lumina.test", name: "dr. Baru", role: "professional" });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toMatchObject({ email: "dokter.baru@lumina.test", role: "professional", active: true });
    expect((await call("POST", "/v1/staff/team", ca, { email: "dr.metz@drmetz.test", name: "x y", role: "professional" })).json().error).toBe("email_taken");
    expect((await call("POST", "/v1/staff/team", ca, { email: "admin@aevia.test", name: "x y", role: "professional" })).statusCode).toBe(409);

    const tok = await login("dokter.baru@lumina.test");
    expect((await call("GET", "/v1/staff/me", tok)).json()).toMatchObject({ name: "dr. Baru", clinic_slug: "demo-partner" });
    const members = (await call("GET", "/v1/staff/team", ca)).json().members;
    expect(members.map((m: { email: string }) => m.email)).toEqual(expect.arrayContaining(["admin@demo-partner.test", "dokter.baru@lumina.test"]));

    const off = await call("PUT", `/v1/staff/team/${inv.json().id}/active`, ca, { active: false });
    expect(off.json().active).toBe(false);
    expect((await call("GET", "/v1/staff/me", tok)).statusCode).toBe(401);
    const n = sent.length;
    await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email: "dokter.baru@lumina.test" } });
    expect(sent.length).toBe(n);

    const adminId = members.find((m: { email: string }) => m.email === "admin@demo-partner.test").id;
    expect((await call("PUT", `/v1/staff/team/${adminId}/active`, ca, { active: false })).json().error).toBe("self_deactivate");
    const second = (await call("POST", "/v1/staff/team", ca, { email: "admin2@lumina.test", name: "Admin Dua", role: "clinic_admin" })).json();
    const t2 = await login("admin2@lumina.test");
    expect((await call("PUT", `/v1/staff/team/${adminId}/active`, t2, { active: false })).statusCode).toBe(200); // ada admin lain → boleh
    expect((await call("PUT", `/v1/staff/team/${second.id}/active`, ca, { active: false })).statusCode).toBe(401); // admin pertama sudah nonaktif
    expect((await call("PUT", `/v1/staff/team/${second.id}/active`, t2, { active: false })).json().error).toBe("self_deactivate");
    expect((await call("PUT", `/v1/staff/team/${adminId}/active`, t2, { active: true })).json().active).toBe(true);
    expect((await call("PUT", `/v1/staff/team/${inv.json().id}/active`, t2, { active: true })).json().active).toBe(true);
    expect((await audits(inv.json().id)).sort()).toEqual(["staff.activate", "staff.deactivate", "staff.invite"]);
    // klinik lain tak bisa mengubah
    expect((await call("PUT", `/v1/staff/team/${inv.json().id}/active`, await staff("admin@drmetz.test"), { active: false })).statusCode).toBe(404);
  });

  it("klinik dengan satu admin: tidak bisa menonaktifkan admin terakhir (oleh admin lain yang kemudian nonaktif tidak mungkin) ", async () => {
    const ca = await staff("admin@drmetz.test");
    const members = (await call("GET", "/v1/staff/team", ca)).json().members;
    const me = members.find((m: { email: string }) => m.email === "admin@drmetz.test");
    expect((await call("PUT", `/v1/staff/team/${me.id}/active`, ca, { active: false })).json().error).toBe("self_deactivate");
  });
});

describe("admin AEVIA: klinik baru", () => {
  it("buat klinik + admin pertama; slug langsung terbuka; admin pertama bisa masuk; validasi & role", async () => {
    const plat = await staff("admin@aevia.test");
    const body = { slug: "klinik-uji", name: "Klinik Uji", brand_mode: "whitelabel", admin_email: "Owner@Uji.test" };
    expect((await app.inject("/v1/clinics/klinik-uji/public")).statusCode).toBe(404);
    const res = await call("POST", "/v1/admin/clinics", plat, body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ slug: "klinik-uji", name: "Klinik Uji", brand_mode: "whitelabel" });
    const pub = await app.inject("/v1/clinics/klinik-uji/public");
    expect(pub.statusCode).toBe(200);
    expect(pub.json().name).toBe("Klinik Uji");
    expect((await app.inject("/v1/clinics/klinik-uji/programs")).json().programs).toEqual([]);

    const admin = await login("owner@uji.test");
    expect((await call("GET", "/v1/staff/me", admin)).json()).toMatchObject({ role: "clinic_admin", clinic_slug: "klinik-uji" });
    expect((await call("GET", "/v1/staff/brand", admin)).json().slug).toBe("klinik-uji");
    expect(await audits(res.json().id)).toEqual(["clinic.create"]);

    expect((await call("POST", "/v1/admin/clinics", plat, body)).json().error).toBe("slug_taken");
    expect((await call("POST", "/v1/admin/clinics", plat, { ...body, slug: "klinik-lain" })).json().error).toBe("email_taken");
    for (const slug of ["Admin", "ab", "api"]) expect((await call("POST", "/v1/admin/clinics", plat, { ...body, slug, admin_email: "x@y.test" })).statusCode, slug).toBe(400);
    const list = (await call("GET", "/v1/admin/clinics", plat)).json().clinics.map((c: { slug: string }) => c.slug);
    expect(list).toEqual(expect.arrayContaining(["drmetz", "demo-partner", "klinik-uji"]));

    for (const tok of [await staff("admin@drmetz.test"), await staff("dr.metz@drmetz.test"), await patient("drmetz", "set-plat@contoh.test"), null]) {
      expect((await call("POST", "/v1/admin/clinics", tok, { ...body, slug: "klinik-x" })).statusCode).toBe(tok ? 403 : 401);
      expect((await call("GET", "/v1/admin/clinics", tok)).statusCode).toBe(tok ? 403 : 401);
    }
  });
});
