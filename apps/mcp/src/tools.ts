import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { integrationCheckinsSchema, integrationPatientSummarySchema, integrationReminderSchema, integrationRequestSchema, patientPlanSchema, progressSchema } from "@aevia/core";
import { AeviaApiError, type AeviaClient } from "./client.js";

/**
 * Tepat 6 tool. Sengaja TIDAK ada tool untuk SOAP, resep, atau rencana pendampingan (tulis):
 * itu hanya boleh dibuat dan ditandatangani profesional klinik.
 */
export const TOOL_NAMES = ["get_patient_summary", "list_checkins", "get_progress", "get_care_plan", "send_checkin_reminder", "create_consultation_request"] as const;

const patientId = z.uuid().describe("ID pasien (UUID) di klinik pemilik kunci API / Patient ID (UUID) in the key's clinic.");

const ok = (text: string, structured: Record<string, unknown>): CallToolResult => ({ content: [{ type: "text", text }], structuredContent: structured });
const fail = (e: unknown): CallToolResult => {
  const msg =
    e instanceof AeviaApiError
      ? e.status === 403 && e.code === "insufficient_scope"
        ? `${e.message} Minta admin klinik menambahkan cakupan tersebut pada kunci API.`
        : e.message
      : "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.";
  return { isError: true, content: [{ type: "text", text: msg }] };
};
const guard = (fn: () => Promise<CallToolResult>) => fn().catch(fail);
const rd = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const fmtDelta = (m: { label?: string; key: string; current: number | null; target?: number | null; change_pct?: number | null }) =>
  `${m.label ?? m.key}: ${m.current ?? "-"}${m.target != null ? ` (target ${m.target})` : ""}${m.change_pct != null ? `, perubahan ${m.change_pct > 0 ? "+" : ""}${m.change_pct}%` : ""}`;

export function createMcpServer(client: AeviaClient): McpServer {
  const server = new McpServer({ name: "aevia", version: "0.1.0" }, { instructions: "AEVIA: akses terbatas ke data pendampingan pasien klinik Anda. Data klinis hanya tersedia bila pasien menyetujui akses rekam medis; setiap panggilan diaudit. Tidak ada tool untuk SOAP, resep, atau rencana. / AEVIA: scoped access to your clinic's patient-care data; clinical data requires patient consent; every call is audited; no SOAP/prescription/plan tools." });

  server.registerTool(
    "get_patient_summary",
    {
      title: "Ringkasan pasien",
      description:
        "Ringkasan satu pasien: persetujuan (consent), jumlah permintaan konsultasi, dan (bila pasien menyetujui akses rekam medis) status assessment, versi rencana, serta jumlah check-in. Tanpa nama/email. Butuh cakupan read:patients. / Patient summary without name or email; clinical part only with medical-record consent. Requires scope read:patients.",
      inputSchema: { patient_id: patientId },
      outputSchema: integrationPatientSummarySchema,
      annotations: { title: "Ringkasan pasien", ...rd },
    },
    ({ patient_id }) =>
      guard(async () => {
        const s = (await client.summary(patient_id)) as z.infer<typeof integrationPatientSummarySchema>;
        const granted = s.consents.filter((c) => c.granted).map((c) => c.scope);
        const lines = [
          `Pasien ${s.patient.id}. Persetujuan aktif: ${granted.join(", ") || "belum ada"}.`,
          `Permintaan konsultasi: ${s.consultation_requests.submitted} menunggu, ${s.consultation_requests.accepted} diterima, ${s.consultation_requests.declined} ditolak.`,
          s.clinical_visible && s.clinical
            ? `Data klinis: ${s.clinical.checkin_count} check-in${s.clinical.last_checkin_at ? ` (terakhir ${s.clinical.last_checkin_at})` : ""}; rencana ditandatangani ${s.clinical.signed_plan_version ? `versi ${s.clinical.signed_plan_version}` : "belum ada"}.`
            : (s.hidden_reason ?? "Data klinis disembunyikan."),
        ];
        return ok(lines.join("\n"), s);
      }),
  );

  server.registerTool(
    "list_checkins",
    {
      title: "Riwayat check-in",
      description:
        "Check-in terbaru seorang pasien (nilai per metrik dan mood; catatan bebas tidak disertakan). Butuh cakupan read:progress dan persetujuan rekam medis pasien. / Recent patient check-ins. Requires scope read:progress and medical-record consent.",
      inputSchema: { patient_id: patientId, limit: z.number().int().min(1).max(200).default(20).describe("Jumlah maksimum check-in / max items (1-200).") },
      outputSchema: integrationCheckinsSchema,
      annotations: { title: "Riwayat check-in", ...rd },
    },
    ({ patient_id, limit }) =>
      guard(async () => {
        const r = (await client.checkins(patient_id, limit)) as z.infer<typeof integrationCheckinsSchema>;
        const text = r.checkins.length
          ? `${r.checkins.length} check-in terbaru:\n` + r.checkins.map((c) => `- ${c.created_at}: ${Object.entries(c.values).map(([k, v]) => `${k}=${v}`).join(", ")}${c.mood != null ? `, mood ${c.mood}/5` : ""}`).join("\n")
          : "Belum ada check-in.";
        return ok(text, r);
      }),
  );

  server.registerTool(
    "get_progress",
    {
      title: "Progres pasien",
      description:
        "Progres terhitung dari check-in dan rencana: nilai saat ini, sebelumnya, target, dan tren per metrik. Butuh cakupan read:progress dan persetujuan rekam medis pasien. / Computed progress per metric. Requires scope read:progress and consent.",
      inputSchema: { patient_id: patientId },
      outputSchema: progressSchema,
      annotations: { title: "Progres pasien", ...rd },
    },
    ({ patient_id }) =>
      guard(async () => {
        const p = (await client.progress(patient_id)) as z.infer<typeof progressSchema>;
        const text = p.checkin_count
          ? `${p.checkin_count} check-in${p.last_checkin_at ? `, terakhir ${p.last_checkin_at}` : ""}.\n` + p.metrics.map((m) => `- ${fmtDelta(m as never)}`).join("\n")
          : "Belum ada data progres.";
        return ok(text, p);
      }),
  );

  server.registerTool(
    "get_care_plan",
    {
      title: "Rencana pendampingan",
      description:
        "Rencana pendampingan terbaru yang SUDAH ditandatangani profesional (hanya baca; tidak ada draf). Butuh cakupan read:plans dan persetujuan rekam medis pasien. / Latest signed care plan (read-only). Requires scope read:plans and consent.",
      inputSchema: { patient_id: patientId },
      outputSchema: z.object({ plan: patientPlanSchema.nullable() }),
      annotations: { title: "Rencana pendampingan", ...rd },
    },
    ({ patient_id }) =>
      guard(async () => {
        const r = (await client.carePlan(patient_id)) as { plan: z.infer<typeof patientPlanSchema> | null };
        const pl = r.plan;
        const text = pl
          ? `Rencana versi ${pl.version}, ditandatangani ${pl.signed_by_name} pada ${pl.signed_at}.\nFokus: ${pl.content.focus.join("; ") || "-"}\nLangkah berikutnya: ${pl.content.next_steps.join("; ") || "-"}`
          : "Belum ada rencana yang ditandatangani untuk pasien ini.";
        return ok(text, r);
      }),
  );

  server.registerTool(
    "send_checkin_reminder",
    {
      title: "Kirim pengingat check-in",
      description:
        "Membuat pengingat check-in untuk pasien (teks baku, tampil di beranda pasien pada waktu due_at; default sekarang). Tidak mengirim pesan bebas. Butuh cakupan write:reminders. / Creates a standard check-in reminder for a patient. Requires scope write:reminders.",
      inputSchema: { patient_id: patientId, due_at: z.iso.datetime().optional().describe("Waktu jatuh tempo ISO 8601, mis. 2026-10-05T02:00:00Z. Kosong = sekarang / ISO 8601; default now.") },
      outputSchema: integrationReminderSchema,
      annotations: { title: "Kirim pengingat check-in", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ patient_id, due_at }) =>
      guard(async () => {
        const r = (await client.reminder({ patient_id, kind: "checkin", ...(due_at ? { due_at } : {}) })) as z.infer<typeof integrationReminderSchema>;
        return ok(`Pengingat check-in dibuat untuk pasien ${r.patient_id}, jatuh tempo ${r.due_at}.`, r);
      }),
  );

  server.registerTool(
    "create_consultation_request",
    {
      title: "Ajukan permintaan konsultasi",
      description:
        "Mengajukan permintaan konsultasi atas nama pasien untuk satu program klinik. Tim klinik tetap meninjau dan menjadwalkan; ini bukan pemesanan. Butuh cakupan write:consultation_requests. / Submits a consultation request on behalf of a patient; the clinic still reviews it. Requires scope write:consultation_requests.",
      inputSchema: {
        patient_id: patientId,
        program_id: z.uuid().describe("ID program aktif di klinik / Active clinic program ID."),
        tujuan: z.string().max(600).optional().describe("Tujuan pasien (opsional) / patient's goal."),
        keluhan: z.string().max(1200).optional().describe("Keluhan utama (opsional) / main concern."),
        pertanyaan: z.array(z.string().min(1).max(300)).max(8).optional().describe("Pertanyaan untuk profesional (opsional) / questions."),
      },
      outputSchema: integrationRequestSchema,
      annotations: { title: "Ajukan permintaan konsultasi", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ patient_id, program_id, tujuan, keluhan, pertanyaan }) =>
      guard(async () => {
        const r = (await client.consultationRequest({ patient_id, program_id, prep: { tujuan: tujuan ?? "", keluhan: keluhan ?? "", pertanyaan: pertanyaan ?? [], konteks_assessment: "" } })) as z.infer<typeof integrationRequestSchema>;
        return ok(`Permintaan konsultasi ${r.id} diajukan (status ${r.status}). Tim klinik akan meninjau dan menghubungi pasien.`, r);
      }),
  );

  return server;
}
