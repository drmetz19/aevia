import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body")]);

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({
    db,
    jwtSecret: SECRET,
    now: () => clock,
    storage: createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-up-")), secret: new TextEncoder().encode(SECRET) }),
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
const staffCache = new Map<string, string>();
async function staff(email: string) {
  if (staffCache.has(email)) return staffCache.get(email)!;
  const t = await staffLogin(email);
  staffCache.set(email, t);
  return t;
}
async function staffLogin(email: string) {
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
}
const call = (method: "GET" | "POST" | "PUT", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const upload = (id: string, token: string, body: Buffer, type = "image/jpeg", angle = "front") =>
  app.inject({ method: "POST", url: `/v1/staff/consultations/${id}/photos?angle=${angle}`, payload: body, headers: { authorization: `Bearer ${token}`, "content-type": type } });

async function setup(email: string, photos = true) {
  const pt = await patient("drmetz", email);
  if (photos) await call("PUT", "/v1/me/consents", pt, { scope: "photos", granted: true });
  const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
  const r = (await call("POST", "/v1/consultation-requests", pt, { program_id: programs[1].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
  const st = await staff("dr.metz@drmetz.test");
  const acc = (await call("POST", `/v1/staff/consultation-requests/${r.id}/accept`, st, { scheduled_at: "2026-10-20T02:00:00.000Z", meeting_url: "https://meet.google.com/x-y-z" })).json();
  return { pt, st, id: acc.consultation.id as string };
}

describe("SOAP + audit", () => {
  it("simpan SOAP; edit kedua tercatat di audit dengan before/after", async () => {
    const { st, id } = await setup("soap@contoh.test");
    expect((await call("GET", `/v1/staff/consultations/${id}`, st)).json()).toMatchObject({ patient: { email: "soap@contoh.test" }, program_name: "Program Pendampingan Kulit 8 Minggu" });
    const v1 = { subjective: "S1", objective: "O1", assessment: "A1", plan: "P1" };
    expect((await call("PUT", `/v1/staff/consultations/${id}/soap`, st, v1)).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 60_000);
    const v2 = { ...v1, plan: "P2 revisi" };
    const saved = (await call("PUT", `/v1/staff/consultations/${id}/soap`, st, v2)).json();
    expect(saved.plan).toBe("P2 revisi");
    expect((await call("GET", `/v1/staff/consultations/${id}`, st)).json().soap.plan).toBe("P2 revisi");

    const entries = (await call("GET", `/v1/staff/consultations/${id}/audit`, st)).json().entries;
    const soap = entries.filter((e: { entity: string }) => e.entity === "soap_note");
    expect(soap.map((e: { action: string }) => e.action)).toEqual(["soap.update", "soap.create"]);
    expect(soap[0].before).toEqual(v1);
    expect(soap[0].after).toEqual(v2);
    expect(soap[1].before).toBeNull();
    expect(soap[0]).toMatchObject({ actor_type: "staff", actor_name: "dr. Metz", at: clock.toISOString() });
  });

  it("audit tidak bisa diubah atau dihapus oleh aevia_app", async () => {
    const { sql } = await import("drizzle-orm");
    await expect(
      db.withTenant("00000000-0000-0000-0000-000000000000", (tx) => tx.execute(sql`DELETE FROM audit_logs`)),
    ).rejects.toThrow();
    await expect(
      db.withTenant("00000000-0000-0000-0000-000000000000", (tx) => tx.execute(sql`UPDATE audit_logs SET action = 'x'`)),
    ).rejects.toThrow();
  });
});

describe("skin analysis", () => {
  it("parameter default klinik, skor 0–100, parameter asing ditolak, audit tercatat", async () => {
    const { st, id } = await setup("skin@contoh.test");
    const v = (await call("GET", `/v1/staff/consultations/${id}/skin`, st)).json();
    expect(v.parameters.map((p: { label: string }) => p.label)).toEqual([
      "Melasma & hiperpigmentasi",
      "Eritema vaskular",
      "Komedo & porfirin",
      "TEWL & dehidrasi",
      "Tekstur & pori",
      "Skor kulit keseluruhan",
    ]);
    const ok = await call("PUT", `/v1/staff/consultations/${id}/skin`, st, { scores: { melasma_hiperpigmentasi: 54, skor_keseluruhan: 72 }, notes: "catatan" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().scores.skor_keseluruhan).toBe(72);
    expect((await call("PUT", `/v1/staff/consultations/${id}/skin`, st, { scores: { skor_keseluruhan: 101 }, notes: "" })).statusCode).toBe(400);
    expect((await call("PUT", `/v1/staff/consultations/${id}/skin`, st, { scores: { asing: 5 }, notes: "" })).statusCode).toBe(400);
    const a = (await call("GET", `/v1/staff/consultations/${id}/audit`, st)).json().entries.filter((e: { entity: string }) => e.entity === "skin_analysis");
    expect(a[0]).toMatchObject({ action: "skin.create", after: { scores: { skor_keseluruhan: 72 } } });
  });
});

describe("foto kulit", () => {
  it("unggah jpg valid → URL bertanda tangan menyajikan berkas; magic bytes divalidasi", async () => {
    const { st, id } = await setup("foto@contoh.test");
    const up = await upload(id, st, JPG);
    expect(up.statusCode).toBe(201);
    const photoId = up.json().id;
    const u = (await call("GET", `/v1/staff/photos/${photoId}/url`, st)).json();
    const file = await app.inject(u.url);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(Buffer.compare(file.rawPayload, JPG)).toBe(0);

    expect((await upload(id, st, Buffer.from("<svg onload=alert(1)>"), "image/jpeg")).statusCode).toBe(415);
    expect((await upload(id, st, Buffer.from("GIF89a....."), "image/png")).statusCode).toBe(415);
    expect((await upload(id, st, JPG, "application/pdf")).statusCode).toBe(415);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]);
    const tooBig = await upload(id, st, big);
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json().message).toMatch(/10 MB/);
  });

  it("URL kedaluwarsa atau dimanipulasi ditolak", async () => {
    const { st, id } = await setup("ttl@contoh.test");
    const photoId = (await upload(id, st, JPG)).json().id;
    const u = (await call("GET", `/v1/staff/photos/${photoId}/url`, st)).json().url as string;
    expect((await app.inject(u.replace(/s=[^&]+/, "s=AAAAAAAAAAAAAAAAAAAA"))).statusCode).toBe(403);
    expect((await app.inject(u.replace(/e=\d+/, "e=9999999999"))).statusCode).toBe(403);
    clock = new Date(clock.getTime() + 301_000);
    expect((await app.inject(u)).statusCode).toBe(403);
  });

  it("consent foto dicabut → URL lama, URL baru, daftar foto, dan unggah semuanya ditolak", async () => {
    const { pt, st, id } = await setup("cabut@contoh.test");
    const photoId = (await upload(id, st, JPG)).json().id;
    const u = (await call("GET", `/v1/staff/photos/${photoId}/url`, st)).json().url;
    expect((await app.inject(u)).statusCode).toBe(200);
    await call("PUT", "/v1/me/consents", pt, { scope: "photos", granted: false });
    const after = await app.inject(u);
    expect(after.statusCode).toBe(403);
    expect(after.json().message).toMatch(/Persetujuan foto/);
    expect((await call("GET", `/v1/staff/photos/${photoId}/url`, st)).statusCode).toBe(403);
    expect((await upload(id, st, JPG)).statusCode).toBe(403);
    const skin = (await call("GET", `/v1/staff/consultations/${id}/skin`, st)).json();
    expect(skin.photos).toEqual([]);
    expect(skin.photos_consent).toBe(false);
    await call("PUT", "/v1/me/consents", pt, { scope: "photos", granted: true });
    expect((await app.inject(u)).statusCode).toBe(200);
  });

  it("tanpa consent sejak awal → unggah 403 humane", async () => {
    const { st, id } = await setup("noc@contoh.test", false);
    const r = await upload(id, st, JPG);
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/persetujuan untuk foto/);
  });

  it("anotasi titik dan area tersimpan dan kembali di posisi yang sama; validasi; audit", async () => {
    const { st, id } = await setup("anot@contoh.test");
    const photoId = (await upload(id, st, JPG, "image/jpeg", "left")).json().id;
    const ann = [
      { type: "point", x: 0.25, y: 0.4, label: "Bercak", severity: "medium" },
      { type: "area", x: 0.5, y: 0.2, w: 0.2, h: 0.3, label: "Kemerahan", severity: "high" },
    ];
    expect((await call("PUT", `/v1/staff/photos/${photoId}/annotations`, st, { annotations: ann })).statusCode).toBe(200);
    const skin = (await call("GET", `/v1/staff/consultations/${id}/skin`, st)).json();
    expect(skin.photos[0].angle).toBe("left");
    expect(skin.photos[0].annotations).toEqual(ann);
    expect((await call("PUT", `/v1/staff/photos/${photoId}/annotations`, st, { annotations: [{ type: "point", x: 2, y: 0, label: "x", severity: "low" }] })).statusCode).toBe(400);
    const e = (await call("GET", `/v1/staff/consultations/${id}/audit`, st)).json().entries.map((x: { action: string }) => x.action);
    expect(e).toContain("photo.upload");
    expect(e).toContain("photo.annotations");
  });
});

describe("akses", () => {
  it("token pasien 403 di semua endpoint klinis; tanpa token 401", async () => {
    const { pt, st, id } = await setup("akses@contoh.test");
    const photoId = (await upload(id, st, JPG)).json().id;
    const soap = { subjective: "", objective: "", assessment: "", plan: "" };
    const reqs: [string, string, object?][] = [
      ["GET", `/v1/staff/consultations/${id}`],
      ["PUT", `/v1/staff/consultations/${id}/soap`, soap],
      ["GET", `/v1/staff/consultations/${id}/skin`],
      ["PUT", `/v1/staff/consultations/${id}/skin`, { scores: {}, notes: "" }],
      ["GET", `/v1/staff/photos/${photoId}/url`],
      ["PUT", `/v1/staff/photos/${photoId}/annotations`, { annotations: [] }],
      ["GET", `/v1/staff/consultations/${id}/audit`],
    ];
    for (const [m, url, body] of reqs) {
      expect((await call(m as "GET", url, pt, body)).statusCode, `${m} ${url} pasien`).toBe(403);
      expect((await call(m as "GET", url, null, body)).statusCode, `${m} ${url} anon`).toBe(401);
    }
    expect((await upload(id, pt, JPG)).statusCode).toBe(403);
  });

  it("admin klinik: audit boleh, SOAP/skin ditolak; staf klinik lain 404", async () => {
    const { st, id } = await setup("adm@contoh.test");
    await call("PUT", `/v1/staff/consultations/${id}/soap`, st, { subjective: "s", objective: "", assessment: "", plan: "" });
    const admin = await staff("admin@drmetz.test");
    expect((await call("GET", `/v1/staff/consultations/${id}/audit`, admin)).statusCode).toBe(200);
    expect((await call("GET", `/v1/staff/consultations/${id}`, admin)).statusCode).toBe(403);
    const other = await staff("admin@demo-partner.test");
    expect((await call("GET", `/v1/staff/consultations/${id}/audit`, other)).statusCode).toBe(404);
  });
});
