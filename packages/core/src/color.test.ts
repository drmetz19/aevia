import { describe, expect, it } from "vitest";
import { contrastRatio, darkenUntil, normalizeHex, themeVars, validateBrand, AEVIA_DEFAULT_COLORS } from "./color";
import { brandUpdateSchema, createClinicSchema, hostnameSchema, programInputSchema } from "./settings";

describe("kontras", () => {
  it("rasio WCAG yang diketahui", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#0B1F3A", "#F7F4EF")).toBeGreaterThan(14);
    expect(contrastRatio("#C9825A", "#F7F4EF")).toBeLessThan(3);
  });
  it("normalizeHex", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex(" #1f4d3f ")).toBe("#1F4D3F");
    expect(normalizeHex("1f4d3f")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
  it("darkenUntil mencapai target; mustahil di latar gelap", () => {
    const c = darkenUntil("#C9825A", ["#F7F4EF", "#FFFFFF"], 4.5)!;
    expect(contrastRatio(c, "#F7F4EF")).toBeGreaterThanOrEqual(4.5);
    expect(darkenUntil("#C9825A", ["#404040"], 4.5)).toBeNull();
  });
});

describe("validateBrand", () => {
  it("default AEVIA lolos dan menurunkan accent-ink ≥ 4,5", () => {
    const v = validateBrand({});
    expect(v.ok).toBe(true);
    expect(v.colors).toEqual(AEVIA_DEFAULT_COLORS);
    expect(contrastRatio(v.vars!["--brand-accent-ink"]!, "#F7F4EF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(v.vars!["--brand-accent-light"]!, v.vars!["--brand-dark"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("warna demo-partner lolos", () => {
    expect(validateBrand({ primary: "#1F4D3F", accent: "#B5542F", background: "#F5F7F3", surface: "#FFFFFF" }).ok).toBe(true);
  });
  it("menolak dengan penjelasan + rasio terhitung", () => {
    const v = validateBrand({ primary: "#AAAAAA", background: "#FFFFFF" });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/hanya 2,3\d:1, padahal minimal 4,5:1/);
    expect(v.checks.find((c) => c.id === "primary-bg")).toMatchObject({ ok: false, min: 4.5 });
  });
  it("tombol putih di aksen terang ditolak (min 3:1)", () => {
    const v = validateBrand({ accent: "#F0D9A0" });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/tombol warna aksen/);
  });
  it("hex tidak sah ditolak; latar gelap tak bisa menurunkan accent-ink", () => {
    expect(validateBrand({ primary: "biru" }).problems[0]).toMatch(/heksadesimal/);
    const dark = validateBrand({ primary: "#FFFFFF", background: "#101010", surface: "#181818", accent: "#C9825A" });
    expect(dark.ok).toBe(false);
  });
  it("themeVars null bila tak lolos", () => {
    expect(themeVars({ primary: "#CCCCCC" })).toBeNull();
    expect(themeVars({ primary: "#1F4D3F" })!["--brand-primary"]).toBe("#1F4D3F");
  });
});

describe("skema pengaturan", () => {
  it("font hanya dari allowlist; domain; slug; program", () => {
    const base = { brand_mode: "whitelabel", colors: { primary: "#1f4d3f", accent: "#b5542f", background: "#f5f7f3", surface: "#fff" }, custom_domain: null };
    expect(brandUpdateSchema.safeParse({ ...base, font: "Inter" }).success).toBe(true);
    expect(brandUpdateSchema.safeParse({ ...base, font: "Comic Sans" }).success).toBe(false);
    expect(brandUpdateSchema.parse({ ...base, font: null }).colors.surface).toBe("#FFFFFF");
    expect(hostnameSchema.safeParse("Klinik.Contoh.id").data).toBe("klinik.contoh.id");
    for (const bad of ["localhost", "http://x.id", "x.id/path", "192.168.0.1", "a b.id"]) expect(hostnameSchema.safeParse(bad).success, bad).toBe(false);
    expect(createClinicSchema.safeParse({ slug: "klinik-baru", name: "Klinik Baru", brand_mode: "cobrand", admin_email: "A@B.id" }).data?.admin_email).toBe("a@b.id");
    for (const bad of ["ab", "Admin", "api", "-x-", "a_b"]) expect(createClinicSchema.safeParse({ slug: bad, name: "Klinik", brand_mode: "cobrand", admin_email: "a@b.id" }).success, bad).toBe(false);
    expect(programInputSchema.safeParse({ name: "Program A", duration_weeks: null, price_idr: null, includes: [] }).success).toBe(true);
    expect(programInputSchema.safeParse({ name: "Program A", duration_weeks: 0, price_idr: -1, includes: [] }).success).toBe(false);
  });
});
