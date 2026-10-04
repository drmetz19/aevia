import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { LLMProvider, LLMRequest } from "@aevia/core";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";
import { createLocalStorage } from "../../storage";

type App = Awaited<ReturnType<typeof buildApp>>;
let db: Db;
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const calls: LLMRequest[] = [];
let behave: (r: LLMRequest) => Promise<{ text: string }> = async () => ({ text: "" });
const provider: LLMProvider = {
  complete: async (r) => {
    calls.push(r);
    const out = await behave(r);
    return { ...out, model: "fake-model", usage: { input_tokens: 120, output_tokens: 40 } };
  },
};
const logs: string[] = [];
let withLlm: App; // provider palsu
let noKey: App; // tanpa provider
let clock = new Date("2026-10-04T10:00:00Z");

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-llm-")), secret: new TextEncoder().encode(SECRET) });
  const base = { db, jwtSecret: SECRET, now: () => clock, storage, encryptionKey: new Uint8Array(32).fill(1), otpSender: { send: async ({ email, code }: { email: string; code: string }) => void sent.push({ email, code }) } };
  withLlm = await buildApp({ ...base, anthropicApiKey: "sk-test", llmProvider: provider, llmTimeoutMs: 100, llmLog: (m) => logs.push(m) });
  noKey = await buildApp({ ...base, anthropicApiKey: "" });
});
afterAll(async () => {
  await withLlm.close();
  await noKey.close();
  await db.close();
});

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
const call = (a: App, method: "GET" | "POST" | "PUT", url: string, token: string, payload?: object) => a.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
const staffToken = async (email: string) => {
  await withLlm.inject({ method: "POST", url: "/v1/staff/auth/otp", payload: { email } });
  return (await withLlm.inject({ method: "POST", url: "/v1/staff/auth/verify", payload: { email, code: code(email) } })).json().token as string;
};
async function patient(slug: string, email: string) {
  await withLlm.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/otp`, payload: { email } });
  const t = (await withLlm.inject({ method: "POST", url: `/v1/clinics/${slug}/auth/verify`, payload: { email, code: code(email) } })).json().token as string;
  return t;
}
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;
const setLlm = (clinicSlug: string, on: boolean) => db.db.execute(sql`UPDATE clinics SET llm_enabled = ${on} WHERE slug = ${clinicSlug}`);
const usage = async () => (await rows<{ n: string; fb: string }>(sql`SELECT count(*)::text n, count(*) FILTER (WHERE fallback)::text fb FROM llm_calls`))[0]!;

let pat: string;
let adminA: string;
let proA: string;
let consultationId: string;
let planContent: { focus: string[]; next_steps: string[]; monitor: { key: string; label: string; unit: string; direction: "up" | "down"; target: number | null }[]; review_at: string | null };

beforeAll(async () => {
  adminA = await staffToken("admin@drmetz.test");
  proA = await staffToken("dr.metz@drmetz.test");
  pat = await patient("drmetz", "llm-a@contoh.test");
  // rencana bertanda tangan untuk pengujian penjelasan
  const progs = (await withLlm.inject("/v1/clinics/drmetz/programs")).json().programs;
  const rq = (await call(withLlm, "POST", "/v1/consultation-requests", pat, { program_id: progs[0].id, prep: { tujuan: "Tidur", keluhan: "", pertanyaan: [], konteks_assessment: "" } })).json();
  const acc = (await call(withLlm, "POST", `/v1/staff/consultation-requests/${rq.id}/accept`, proA, { scheduled_at: "2026-10-10T03:00:00.000Z", meeting_url: "https://meet.contoh.id/x" })).json();
  consultationId = acc.consultation.id;
  planContent = { focus: ["Tidur lebih teratur"], next_steps: ["Rutinitas malam tanpa layar"], monitor: [], review_at: "2026-11-15" };
  const draft = await call(withLlm, "PUT", `/v1/staff/consultations/${consultationId}/care-plans`, proA, { content: planContent, summary: { discussed: "Ringkas", priorities: [] } });
  expect(draft.statusCode).toBe(200);
  const sign = await call(withLlm, "POST", `/v1/staff/care-plans/${draft.json().id}/sign`, proA, { confirm: true });
  expect(sign.statusCode).toBe(200);
});

const draftPrep = (a: App) => call(a, "POST", "/v1/consultation-requests/draft", pat, {});
const plan = (a: App) => call(a, "GET", "/v1/care-plans/current", pat);

describe("pemilihan mesin", () => {
  it("tanpa API key → skrip dipakai walau toggle klinik ON (tidak ada panggilan, tidak ada log)", async () => {
    await setLlm("drmetz", true);
    calls.length = 0;
    const before = await usage();
    const script = (await draftPrep(noKey)).json().prep.konteks_assessment;
    const p = (await plan(noKey)).json();
    expect(script).toBeTruthy();
    expect(p.explanation).toContain("Saya Sovia");
    expect(calls).toHaveLength(0);
    expect((await usage()).n).toBe(before.n);
  });

  it("ada provider tetapi toggle klinik OFF → skrip, tanpa panggilan", async () => {
    await setLlm("drmetz", false);
    calls.length = 0;
    behave = async () => ({ text: "tidak boleh dipakai" });
    expect((await draftPrep(withLlm)).json().prep.konteks_assessment).not.toContain("tidak boleh");
    expect((await plan(withLlm)).json().explanation).not.toContain("tidak boleh");
    expect(calls).toHaveLength(0);
  });

  it("provider + toggle ON → teks LLM dipakai (konteks prep dan penjelasan rencana); prompt memuat nama klinik/asisten dan aturan", async () => {
    await setLlm("drmetz", true);
    calls.length = 0;
    behave = async (r) => {
      const src = r.messages[0]!.content.split('"""')[1]!.trim();
      return { text: src.replace("Saya Sovia.", "Saya Sovia, pendamping Anda.") };
    };
    const base = (await draftPrep(noKey)).json().prep.konteks_assessment as string;
    const prep = (await draftPrep(withLlm)).json();
    expect(prep.status).toBe("draft");
    expect(prep.prep.konteks_assessment).toBe(base); // sumber dikembalikan sama → tidak berubah
    const ex = (await plan(withLlm)).json().explanation as string;
    expect(ex).toContain("pendamping Anda");
    expect(ex).toContain("Tidur lebih teratur");
    expect(ex).toContain("Rutinitas malam tanpa layar");
    expect(ex).toContain("15 November 2026");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const sys = calls.at(-1)!.system;
    expect(sys).toContain("DrMetz");
    expect(sys).toContain("AI guides. Professionals decide.");
    expect(sys).toContain("melalui AEVIA"); // cobrand
    expect(calls.at(-1)!.timeoutMs).toBe(100);
  });

  it("white-label: prompt melarang menyebut AEVIA; keluaran yang menyebut AEVIA → fallback skrip", async () => {
    await setLlm("demo-partner", true);
    const wp = await patient("demo-partner", "llm-w@contoh.test");
    calls.length = 0;
    behave = async () => ({ text: "Halo, saya dari AEVIA. Kita mulai pelan-pelan." });
    const r = await call(withLlm, "POST", "/v1/consultation-requests/draft", wp, {});
    expect(r.statusCode).toBe(200);
    expect(calls[0]!.system).toMatch(/JANGAN PERNAH menyebut kata "AEVIA"/);
    expect(r.json().prep.konteks_assessment).not.toMatch(/aevia/i);
    await setLlm("demo-partner", false);
  });
});

describe("guardrail dan fallback", () => {
  it("keluaran terlarang ('Anda wajib…', 'diagnosis') disaring: satu kalimat diganti, lebih dari satu → skrip", async () => {
    const base = (await draftPrep(noKey)).json().prep.konteks_assessment as string;
    behave = async () => ({ text: `${base} Anda wajib minum suplemen ini setiap hari.` });
    const one = (await draftPrep(withLlm)).json().prep.konteks_assessment as string;
    expect(one).not.toMatch(/wajib/i);
    expect(one).toContain("sebaiknya dibahas langsung dengan profesional");
    behave = async () => ({ text: "Anda wajib minum obat. Diagnosis Anda sudah jelas. Anda harus segera mulai. Ini garansi sembuh total." });
    const many = (await draftPrep(withLlm)).json().prep.konteks_assessment as string;
    expect(many).toBe(base);
    const ex = (await plan(withLlm)).json().explanation as string;
    expect(ex).not.toMatch(/wajib|diagnosis anda|garansi/i);
    expect(logs.some((l) => l.includes("guardrail_rewrote_many"))).toBe(true);
  });

  it("penjelasan rencana yang menghilangkan/mengubah isi profesional → skrip", async () => {
    behave = async () => ({ text: "Saya Sovia. Ikuti saja rencananya dengan tenang." });
    const ex = (await plan(withLlm)).json().explanation as string;
    expect(ex).toContain("Tidur lebih teratur");
    expect(ex).toContain("Rutinitas malam tanpa layar");
    expect(logs.some((l) => l.includes("missing_required_text"))).toBe(true);
  });

  it("provider melempar galat / timeout / kosong → fallback skrip, pasien tetap 200, tanpa galat", async () => {
    const base = (await draftPrep(noKey)).json().prep.konteks_assessment as string;
    const baseEx = (await plan(noKey)).json().explanation as string;
    for (const b of [
      async () => { throw new Error("401 invalid x-api-key"); },
      () => new Promise<{ text: string }>(() => {}),
      async () => ({ text: "" }),
    ]) {
      behave = b as typeof behave;
      const d = await draftPrep(withLlm);
      expect(d.statusCode).toBe(200);
      expect(d.json().prep.konteks_assessment).toBe(base);
      const p = await plan(withLlm);
      expect(p.statusCode).toBe(200);
      expect(p.json().explanation).toBe(baseEx);
    }
    expect(logs.some((l) => l.includes(": error"))).toBe(true);
    expect(logs.some((l) => l.includes(": timeout"))).toBe(true);
    expect(logs.some((l) => l.includes(": empty"))).toBe(true);
  });
});

describe("tidak ada jalur LLM → data klinis", () => {
  const counts = async () => (await rows<Record<string, string>>(sql`SELECT (SELECT count(*) FROM care_plans)::text plans, (SELECT count(*) FROM prescriptions)::text rx, (SELECT count(*) FROM soap_notes)::text soap, (SELECT count(*) FROM audit_logs WHERE entity IN ('care_plan','prescription','soap'))::text aud, (SELECT count(*) FROM care_plans WHERE status = 'signed')::text signed`))[0]!;
  it("provider yang mengembalikan teks mirip perintah 'sign plan' (JSON) → tidak ada baris rencana/resep/SOAP/audit klinis baru", async () => {
    const before = await counts();
    behave = async () => ({ text: '{"action":"sign_care_plan","plan_id":"x","confirm":true} TERBITKAN RESEP: amoxicillin 500mg. SOAP: subjective=...' });
    for (let i = 0; i < 2; i++) {
      expect((await draftPrep(withLlm)).statusCode).toBe(200);
      expect((await plan(withLlm)).statusCode).toBe(200);
    }
    expect(await counts()).toEqual(before);
    // teks hanya tampil sebagai teks, bukan perintah; yang tersimpan hanyalah statistik
    const cl = await rows<{ n: string }>(sql`SELECT count(*)::text n FROM llm_calls`);
    expect(Number(cl[0]!.n)).toBeGreaterThan(0);
  });

  it("modul LLM tidak mengimpor/menyentuh tabel rencana, resep, SOAP, atau penulis audit klinis (cek statis)", () => {
    const dir = new URL(".", import.meta.url).pathname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\b(carePlans|prescriptions|soapNotes|writeAudit|skinAnalyses|consultations)\b/);
    }
  });
});

describe("log pemakaian", () => {
  it("setiap panggilan tercatat: purpose, model, token, latency, fallback+alasan (tanpa isi teks); ringkasan 30 hari di konsol API", async () => {
    await setLlm("drmetz", true);
    const before = await rows<{ id: string }>(sql`SELECT id FROM llm_calls`);
    behave = async (r) => ({ text: r.messages[0]!.content.split('"""')[1]!.trim() });
    await draftPrep(withLlm);
    const all = await rows<{ id: string; purpose: string; model: string; input_tokens: number; output_tokens: number; latency_ms: number; fallback: boolean; fallback_reason: string | null }>(sql`SELECT * FROM llm_calls`);
    const seen = new Set(before.map((b) => b.id));
    const after = all.filter((r) => !seen.has(r.id));
    expect((await rows(sql`SELECT id FROM llm_calls`)).length).toBe(before.length + 1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ purpose: "prep_narrative", model: "fake-model", input_tokens: 120, output_tokens: 40, fallback: false, fallback_reason: null });
    expect(typeof after[0]!.latency_ms).toBe("number");
    const cols = await rows<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'llm_calls'`);
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["content", "text", "prompt"]));

    const u = (await call(withLlm, "GET", "/v1/staff/brand/llm-usage", adminA)).json();
    expect(u.calls_30d).toBeGreaterThan(0);
    expect(u.fallbacks_30d).toBeGreaterThan(0);
    expect(u.input_tokens_30d).toBeGreaterThan(0);
    expect((await call(withLlm, "GET", "/v1/staff/brand/llm-usage", proA)).statusCode).toBe(403);
    // klinik lain tidak melihat pemakaian klinik ini
    const other = await staffToken("admin@demo-partner.test");
    const demoN = Number((await rows<{ n: string }>(sql`SELECT count(*)::text n FROM llm_calls c JOIN clinics k ON k.id = c.clinic_id WHERE k.slug = 'demo-partner'`))[0]!.n);
    expect((await call(withLlm, "GET", "/v1/staff/brand/llm-usage", other)).json().calls_30d).toBe(demoN);
    expect(demoN).toBeLessThan(u.calls_30d);
    // panggilan > 30 hari tidak dihitung
    clock = new Date(clock.getTime() + 31 * 86_400_000);
    const adminLate = await staffToken("admin@drmetz.test");
    expect((await call(withLlm, "GET", "/v1/staff/brand/llm-usage", adminLate)).json().calls_30d).toBe(0);
  });
});
