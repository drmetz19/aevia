import { and, eq } from "drizzle-orm";
import { polishNarrative, formatDateId, type LLMProvider, type LlmPurpose, type PatientPlan, type Prep, type PolishResult } from "@aevia/core";
import { clinics, llmCalls, type Db } from "@aevia/db";
import { resolveModel } from "./claude";

/**
 * Mesin LLM Sovia. JAMINAN STRUKTURAL: modul ini hanya mengembalikan TEKS TAMPILAN. Satu-satunya tulisan ke DB adalah
 * baris llm_calls (statistik tanpa isi teks). Tidak mengimpor tabel rencana, resep, atau SOAP, dan tidak ada jalur dari
 * keluaran model ke penulisan data klinis.
 */
export interface LlmEngineDeps {
  db: Db;
  provider?: LLMProvider;
  now: () => Date;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface LlmEngine {
  /** Penyempurnaan narasi konteks draf persiapan (konteks_assessment). Selalu mengembalikan Prep yang valid. */
  polishPrep(clinicId: string, prep: Prep): Promise<Prep>;
  /** Penyempurnaan penjelasan rencana. Isi rencana (fokus, langkah, tanggal tinjau) wajib tetap utuh. */
  polishPlan<T extends Pick<PatientPlan, "explanation" | "content">>(clinicId: string, plan: T): Promise<T>;
}

async function clinicFor(db: Db, clinicId: string) {
  const [c] = await db.db.select().from(clinics).where(eq(clinics.id, clinicId));
  return c;
}

export function createLlmEngine(d: LlmEngineDeps): LlmEngine {
  const record = async (clinicId: string, purpose: LlmPurpose, r: PolishResult) => {
    if (r.fallback) d.log?.(`[llm] fallback ke skrip (${purpose}, klinik ${clinicId}): ${r.reason}`);
    try {
      await d.db.withTenant(clinicId, (tx) =>
        tx.insert(llmCalls).values({
          clinicId,
          purpose,
          model: r.model ?? resolveModel(),
          inputTokens: r.usage?.input_tokens ?? 0,
          outputTokens: r.usage?.output_tokens ?? 0,
          latencyMs: r.latencyMs,
          fallback: r.fallback,
          fallbackReason: r.reason,
          createdAt: d.now(),
        }),
      );
    } catch {
      // pencatatan tidak boleh mengganggu pasien
    }
  };

  /** Mode llm hanya bila provider ada (kunci API) DAN klinik menyalakan toggle; selain itu skrip, tanpa panggilan sama sekali. */
  const active = async (clinicId: string) => {
    if (!d.provider) return null;
    const c = await clinicFor(d.db, clinicId);
    if (!c?.llmEnabled) return null;
    return { provider: d.provider, prompt: { assistantName: c.assistantName, clinicName: c.name, whitelabel: c.brandMode === "whitelabel" } };
  };

  return {
    async polishPrep(clinicId, prep) {
      try {
        const a = await active(clinicId);
        if (!a) return prep;
        const r = await polishNarrative({
          provider: a.provider,
          prompt: a.prompt,
          scriptText: prep.konteks_assessment,
          task: "Rapikan paragraf konteks persiapan konsultasi ini agar mengalir, hangat, dan mudah dibaca pasien. Pertahankan semua isi dan kalimat penafian.",
          timeoutMs: d.timeoutMs,
          maxTokens: 350,
        });
        await record(clinicId, "prep_narrative", r);
        return r.fallback ? prep : { ...prep, konteks_assessment: r.text.slice(0, 1200) };
      } catch {
        return prep;
      }
    },
    async polishPlan(clinicId, plan) {
      try {
        const a = await active(clinicId);
        if (!a) return plan;
        const c = plan.content;
        const must = [...c.focus, ...c.next_steps, ...c.monitor.map((m) => m.label), ...(c.review_at ? [formatDateId(c.review_at)] : [])];
        const r = await polishNarrative({
          provider: a.provider,
          prompt: a.prompt,
          scriptText: plan.explanation,
          task: "Jelaskan rencana pendampingan ini dengan bahasa yang tenang dan jelas kepada pasien. Setiap butir fokus, langkah berikutnya, hal yang dipantau, dan tanggal tinjau harus tetap muncul persis seperti tertulis. Jangan menambah saran.",
          mustContain: must,
          timeoutMs: d.timeoutMs,
          maxTokens: 500,
        });
        await record(clinicId, "plan_explanation", r);
        return r.fallback ? plan : { ...plan, explanation: r.text };
      } catch {
        return plan;
      }
    },
  };
}

export const noLlm: LlmEngine = { polishPrep: async (_c, p) => p, polishPlan: async (_c, p) => p };

export async function llmUsage30d(db: Db, clinicId: string, now: Date) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  return db.withTenant(clinicId, async (tx) => {
    const rows = await tx.select().from(llmCalls).where(and(eq(llmCalls.clinicId, clinicId)));
    const mine = rows.filter((r) => r.createdAt >= since);
    return {
      calls_30d: mine.length,
      fallbacks_30d: mine.filter((r) => r.fallback).length,
      input_tokens_30d: mine.reduce((s, r) => s + r.inputTokens, 0),
      output_tokens_30d: mine.reduce((s, r) => s + r.outputTokens, 0),
    };
  });
}

