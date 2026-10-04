import { FORBIDDEN_WORDS, sanitizeOutput } from "./guardrail";

/** Penyedia model bahasa. Hanya menghasilkan TEKS; tidak ada alat (tool) dan tidak ada akses data. */
export interface LLMRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  timeoutMs: number;
}
export interface LLMResult {
  text: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}
export interface LLMProvider {
  complete(req: LLMRequest): Promise<LLMResult>;
}

export const DEFAULT_LLM_TIMEOUT_MS = 15_000;
export const LLM_PURPOSES = ["prep_narrative", "plan_explanation"] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

/** Aturan inti prompt sistem (sumber: Verbal Identity 3.0). Dipertahankan sebagai konstanta; ada test yang menjaganya. */
export const SOVIA_RULES = [
  "Kamu hanya MENGHALUSKAN bahasa teks yang diberikan: jangan menambah, mengurangi, atau mengubah fakta, angka, tanggal, atau isi rencana.",
  "Nada: tenang, jelas, hangat, dan menghargai. Kalimat pendek. Bahasa Indonesia sehari-hari yang sopan (Anda).",
  "AI guides. Professionals decide. Kamu pendamping, bukan pengambil keputusan klinis.",
  "Jangan memberi diagnosis, jangan menyebut pasien \"mengalami\" atau \"menderita\" suatu kondisi, jangan menyarankan atau mengubah obat, dosis, atau resep.",
  "Jangan menjanjikan hasil (tanpa garansi, tanpa klaim instan, permanen, atau sembuh total). Jangan menakut-nakuti.",
  "Jangan memakai kata: " + FORBIDDEN_WORDS.join(", ") + ", \"anda harus\", \"sembuh total\".",
  "Jangan memberi perintah klinis. Bila ada pertanyaan medis, arahkan untuk dibahas langsung dengan profesional.",
  "Jangan menyebut atau membuat rencana, resep, atau catatan SOAP baru; kamu hanya merapikan teks tampilan.",
  "Keluarkan HANYA teks hasil akhir, tanpa pembuka, tanpa penjelasan, tanpa format JSON atau markdown.",
] as const;

export interface PromptContext {
  assistantName: string;
  clinicName: string;
  whitelabel: boolean;
}

export function buildSystemPrompt(c: PromptContext): string {
  const brand = c.whitelabel
    ? `Kamu adalah ${c.assistantName}, asisten AI milik ${c.clinicName}. JANGAN PERNAH menyebut kata "AEVIA" atau platform lain; hanya ${c.clinicName} dan ${c.assistantName}.`
    : `Kamu adalah ${c.assistantName}, asisten AI dari ${c.clinicName}, ditampilkan melalui AEVIA.`;
  return [brand, "Aturan:", ...SOVIA_RULES.map((r, i) => `${i + 1}. ${r}`)].join("\n");
}

export type FallbackReason = "empty" | "guardrail_rewrote_many" | "missing_required_text" | "mentions_platform" | "error" | "timeout" | "disabled";

export interface PolishResult {
  text: string;
  fallback: boolean;
  reason: FallbackReason | null;
  usage?: LLMResult["usage"];
  model?: string;
  latencyMs: number;
}

/** Jumlah kalimat yang akan diganti guardrail. */
export function countRewritten(text: string): number {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  return sentences.filter((s) => sanitizeOutput(s).changed).length;
}

export const MAX_REWRITTEN_SENTENCES = 1;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

export interface PolishInput {
  provider: LLMProvider;
  prompt: PromptContext;
  /** Keluaran skrip deterministik: satu-satunya bahan dan jaring pengaman (fallback). */
  scriptText: string;
  /** Instruksi tugas singkat. */
  task: string;
  /** Teks yang HARUS tetap muncul apa adanya (isi profesional, tanggal). Hilang → fallback. */
  mustContain?: string[];
  maxTokens?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Hasil LLM hanyalah teks tampilan. Selalu lewat guardrail; bila kosong, error, timeout, menulis ulang >1 kalimat,
 * menghilangkan teks wajib, atau menyebut AEVIA di mode white-label → kembali ke keluaran skrip (tanpa galat ke pengguna).
 */
export async function polishNarrative(i: PolishInput): Promise<PolishResult> {
  const now = i.now ?? Date.now;
  const t0 = now();
  const done = (r: Omit<PolishResult, "latencyMs">): PolishResult => ({ ...r, latencyMs: now() - t0 });
  const fb = (reason: FallbackReason, extra: Partial<PolishResult> = {}) => done({ text: i.scriptText, fallback: true, reason, ...extra });
  const timeoutMs = i.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  let res: LLMResult;
  try {
    res = await withTimeout(
      i.provider.complete({
        system: buildSystemPrompt(i.prompt),
        messages: [{ role: "user", content: `${i.task}\n\nTeks sumber:\n"""\n${i.scriptText}\n"""` }],
        maxTokens: i.maxTokens ?? 400,
        timeoutMs,
      }),
      timeoutMs + 500,
    );
  } catch (e) {
    return fb((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "timeout" : "error");
  }
  const meta = { usage: res.usage, model: res.model };
  const raw = (res.text ?? "").trim();
  if (!raw) return fb("empty", meta);
  if (countRewritten(raw) > MAX_REWRITTEN_SENTENCES) return fb("guardrail_rewrote_many", meta);
  const g = sanitizeOutput(raw);
  const text = g.text.trim();
  if (!text) return fb("empty", meta);
  if (i.prompt.whitelabel && /aevia/i.test(text)) return fb("mentions_platform", meta);
  if (i.mustContain?.some((m) => m && !text.includes(m))) return fb("missing_required_text", meta);
  return done({ text, fallback: false, reason: null, ...meta });
}
