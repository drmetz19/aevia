import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { LEAD_STAGES, LEAD_STAGE_INFO, normalizePhone } from "@aevia/core";
import { createDb, events, seed, type Db } from "@aevia/db";
import type { MailMessage } from "../auth/otp-sender";
import { buildApp } from "../../app";
import { minimalPayload } from "../integrations/dispatcher";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date("2026-10-04T10:00:00Z");
const tick = (min = 1) => (clock = new Date(clock.getTime() + min * 60_000));
const sent: { email: string; code: string }[] = [];
const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;

// PGlite (WASM) bisa lambat dimulai di mesin CI kecil.
beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({ db, jwtSecret: "test-secret-test-secret-test-secret-123", now: () => clock, anthropicApiKey: "", encryptionKey: new Uint8Array(32).fill(3), otpSender: { send: async (m: MailMessage) => void (m.code && sent.push({ email: m.email, code: m.code })) } });
}, 300_000);
afterAll(async () => {
  await app?.close();
  await db?.close();
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;

async function staffToken(email: string) {
  await app.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await app.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
}
async function patient(slug: string, email: string) {
  await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  const r = (await app.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json();
  const me = (await app.inject({ method: "GET", url: `/v1/clinics/${slug}/me`, headers: { authorization: `Bearer ${r.token}` } })).json();
  return { token: r.token as string, id: me.id as string };
}
const stagesOf = async (key: string, id: string) => (await call("GET", `/v1/integrations/contacts/${id}/stages`, key)).json().history.map((h: { to_stage: string }) => h.to_stage);

let adminA: string;
let pro: string;
let crmA: string; // read+write contacts, klinik drmetz
let crmB: string; // klinik demo-partner
let readOnly: string;
let clinicA: string;

beforeAll(async () => {
  adminA = await staffToken("admin@drmetz.test");
  pro = await staffToken("dr.metz@drmetz.test");
  const adminB = await staffToken("admin@demo-partner.test");
  crmA = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "CRM", scopes: ["read:contacts", "write:contacts"] })).json().secret;
  crmB = (await call("POST", "/v1/staff/integrations/api-keys", adminB, { name: "CRM B", scopes: ["read:contacts", "write:contacts"] })).json().secret;
  readOnly = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "Laporan", scopes: ["read:contacts"] })).json().secret;
  const me = (await call("GET", "/v1/integrations/me", crmA)).json();
  expect(me).toMatchObject({ clinic_slug: "drmetz", clinic_name: expect.any(String) });
  clinicA = me.clinic_id;
}, 300_000);

describe("normalisasi telepon", () => {
  it("format lokal/internasional → 62…; sampah → null", () => {
    expect(normalizePhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizePhone("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizePhone("812 3456 7890")).toBe("6281234567890");
    expect(normalizePhone("+65 9123 4567")).toBe("6591234567");
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("katalog fase & cakupan", () => {
  it("katalog fase sama urutannya dengan fungsi SQL; kredensial apa pun boleh membaca", async () => {
    const r = await call("GET", "/v1/integrations/lead-stages", readOnly);
    expect(r.statusCode).toBe(200);
    expect(r.json().stages.map((s: { stage: string }) => s.stage)).toEqual([...LEAD_STAGES]);
    for (const s of LEAD_STAGES) {
      const [x] = await rows<{ r: number }>(sql`SELECT aevia_lead_stage_rank(${s}) AS r`);
      expect(x!.r, s).toBe(LEAD_STAGE_INFO[s].rank);
    }
  });

  it("tanpa read/write:contacts → 403; token staf/tanpa kredensial → 401", async () => {
    const other = (await call("POST", "/v1/staff/integrations/api-keys", adminA, { name: "ERP", scopes: ["read:patients"] })).json().secret;
    expect((await call("GET", "/v1/integrations/contacts", other)).json().error).toBe("insufficient_scope");
    expect((await call("POST", "/v1/integrations/contacts", readOnly, { phone: "081200000001" })).statusCode).toBe(403);
    expect((await call("GET", "/v1/integrations/contacts", adminA)).statusCode).toBe(401);
    expect((await call("GET", "/v1/integrations/contacts", null)).statusCode).toBe(401);
  });
});

describe("kontak: upsert, ubah, hapus", () => {
  it("buat lead baru (201), upsert ulang via external_ref (200), riwayat + event + audit tercatat", async () => {
    const body = { name: "Rina", phone: "0812-1111-2222", source: "ads", utm: { source: "meta", campaign: "anti-aging-okt" }, tags: ["vip", "vip"], external_source: "konektor", external_ref: "L-001" };
    const r = await call("POST", "/v1/integrations/contacts", crmA, body);
    expect(r.statusCode).toBe(201);
    const c = r.json().contact;
    expect(c).toMatchObject({ clinic_id: clinicA, name: "Rina", phone: "6281211112222", email: null, source: "ads", stage: "new", stage_label: "Lead baru", sales_phase: "lead", patient_id: null, tags: ["vip"], utm: { source: "meta", campaign: "anti-aging-okt" } });

    tick();
    const again = await call("POST", "/v1/integrations/contacts", crmA, { external_source: "konektor", external_ref: "L-001", email: "Rina@Contoh.test", value_idr: 3_500_000 });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, contact: { id: c.id, email: "rina@contoh.test", value_idr: 3_500_000, phone: "6281211112222", stage: "new" } });
    expect(await stagesOf(crmA, c.id)).toEqual(["new"]);
    const ev = await rows<{ type: string }>(sql`SELECT type FROM events WHERE payload->>'contact_id' = ${c.id} ORDER BY created_at`);
    expect(ev.map((e) => e.type)).toEqual(["contact.created", "contact.updated"]);
    const au = await rows<{ action: string; after: { via: string } }>(sql`SELECT action, after FROM audit_logs WHERE entity_id = ${c.id} ORDER BY at, id`);
    expect(au.map((a) => a.action).filter((x) => !x.includes(".read")).sort()).toEqual(["integration.contact.create", "integration.contact.update"]);
    expect(au.every((a) => a.after.via.startsWith("api:aev_live_"))).toBe(true);
    expect(JSON.stringify(au)).not.toContain("rina@contoh.test");
  });

  it("validasi: tanpa email & telepon 400; telepon tidak masuk akal 400; lost tanpa alasan 400; email milik kontak lain 409", async () => {
    expect((await call("POST", "/v1/integrations/contacts", crmA, { name: "X" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/integrations/contacts", crmA, { phone: "12" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/integrations/contacts", crmA, { phone: "081299990000", external_ref: "tanpa-sumber" })).statusCode).toBe(400);
    const a = (await call("POST", "/v1/integrations/contacts", crmA, { email: "dua@contoh.test" })).json().contact;
    const b = (await call("POST", "/v1/integrations/contacts", crmA, { email: "tiga@contoh.test" })).json().contact;
    const clash = await call("PATCH", `/v1/integrations/contacts/${b.id}`, crmA, { email: "dua@contoh.test" });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: "contact_conflict", details: { contact_id: a.id } });
    expect((await call("POST", `/v1/integrations/contacts/${a.id}/stage`, crmA, { stage: "lost" })).statusCode).toBe(400);
    expect((await call("POST", `/v1/integrations/contacts/${a.id}/stage`, crmA, { stage: "dibatalkan" })).statusCode).toBe(400);
  });

  it("PATCH hanya kolom yang dikirim; null mengosongkan; penanggung jawab harus staf klinik ini", async () => {
    const c = (await call("POST", "/v1/integrations/contacts", crmA, { email: "patch@contoh.test", phone: "081277778888", notes: "awal" })).json().contact;
    const staffId = (await call("GET", "/v1/staff/me", pro)).json().id as string;
    const r = await call("PATCH", `/v1/integrations/contacts/${c.id}`, crmA, { phone: null, owner_staff_id: staffId, tags: ["follow-up"] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ email: "patch@contoh.test", phone: null, notes: "awal", owner_staff_id: staffId, tags: ["follow-up"] });
    expect((await call("PATCH", `/v1/integrations/contacts/${c.id}`, crmA, { owner_staff_id: "00000000-0000-4000-8000-000000000000" })).json().error).toBe("owner_not_found");
    expect((await call("PATCH", `/v1/integrations/contacts/${c.id}`, crmA, {})).statusCode).toBe(400);
  });

  it("isolasi tenant: kunci klinik lain tak melihat, mengubah, atau menghapus kontak", async () => {
    const c = (await call("POST", "/v1/integrations/contacts", crmA, { email: "rahasia@contoh.test" })).json().contact;
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmB)).statusCode).toBe(404);
    expect((await call("PATCH", `/v1/integrations/contacts/${c.id}`, crmB, { name: "X" })).statusCode).toBe(404);
    expect((await call("POST", `/v1/integrations/contacts/${c.id}/stage`, crmB, { stage: "contacted" })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/integrations/contacts/${c.id}`, crmB)).statusCode).toBe(404);
    const listB = (await call("GET", "/v1/integrations/contacts?limit=200", crmB)).json();
    expect(JSON.stringify(listB)).not.toContain("rahasia@contoh.test");
    // email sama boleh di klinik lain (akun terpisah per klinik)
    expect((await call("POST", "/v1/integrations/contacts", crmB, { email: "rahasia@contoh.test" })).statusCode).toBe(201);
  });
});

describe("fase lead mengikuti perjalanan pasien", () => {
  it("lead CRM → contacted (manual) → daftar → minta konsultasi → dijadwalkan → konsultasi selesai → rencana ditandatangani = won", async () => {
    const email = "funnel@contoh.test";
    const c = (await call("POST", "/v1/integrations/contacts", crmA, { email, name: "Dewi", source: "whatsapp" })).json().contact;
    tick();
    const moved = await call("POST", `/v1/integrations/contacts/${c.id}/stage`, crmA, { stage: "contacted", reason: "Dihubungi via WA" });
    expect(moved.json()).toMatchObject({ stage: "contacted", sales_phase: "contacted" });

    tick();
    const pt = await patient("drmetz", email);
    let cur = (await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json();
    expect(cur).toMatchObject({ patient_id: pt.id, stage: "registered", name: "Dewi", source: "whatsapp" });

    tick();
    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const req = (await call("POST", "/v1/consultation-requests", pt.token, { program_id: programs[0].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json().stage).toBe("consultation_requested");

    tick();
    const acc = (await call("POST", `/v1/staff/consultation-requests/${req.id}/accept`, pro, { scheduled_at: "2026-10-20T02:00:00.000Z", meeting_url: "https://meet.google.com/a-b-c" })).json();
    const consultationId = acc.consultation.id as string;
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json().stage).toBe("consultation_scheduled");

    tick();
    // status kunjungan dari KlinikSistem (no_show tidak memajukan; completed → consulted)
    await db.ownerTx(clinicA, (tx) => tx.insert(events).values({ clinicId: clinicA, type: "consultation.status_changed", payload: { consultation_id: consultationId, patient_id: pt.id, status: "no_show" }, createdAt: clock }));
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json().stage).toBe("consultation_scheduled");
    await db.ownerTx(clinicA, (tx) => tx.insert(events).values({ clinicId: clinicA, type: "consultation.status_changed", payload: { consultation_id: consultationId, patient_id: pt.id, status: "completed" }, createdAt: clock }));
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json().stage).toBe("consulted");

    tick();
    const draft = (
      await app.inject({
        method: "PUT",
        url: `/v1/staff/consultations/${consultationId}/care-plans`,
        headers: { authorization: `Bearer ${pro}` },
        payload: {
          content: { focus: ["Tidur"], next_steps: ["Rutinitas malam"], monitor: [{ metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" }], review_at: "2026-11-15" },
          summary: { discussed: "Pola tidur.", priorities: ["Tidur"] },
        },
      })
    ).json();
    expect((await call("POST", `/v1/staff/care-plans/${draft.id}/sign`, pro, { confirm: true })).statusCode).toBe(200);
    cur = (await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json();
    expect(cur).toMatchObject({ stage: "won", sales_phase: "closed_won", stage_label: "Program berjalan" });

    expect(await stagesOf(crmA, c.id)).toEqual(["new", "contacted", "registered", "consultation_requested", "consultation_scheduled", "consulted", "won"]);
    const hist = (await call("GET", `/v1/integrations/contacts/${c.id}/stages`, readOnly)).json().history;
    expect(hist.map((h: { mode: string }) => h.mode)).toEqual(["manual", "manual", "auto", "auto", "auto", "auto", "auto"]);
    expect(hist[1].reason).toBe("Dihubungi via WA");
    expect(hist.at(-1).trigger).toBe("plan.approved");

    // webhook contact.stage_changed: payload minimal (tanpa email/nama)
    const [last] = await rows<{ payload: Record<string, unknown> }>(sql`SELECT payload FROM events WHERE type = 'contact.stage_changed' AND payload->>'contact_id' = ${c.id} ORDER BY created_at DESC LIMIT 1`);
    expect(minimalPayload(last!.payload)).toEqual({ contact_id: c.id, patient_id: pt.id, stage: "won", previous_stage: "consulted", mode: "auto" });

    // otomatis tidak pernah mundur
    tick();
    await db.ownerTx(clinicA, (tx) => tx.insert(events).values({ clinicId: clinicA, type: "assessment.completed", payload: { assessment_id: crypto.randomUUID(), patient_id: pt.id }, createdAt: clock }));
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json().stage).toBe("won");

    // lost (manual) → aktivitas pasien membuka kembali ke fase tertinggi yang terbukti
    tick();
    const lost = (await call("POST", `/v1/integrations/contacts/${c.id}/stage`, crmA, { stage: "lost", lost_reason: "Pindah kota" })).json();
    expect(lost).toMatchObject({ stage: "lost", lost_reason: "Pindah kota", sales_phase: "closed_lost" });
    tick();
    await db.ownerTx(clinicA, (tx) => tx.insert(events).values({ clinicId: clinicA, type: "assessment.completed", payload: { assessment_id: crypto.randomUUID(), patient_id: pt.id }, createdAt: clock }));
    expect((await call("GET", `/v1/integrations/contacts/${c.id}`, crmA)).json()).toMatchObject({ stage: "won", lost_reason: null });

    // kontak tertaut pasien tidak dapat dihapus
    expect((await call("DELETE", `/v1/integrations/contacts/${c.id}`, crmA)).json().error).toBe("contact_linked");
  });

  it("pasien yang daftar sendiri (tanpa CRM) otomatis jadi kontak sumber aevia, fase registered", async () => {
    const pt = await patient("drmetz", "mandiri@contoh.test");
    const list = (await call("GET", "/v1/integrations/contacts?q=mandiri", crmA)).json().contacts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ patient_id: pt.id, email: "mandiri@contoh.test", source: "aevia", stage: "registered" });
    const ev = await rows<{ type: string }>(sql`SELECT type FROM events WHERE type = 'contact.created' AND payload->>'patient_id' = ${pt.id}`);
    expect(ev).toHaveLength(1);
    // CRM kemudian upsert email yang sama → kontak yang sama diperkaya, fase tetap
    const up = await call("POST", "/v1/integrations/contacts", crmA, { email: "mandiri@contoh.test", phone: "081355556666", external_source: "konektor", external_ref: "L-777" });
    expect(up.statusCode).toBe(200);
    expect(up.json().contact).toMatchObject({ id: list[0].id, stage: "registered", phone: "6281355556666", external_ref: "L-777" });
  });

  it("pasien tanpa kontak (mis. data lama) dibuatkan kontak dengan fase dari data saat event berikutnya", async () => {
    const pt = await patient("drmetz", "lama@contoh.test");
    await db.ownerTx(clinicA, (tx) => tx.execute(sql`DELETE FROM contacts WHERE patient_id = ${pt.id}`));
    const programs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    await call("POST", "/v1/consultation-requests", pt.token, { program_id: programs[0].id, prep: { tujuan: "t", keluhan: "", pertanyaan: [], konteks_assessment: "" } });
    const [c] = (await call("GET", "/v1/integrations/contacts?q=lama%40contoh", crmA)).json().contacts;
    expect(c).toMatchObject({ patient_id: pt.id, stage: "consultation_requested" });
  });
});

describe("daftar, sinkron, funnel", () => {
  it("cursor + updated_since untuk sinkron inkremental; filter fase/sumber/tag", async () => {
    tick(60);
    const since = clock.toISOString();
    const made: string[] = [];
    for (const n of [1, 2, 3]) {
      tick();
      made.push((await call("POST", "/v1/integrations/contacts", crmA, { phone: `08139000000${n}`, source: "event", tags: n === 2 ? ["seminar"] : [] })).json().contact.id);
    }
    const p1 = (await call("GET", `/v1/integrations/contacts?updated_since=${encodeURIComponent(since)}&limit=2`, crmA)).json();
    expect(p1.contacts.map((c: { id: string }) => c.id)).toEqual(made.slice(0, 2));
    expect(p1.next_cursor).toBeTruthy();
    const p2 = (await call("GET", `/v1/integrations/contacts?updated_since=${encodeURIComponent(since)}&limit=2&cursor=${p1.next_cursor}`, crmA)).json();
    expect(p2.contacts.map((c: { id: string }) => c.id)).toEqual(made.slice(2));
    expect(p2.next_cursor).toBeNull();
    expect((await call("GET", "/v1/integrations/contacts?cursor=rusak", crmA)).json().error).toBe("bad_cursor");

    const bySource = (await call("GET", "/v1/integrations/contacts?source=event&tag=seminar", crmA)).json().contacts;
    expect(bySource.map((c: { id: string }) => c.id)).toEqual([made[1]]);
    const byStage = (await call("GET", "/v1/integrations/contacts?stage=won,lost&limit=200", crmA)).json().contacts;
    expect(byStage.every((c: { stage: string }) => ["won", "lost"].includes(c.stage))).toBe(true);
    expect((await call("GET", "/v1/integrations/contacts?stage=salah", crmA)).statusCode).toBe(400);

    // hapus lead mentah (belum punya akun pasien)
    expect((await call("DELETE", `/v1/integrations/contacts/${made[0]}`, crmA)).statusCode).toBe(200);
    expect((await call("GET", `/v1/integrations/contacts/${made[0]}`, crmA)).statusCode).toBe(404);
  });

  it("funnel kohort: current, reached (fase tertinggi yang pernah dicapai), konversi", async () => {
    const from = new Date(clock.getTime() + 60_000).toISOString();
    tick(5);
    const mk = async (phone: string) => (await call("POST", "/v1/integrations/contacts", crmA, { phone })).json().contact.id as string;
    const a = await mk("081411110001");
    const b = await mk("081411110002");
    await mk("081411110003");
    await call("POST", `/v1/integrations/contacts/${a}/stage`, crmA, { stage: "contacted" });
    await call("POST", `/v1/integrations/contacts/${b}/stage`, crmA, { stage: "contacted" });
    await call("POST", `/v1/integrations/contacts/${b}/stage`, crmA, { stage: "lost", lost_reason: "Belum tertarik" });
    const f = (await call("GET", `/v1/integrations/funnel?from=${encodeURIComponent(from)}`, readOnly)).json();
    expect(f.total).toBe(3);
    expect(f.lost).toBe(1);
    const st = Object.fromEntries(f.stages.map((s: { stage: string }) => [s.stage, s]));
    expect(st.new).toMatchObject({ current: 1, reached: 3, conversion_pct: null });
    expect(st.contacted).toMatchObject({ current: 1, reached: 2, conversion_pct: 66.7 });
    expect(st.registered).toMatchObject({ current: 0, reached: 0, conversion_pct: 0 });
    expect(f.stages.map((s: { stage: string }) => s.stage)).not.toContain("lost");
  });
});
