import { describe, expect, it } from "vitest";
import { detectEmergency, EMERGENCY_MESSAGE, SAFE_SENTENCE, sanitizeOutput, FORBIDDEN_WORDS } from "./guardrail";
import { guardEngine, questions, scoreAssessment, scriptEngine, type StoredAnswer } from "./assessment";

describe("sanitizeOutput", () => {
  it.each([
    "Anda wajib istirahat total.",
    "Program ini gagal membantu.",
    "Hasilnya permanen.",
    "Kami beri garansi hasil instan.",
    "Ini miracle cream.",
    "Kondisi ini bahaya bagi Anda.",
    "Kulit Anda rusak.",
    "Ini diagnosis Anda.",
    "Anda mengalami insomnia kronis.",
    "Anda menderita gangguan tidur.",
    "Anda terkena stres berat.",
  ])("mengganti kalimat tidak aman: %s", (s) => {
    const r = sanitizeOutput(s);
    expect(r.changed).toBe(true);
    expect(r.text).toBe(SAFE_SENTENCE);
  });

  it("hanya kalimat bermasalah yang diganti; kalimat lain utuh", () => {
    const r = sanitizeOutput("Tidur Anda tampak kurang teratur. Anda wajib berhenti kerja. Mari kita bahas bersama.");
    expect(r.text).toBe(`Tidur Anda tampak kurang teratur. ${SAFE_SENTENCE} Mari kita bahas bersama.`);
  });

  it("kalimat aman tidak berubah; kata terlarang sebagai bagian kata lain tidak memicu", () => {
    const s = "Mari kita lihat gambaran awal tidur Anda. Hasil assessment bukan diagnosis.";
    expect(sanitizeOutput(s)).toEqual({ text: s, changed: false });
    expect(sanitizeOutput("Pengalaman wajibkan").changed).toBe(false);
  });

  it("daftar kata terlarang lengkap", () => {
    expect(FORBIDDEN_WORDS).toEqual(["wajib", "gagal", "permanen", "garansi", "instan", "miracle", "bahaya", "rusak"]);
  });
});

describe("detectEmergency", () => {
  it.each([
    "saya nyeri dada sejak tadi",
    "Sesak napas kalau naik tangga",
    "sering pingsan",
    "ingin bunuh diri",
    "rasanya mau mengakhiri hidup",
    "perdarahan hebat",
    "I have chest pain",
    "shortness of breath",
    "I want to kill myself",
    "severe bleeding",
  ])("terdeteksi: %s", (t) => expect(detectEmergency(t)).toBe(true));

  it.each(["tidur saya kurang nyenyak", "kulit kering dan kusam", "", null, undefined])("tidak terdeteksi: %s", (t) =>
    expect(detectEmergency(t)).toBe(false),
  );

  it("pesan rujukan menyebut IGD/119 dan lolos guardrail", () => {
    expect(EMERGENCY_MESSAGE).toMatch(/IGD/);
    expect(EMERGENCY_MESSAGE).toMatch(/119/);
    expect(sanitizeOutput(EMERGENCY_MESSAGE).changed).toBe(false);
  });
});

describe("bank & scoring", () => {
  it("setiap area punya pertanyaan pilihan 1–4 dan satu teks opsional", () => {
    for (const area of ["tidur", "energi", "aktivitas", "stres", "kulit", "nutrisi", "tujuan"]) {
      const qs = questions.filter((q) => q.area === area);
      expect(qs.filter((q) => q.type === "text")).toHaveLength(1);
      expect(qs.some((q) => q.type === "choice" && q.options.length === 4)).toBe(true);
    }
  });

  it("copy Sovia tidak memuat kata terlarang", () => {
    for (const q of questions) {
      expect(sanitizeOutput(q.text).changed, q.text).toBe(false);
      for (const o of q.options) expect(sanitizeOutput(o.label).changed, o.label).toBe(false);
    }
    expect(guardEngine(scriptEngine).intro("Sovia")).toBe(scriptEngine.intro("Sovia"));
  });

  it("skor 0–100, label tenang, 3 prioritas terendah", () => {
    const answers: StoredAnswer[] = questions
      .filter((q) => q.type === "choice")
      .map((q) => ({
        question_id: q.id,
        text: null,
        value: q.area === "tidur" ? 4 : q.area === "stres" ? 3 : q.area === "kulit" ? 3 : 1,
      }));
    const r = scoreAssessment(answers);
    const by = Object.fromEntries(r.areas.map((a) => [a.area, a]));
    expect(by.tidur).toMatchObject({ score: 0, level: "priority", level_label: "Prioritas untuk dibahas" });
    expect(by.energi).toMatchObject({ score: 100, level_label: "Relatif stabil" });
    expect(by.stres).toMatchObject({ score: 33, level_label: "Prioritas untuk dibahas" });
    expect(r.priorities).toEqual(["tidur", "stres", "kulit"]);
    expect(r.disclaimer).toBe("Hasil assessment bukan diagnosis.");
  });
});
