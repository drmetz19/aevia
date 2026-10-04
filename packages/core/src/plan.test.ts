import { describe, expect, it } from "vitest";
import { explainPlan, planContentSchema, prescriptionBodySchema, signBodySchema } from "./plan";

const content = planContentSchema.parse({
  focus: ["Memperbaiki kualitas tidur"],
  next_steps: ["Rutinitas malam"],
  monitor: [{ metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" }],
  review_at: "2026-11-15",
});

describe("explainPlan", () => {
  it("memuat isi rencana apa adanya dan tidak mengubahnya", () => {
    const snap = JSON.stringify(content);
    const t = explainPlan("Sovia", { content });
    expect(t).toMatch(/Memperbaiki kualitas tidur/);
    expect(t).toMatch(/15 November 2026/);
    expect(t).toMatch(/Sovia/);
    expect(JSON.stringify(content)).toBe(snap);
  });
  it("tidak memuat kata terlarang pada rakitan Sovia", () => {
    expect(explainPlan("Sovia", { content })).not.toMatch(/wajib|gagal|permanen|garansi|instan|diagnosis Anda/i);
  });
});

describe("skema", () => {
  it("resep butuh minimal satu item bernama", () => {
    expect(prescriptionBodySchema.safeParse({ items: [] }).success).toBe(false);
    expect(prescriptionBodySchema.safeParse({ items: [{ name: "" }] }).success).toBe(false);
    expect(prescriptionBodySchema.safeParse({ items: [{ name: "Tretinoin" }] }).success).toBe(true);
  });
  it("tanda tangan butuh konfirmasi true", () => {
    expect(signBodySchema.safeParse({ confirm: true }).success).toBe(true);
    expect(signBodySchema.safeParse({ confirm: false }).success).toBe(false);
    expect(signBodySchema.safeParse({}).success).toBe(false);
  });
});
