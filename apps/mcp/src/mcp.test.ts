import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../api/src/app";
import { createLocalStorage } from "../../api/src/storage";
import { AeviaClient } from "./client";
import { handleMcpRequest } from "./handler";
import { TOOL_NAMES, createMcpServer } from "./tools";

type App = Awaited<ReturnType<typeof buildApp>>;
let db: Db;
let app: App;
const clock = new Date("2026-10-04T10:00:00Z");
const sent: { email: string; code: string }[] = [];
const SECRET = "test-secret-test-secret-test-secret-123";
const API = "http://api.test";

/** Menjembatani fetch klien MCP → Fastify in-process (tanpa jaringan). */
const bridge = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  const r = await app.inject({ method: init.method as "GET", url: url.replace(API, ""), headers: init.headers, payload: init.body });
  return new Response(r.body, { status: r.statusCode, headers: r.headers as Record<string, string> });
}) as unknown as typeof fetch;

const code = (e: string) => [...sent].reverse().find((m) => m.email === e)!.code;
const post = (url: string, token: string | null, payload?: object) => app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const staff = async (email: string) => {
  await post("/v1/staff/auth/otp", null, { email });
  return (await post("/v1/staff/auth/verify", null, { email, code: code(email) })).json().token as string;
};
async function patient(slug: string, email: string) {
  await post(`/v1/clinics/${slug}/auth/otp`, null, { email });
  const t = (await post(`/v1/clinics/${slug}/auth/verify`, null, { email, code: code(email) })).json().token as string;
  const me = (await app.inject({ url: `/v1/clinics/${slug}/me`, headers: { authorization: `Bearer ${t}` } })).json();
  return { token: t, id: me.id as string };
}
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.db.execute(q)) as unknown as { rows: T[] }).rows;
const ALL = ["read:patients", "read:progress", "read:plans", "write:reminders", "write:consultation_requests"];
const mkKey = async (adminToken: string, scopes: string[], name = "MCP") => (await post("/v1/staff/integrations/api-keys", adminToken, { name, scopes })).json() as { id: string; secret: string; prefix: string };

async function connect(key: string) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(new AeviaClient({ apiUrl: API, apiKey: key, fetchFn: bridge }));
  await server.connect(st);
  const client = new Client({ name: "uji", version: "1.0.0" });
  await client.connect(ct);
  return client;
}
const textOf = (r: object) => (((r as { content: unknown }).content as { type: string; text: string }[])[0] as { text: string }).text;

let adminA: string;
let adminB: string;
let patA: { token: string; id: string };
let patB: { token: string; id: string };
let keyA: { id: string; secret: string; prefix: string };
let keyB: { id: string; secret: string; prefix: string };

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  const storage = createLocalStorage({ dir: mkdtempSync(join(tmpdir(), "aevia-mcp-")), secret: new TextEncoder().encode(SECRET) });
  app = await buildApp({ db, jwtSecret: SECRET, now: () => clock, storage, anthropicApiKey: "", encryptionKey: new Uint8Array(32).fill(3), otpSender: { send: async ({ email, code }: { email: string; code: string }) => void sent.push({ email, code }) } });
  adminA = await staff("admin@drmetz.test");
  adminB = await staff("admin@demo-partner.test");
  patA = await patient("drmetz", "mcp-a@contoh.test");
  patB = await patient("demo-partner", "mcp-b@contoh.test");
  keyA = await mkKey(adminA, ALL);
  keyB = await mkKey(adminB, ALL);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("daftar tool", () => {
  it("klien in-memory melihat TEPAT 6 tool, tanpa tool SOAP/resep/rencana-tulis; skema input + deskripsi ada", async () => {
    const c = await connect(keyA.secret);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name).filter((n) => /soap|prescri|resep|sign|plan/i.test(n))).toEqual(["get_care_plan"]);
    for (const t of tools) {
      expect(t.description!.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect((t.inputSchema as { properties: object }).properties).toHaveProperty("patient_id");
      expect(t.outputSchema, t.name).toBeTruthy();
    }
    const ro = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    expect(ro).toMatchObject({ get_patient_summary: true, list_checkins: true, get_progress: true, get_care_plan: true, send_checkin_reminder: false, create_consultation_request: false });
    await c.close();
  });

  it("input tidak valid ditolak oleh skema zod (bukan UUID)", async () => {
    const c = await connect(keyA.secret);
    const r = await c.callTool({ name: "get_patient_summary", arguments: { patient_id: "bukan-uuid" } });
    expect(r.isError).toBe(true);
    await c.close();
  });
});

describe("isolasi klinik & consent", () => {
  it("key klinik A tidak bisa membaca atau menulis untuk pasien klinik B", async () => {
    const c = await connect(keyA.secret);
    for (const name of ["get_patient_summary", "list_checkins", "get_progress", "get_care_plan", "send_checkin_reminder"]) {
      const r = await c.callTool({ name, arguments: { patient_id: patB.id } });
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toMatch(/belum ditemukan di klinik Anda/);
      expect(JSON.stringify(r)).not.toContain("mcp-b@contoh.test");
    }
    const progs = (await app.inject("/v1/clinics/demo-partner/programs")).json().programs;
    const w = await c.callTool({ name: "create_consultation_request", arguments: { patient_id: patB.id, program_id: progs[0].id } });
    expect(w.isError).toBe(true);
    // B melihat pasiennya sendiri
    const cb = await connect(keyB.secret);
    const ok = await cb.callTool({ name: "get_patient_summary", arguments: { patient_id: patB.id } });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { patient: { id: string } }).patient.id).toBe(patB.id);
    await c.close();
    await cb.close();
  });

  it("data klinis butuh persetujuan rekam medis pasien; setelah diberikan terbaca", async () => {
    const c = await connect(keyA.secret);
    const s0 = await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } });
    expect(s0.isError).toBeFalsy();
    expect((s0.structuredContent as { clinical_visible: boolean }).clinical_visible).toBe(false);
    expect(textOf(s0)).toMatch(/persetujuan akses rekam medis/);
    const blocked = await c.callTool({ name: "get_progress", arguments: { patient_id: patA.id } });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toMatch(/persetujuan akses rekam medis/);

    await app.inject({ method: "PUT", url: "/v1/me/consents", payload: { scope: "medical_record", granted: true }, headers: { authorization: `Bearer ${patA.token}` } });
    const s1 = await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } });
    expect((s1.structuredContent as { clinical_visible: boolean }).clinical_visible).toBe(true);
    const ck = await c.callTool({ name: "list_checkins", arguments: { patient_id: patA.id, limit: 5 } });
    expect(ck.structuredContent).toEqual({ checkins: [] });
    expect(textOf(ck)).toBe("Belum ada check-in.");
    const pr = await c.callTool({ name: "get_progress", arguments: { patient_id: patA.id } });
    expect(pr.isError).toBeFalsy();
    expect(pr.structuredContent).toHaveProperty("metrics");
    const cp = await c.callTool({ name: "get_care_plan", arguments: { patient_id: patA.id } });
    expect(cp.structuredContent).toEqual({ plan: null });
    expect(textOf(cp)).toMatch(/Belum ada rencana/);
    await c.close();
  });

  it("cakupan terbatas: tool tanpa cakupan menjawab galat jelas (dan tetap diaudit)", async () => {
    const only = await mkKey(adminA, ["read:patients"], "Terbatas");
    const c = await connect(only.secret);
    expect((await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } })).isError).toBeFalsy();
    const r = await c.callTool({ name: "send_checkin_reminder", arguments: { patient_id: patA.id } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/write:reminders/);
    const a = await rows<{ actor_type: string; action: string }>(sql`SELECT actor_type, action FROM audit_logs WHERE actor_id = ${only.id} ORDER BY at, id`);
    expect(a.map((x) => `${x.actor_type}:${x.action}`).sort()).toEqual(["mcp:integration.denied", "mcp:integration.read.summary"]);
    await c.close();
  });

  it("kunci tidak valid / dicabut → galat, tanpa data", async () => {
    const bad = await connect("aev_live_tidak_valid");
    const r = await bad.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/tidak valid atau sudah dicabut/);
    await bad.close();
    const k = await mkKey(adminA, ["read:patients"], "Akan dicabut");
    await app.inject({ method: "DELETE", url: `/v1/staff/integrations/api-keys/${k.id}`, headers: { authorization: `Bearer ${adminA}` } });
    const c = await connect(k.secret);
    expect((await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } })).isError).toBe(true);
    await c.close();
  });
});

describe("tulis terbatas + audit actor=mcp", () => {
  it("pengingat dan permintaan konsultasi dibuat; pasien melihatnya", async () => {
    const c = await connect(keyA.secret);
    const rem = await c.callTool({ name: "send_checkin_reminder", arguments: { patient_id: patA.id } });
    expect(rem.isError).toBeFalsy();
    const remId = (rem.structuredContent as { id: string }).id;
    const mine = (await app.inject({ url: "/v1/reminders", headers: { authorization: `Bearer ${patA.token}` } })).json();
    expect(mine.reminders.some((x: { id: string }) => x.id === remId)).toBe(true);

    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const rq = await c.callTool({ name: "create_consultation_request", arguments: { patient_id: patA.id, program_id: progs[0].id, tujuan: "Tidur lebih baik", pertanyaan: ["Apa langkah pertama?"] } });
    expect(rq.isError).toBeFalsy();
    expect((rq.structuredContent as { status: string }).status).toBe("submitted");
    const dup = await c.callTool({ name: "create_consultation_request", arguments: { patient_id: patA.id, program_id: progs[0].id } });
    expect(dup.isError).toBe(true);
    expect(textOf(dup)).toMatch(/sudah kami terima/);
    await c.close();
  });

  it("setiap panggilan tool menghasilkan baris audit_logs: actor_type=mcp, actor_id=kunci, via=mcp:<prefix>", async () => {
    const k = await mkKey(adminA, ALL, "Audit");
    const c = await connect(k.secret);
    const progs = (await app.inject("/v1/clinics/drmetz/programs")).json().programs;
    const pat2 = await patient("drmetz", "mcp-a2@contoh.test");
    await app.inject({ method: "PUT", url: "/v1/me/consents", payload: { scope: "medical_record", granted: true }, headers: { authorization: `Bearer ${pat2.token}` } });
    const calls: [string, Record<string, unknown>][] = [
      ["get_patient_summary", { patient_id: pat2.id }],
      ["list_checkins", { patient_id: pat2.id }],
      ["get_progress", { patient_id: pat2.id }],
      ["get_care_plan", { patient_id: pat2.id }],
      ["send_checkin_reminder", { patient_id: pat2.id }],
      ["create_consultation_request", { patient_id: pat2.id, program_id: progs[1].id }],
    ];
    for (const [name, args] of calls) expect((await c.callTool({ name, arguments: args })).isError, name).toBeFalsy();
    const a = await rows<{ actor_type: string; action: string; after: { via: string } }>(sql`SELECT actor_type, action, after FROM audit_logs WHERE actor_id = ${k.id} ORDER BY at, id`);
    expect(a.map((x) => x.action).sort()).toEqual(
      ["integration.consultation_request.create", "integration.read.care_plan", "integration.read.checkins", "integration.read.progress", "integration.read.summary", "integration.reminder.create"].sort(),
    );
    for (const x of a) {
      expect(x.actor_type).toBe("mcp");
      expect(x.after.via).toBe(`mcp:${k.prefix}`);
    }
    expect(k.prefix).toMatch(/^aev_live_/);
    await c.close();
  });

  it("panggilan REST biasa (tanpa header MCP) tetap tercatat sebagai actor_type=api", async () => {
    const r = await app.inject({ url: `/v1/integrations/patients/${patA.id}/summary`, headers: { authorization: `Bearer ${keyA.secret}` } });
    expect(r.statusCode).toBe(200);
    const a = await rows<{ actor_type: string; after: { via: string } }>(sql`SELECT actor_type, after FROM audit_logs WHERE actor_id = ${keyA.id} AND action = 'integration.read.summary' ORDER BY at DESC, id DESC LIMIT 50`);
    expect(a.some((x) => x.actor_type === "api" && x.after.via === `api:${keyA.prefix}`)).toBe(true);
  });
});

describe("Streamable HTTP", () => {
  const handler = (req: Request) => handleMcpRequest(req, { apiUrl: API, fetchFn: bridge });

  it("tanpa Authorization → 401; metode selain POST → 405", async () => {
    const r = await handler(new Request("http://mcp.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
    const g = await handler(new Request("http://mcp.test/mcp", { method: "GET", headers: { authorization: `Bearer ${keyA.secret}` } }));
    expect(g.status).toBe(405);
  });

  it("klien MCP resmi via Streamable HTTP: 6 tool, kunci diteruskan, pasien klinik lain ditolak, audit mcp", async () => {
    const t = new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${keyA.secret}` } },
      fetch: ((url: string | URL, init?: RequestInit) => handler(new Request(url, init))) as typeof fetch,
    });
    const c = new Client({ name: "uji-http", version: "1.0.0" });
    await c.connect(t);
    expect((await c.listTools()).tools).toHaveLength(6);
    const own = await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patA.id } });
    expect(own.isError).toBeFalsy();
    const other = await c.callTool({ name: "get_patient_summary", arguments: { patient_id: patB.id } });
    expect(other.isError).toBe(true);
    const a = await rows<{ actor_type: string }>(sql`SELECT actor_type FROM audit_logs WHERE actor_id = ${keyA.id} AND action = 'integration.read.summary' AND after->>'via' LIKE 'mcp:%'`);
    expect(a.length).toBeGreaterThan(0);
    await c.close();
  });
});
