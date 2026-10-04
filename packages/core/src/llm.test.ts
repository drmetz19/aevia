import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS } from "./guardrail";
import { SOVIA_RULES, buildSystemPrompt, countRewritten, polishNarrative, type LLMProvider } from "./llm";

const prompt = { assistantName: "Luna", clinicName: "Lumina Skin Studio", whitelabel: false };
const script = "Saya Luna. Fokus Anda saat ini: tidur lebih teratur. Bagian ini sebaiknya dibahas langsung dengan profesional Anda.";
const fake = (text: string | (() => Promise<string>)): LLMProvider => ({ complete: async () => ({ text: typeof text === "string" ? text : await text(), usage: { input_tokens: 10, output_tokens: 5 }, model: "fake" }) });
const run = (p: LLMProvider, extra: object = {}) => polishNarrative({ provider: p, prompt, scriptText: script, task: "Rapikan.", timeoutMs: 50, ...extra });

describe("prompt sistem", () => {
  it("memuat aturan inti Verbal Identity: tenang, tanpa diagnosis/resep, AI guides, kata terlarang, nama klinik/asisten", () => {
    const p = buildSystemPrompt(prompt);
    expect(p).toContain("AI guides. Professionals decide.");
    expect(p).toMatch(/tenang, jelas, hangat/);
    expect(p).toMatch(/Jangan memberi diagnosis/);
    expect(p).toMatch(/obat, dosis, atau resep/);
    expect(p).toMatch(/anda harus/);
    expect(p).toMatch(/sembuh total/);
    for (const w of FORBIDDEN_WORDS) expect(p, w).toContain(w);
    expect(p).toContain("Luna");
    expect(p).toContain("Lumina Skin Studio");
    expect(p).toContain("melalui AEVIA");
    expect(p).toMatch(/hanya merapikan teks tampilan/);
    expect(SOVIA_RULES.length).toBeGreaterThanOrEqual(8);
  });
  it("white-label: tidak pernah menyebut AEVIA sebagai merek; justru melarangnya", () => {
    const p = buildSystemPrompt({ ...prompt, whitelabel: true });
    expect(p).toMatch(/JANGAN PERNAH menyebut kata "AEVIA"/);
    expect(p).not.toContain("melalui AEVIA");
  });
});

describe("polishNarrative", () => {
  it("keluaran bersih dipakai (tanpa fallback) dan penggunaan token dicatat", async () => {
    const r = await run(fake("Saya Luna. Fokus Anda saat ini: tidur lebih teratur. Kita jalani pelan-pelan."), { mustContain: ["tidur lebih teratur"] });
    expect(r).toMatchObject({ fallback: false, reason: null, usage: { input_tokens: 10, output_tokens: 5 }, model: "fake" });
    expect(r.text).toContain("pelan-pelan");
  });
  it("satu kalimat terlarang disaring guardrail; teks lain tetap", async () => {
    const r = await run(fake("Saya Luna. Anda wajib minum obat ini. Fokus Anda: tidur lebih teratur."), { mustContain: ["tidur lebih teratur"] });
    expect(r.fallback).toBe(false);
    expect(r.text).not.toMatch(/wajib/i);
    expect(r.text).toContain("sebaiknya dibahas langsung dengan profesional");
  });
  it("lebih dari satu kalimat harus ditulis ulang → fallback ke skrip", async () => {
    const bad = "Anda wajib minum obat. Diagnosis Anda jelas. Anda harus segera mulai. Ini garansi sembuh total.";
    expect(countRewritten(bad)).toBeGreaterThan(1);
    const r = await run(fake(bad));
    expect(r).toMatchObject({ fallback: true, reason: "guardrail_rewrote_many", text: script });
  });
  it("kosong, error, timeout → fallback skrip tanpa melempar", async () => {
    expect(await run(fake("   "))).toMatchObject({ fallback: true, reason: "empty", text: script });
    expect(await run({ complete: async () => { throw new Error("boom"); } })).toMatchObject({ fallback: true, reason: "error", text: script });
    const hang = { complete: () => new Promise<never>(() => {}) } as LLMProvider;
    expect(await polishNarrative({ provider: hang, prompt, scriptText: script, task: "x", timeoutMs: 20 })).toMatchObject({ fallback: true, reason: "timeout", text: script });
  });
  it("isi profesional yang hilang atau berubah → fallback; white-label menyebut AEVIA → fallback", async () => {
    expect(await run(fake("Saya Luna. Kita jalani pelan-pelan."), { mustContain: ["tidur lebih teratur"] })).toMatchObject({ fallback: true, reason: "missing_required_text" });
    expect(await run(fake("Saya Luna dari AEVIA. Fokus Anda: tidur lebih teratur."), { prompt: { ...prompt, whitelabel: true } })).toMatchObject({ fallback: true, reason: "mentions_platform" });
  });
});
