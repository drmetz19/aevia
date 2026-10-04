import { describe, expect, it } from "vitest";
import { questions, scoreAssessment, type StoredAnswer } from "./assessment";
import { acceptBodySchema, draftPrep } from "./consultation";
import { sanitizeOutput } from "./guardrail";

const answers: StoredAnswer[] = [
  ...questions.filter((q) => q.type === "choice").map((q) => ({ question_id: q.id, text: null, value: q.area === "tidur" ? 4 : 1 })),
  { question_id: "tujuan-t", value: null, text: "ingin lebih bugar" },
  { question_id: "kulit-t", value: null, text: "kulit terasa kering" },
];

describe("draftPrep", () => {
  const prep = draftPrep(scoreAssessment(answers), answers);
  it("terisi dari assessment", () => {
    expect(prep.tujuan).toMatch(/ingin lebih bugar/);
    expect(prep.keluhan).toMatch(/Tidur/);
    expect(prep.keluhan).toMatch(/kulit terasa kering/);
    expect(prep.pertanyaan).toHaveLength(3);
    expect(prep.konteks_assessment).toMatch(/bukan diagnosis/);
  });
  it("lolos guardrail", () => {
    for (const t of [prep.konteks_assessment, ...prep.pertanyaan]) expect(sanitizeOutput(t).changed).toBe(false);
  });
  it("tanpa assessment → draf kosong yang aman", () => {
    const e = draftPrep(null, []);
    expect(e.tujuan).toBe("");
    expect(e.pertanyaan.length).toBeGreaterThan(0);
  });
});

describe("acceptBody", () => {
  it("hanya https dan datetime valid", () => {
    expect(acceptBodySchema.safeParse({ scheduled_at: "2026-10-10T09:00:00+07:00", meeting_url: "https://meet.google.com/abc" }).success).toBe(true);
    expect(acceptBodySchema.safeParse({ scheduled_at: "2026-10-10T09:00:00Z", meeting_url: "http://x.test" }).success).toBe(false);
    expect(acceptBodySchema.safeParse({ scheduled_at: "besok", meeting_url: "https://x.test" }).success).toBe(false);
    expect(acceptBodySchema.safeParse({ scheduled_at: "2026-10-10T09:00:00Z", meeting_url: "javascript:alert(1)" }).success).toBe(false);
  });
});
