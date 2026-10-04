/** Warna merek whitelabel: validasi kontras WCAG AA + penurunan token turunan (accent-ink, dark, soft, body). */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalisasi ke #RRGGBB huruf besar; null bila bukan hex valid. */
export function normalizeHex(v: string): string | null {
  const s = v.trim();
  if (!HEX_RE.test(s)) return null;
  const h = s.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return `#${full.toUpperCase()}`;
}

export function toRgb(hex: string): Rgb {
  const h = hex.slice(1);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Campur `a` dengan `b`; t = porsi b (0–1). */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function shiftUntil(color: string, toward: string, againstAll: string[], min: number): string | null {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(color, toward, Math.min(1, t));
    if (againstAll.every((bg) => contrastRatio(c, bg) >= min)) return c;
  }
  return null;
}

/** Gelapkan sampai ≥ min terhadap semua latar. null bila mustahil (mis. latar gelap). */
export const darkenUntil = (c: string, bgs: string[], min = 4.5) => shiftUntil(c, "#000000", bgs, min);
export const lightenUntil = (c: string, bgs: string[], min = 4.5) => shiftUntil(c, "#FFFFFF", bgs, min);

export const AEVIA_DEFAULT_COLORS = { primary: "#0B1F3A", accent: "#C9825A", background: "#F7F4EF", surface: "#FFFFFF" } as const;
export const MIN_TEXT = 4.5;
export const MIN_LARGE = 3;

export interface BrandColors4 {
  primary: string;
  accent: string;
  background: string;
  surface: string;
}

export interface ContrastCheck {
  id: string;
  label: string;
  ratio: number;
  min: number;
  ok: boolean;
}
export interface BrandValidation {
  ok: boolean;
  colors: BrandColors4 | null;
  checks: ContrastCheck[];
  problems: string[];
  vars: Record<string, string> | null;
}

const r1 = (n: number) => Math.round(n * 100) / 100;
const fmtRatio = (n: number) => r1(n).toString().replace(".", ",");

/**
 * Validasi warna merek + turunkan variabel tema. Kunci yang kosong memakai default AEVIA.
 * Aturan: teks utama pada latar & permukaan ≥ 4,5; putih di atas warna utama ≥ 4,5; putih di atas aksen ≥ 3 (tombol 18px tebal);
 * accent-ink (aksen digelapkan) ≥ 4,5 di latar & permukaan; aksen terang di atas area gelap ≥ 4,5.
 */
export function validateBrand(input: Partial<Record<keyof BrandColors4, string | undefined | null>>): BrandValidation {
  const problems: string[] = [];
  const labels = { primary: "Warna utama", accent: "Warna aksen", background: "Warna latar", surface: "Warna kartu" } as const;
  const c = {} as BrandColors4;
  for (const k of Object.keys(labels) as (keyof BrandColors4)[]) {
    const raw = input[k];
    if (raw === undefined || raw === null || raw === "") c[k] = AEVIA_DEFAULT_COLORS[k];
    else {
      const n = normalizeHex(raw);
      if (!n) problems.push(`${labels[k]} belum berupa kode warna heksadesimal yang sah (contoh #0B1F3A).`);
      else c[k] = n;
    }
  }
  if (problems.length) return { ok: false, colors: null, checks: [], problems, vars: null };

  const checks: ContrastCheck[] = [];
  const add = (id: string, label: string, a: string, b: string, min: number, hint: string) => {
    const ratio = contrastRatio(a, b);
    const ok = ratio >= min;
    checks.push({ id, label, ratio: r1(ratio), min, ok });
    if (!ok) problems.push(`${label} hanya ${fmtRatio(ratio)}:1, padahal minimal ${fmtRatio(min)}:1. ${hint}`);
  };
  add("primary-bg", "Teks warna utama pada latar", c.primary, c.background, MIN_TEXT, "Gunakan warna utama yang lebih gelap atau latar yang lebih terang.");
  add("primary-surface", "Teks warna utama pada kartu", c.primary, c.surface, MIN_TEXT, "Gunakan warna utama yang lebih gelap atau warna kartu yang lebih terang.");
  add("white-primary", "Teks putih pada tombol warna utama", "#FFFFFF", c.primary, MIN_TEXT, "Gunakan warna utama yang lebih gelap agar tombol terbaca.");
  add("white-accent", "Teks putih pada tombol warna aksen", "#FFFFFF", c.accent, MIN_LARGE, "Gunakan warna aksen yang lebih gelap agar tombol terbaca.");

  const accentInk = darkenUntil(c.accent, [c.background, c.surface], MIN_TEXT);
  if (accentInk) {
    const worst = Math.min(contrastRatio(accentInk, c.background), contrastRatio(accentInk, c.surface));
    checks.push({ id: "accent-ink", label: "Teks aksen (diturunkan) pada latar dan kartu", ratio: r1(worst), min: MIN_TEXT, ok: true });
  } else {
    problems.push("Warna aksen tidak dapat diturunkan menjadi teks yang terbaca di atas latar dan kartu ini. Gunakan latar dan kartu yang lebih terang.");
  }

  const dark = mix(c.primary, "#000000", 0.35);
  const accentLight = lightenUntil(c.accent, [dark], MIN_TEXT) ?? "#FFFFFF";
  let soft = c.background;
  for (const t of [0.14, 0.1, 0.06, 0.03, 0]) {
    const cand = mix(c.background, c.primary, t);
    if (contrastRatio(c.primary, cand) >= MIN_TEXT) {
      soft = cand;
      break;
    }
  }
  const bodyCand = mix(c.primary, c.background, 0.2);
  const body = [c.background, c.surface, soft].every((bg) => contrastRatio(bodyCand, bg) >= MIN_TEXT) ? bodyCand : c.primary;

  if (problems.length) return { ok: false, colors: c, checks, problems, vars: null };
  return {
    ok: true,
    colors: c,
    checks,
    problems: [],
    vars: {
      "--brand-primary": c.primary,
      "--brand-accent": c.accent,
      "--brand-accent-ink": accentInk!,
      "--brand-accent-light": accentLight,
      "--brand-bg": c.background,
      "--brand-surface": c.surface,
      "--brand-dark": dark,
      "--brand-soft": soft,
      "--aevia-body": body,
    },
  };
}

/** Variabel CSS tema (hanya bila valid). Warna tersimpan lama yang tak lolos → null (pakai token AEVIA). */
export function themeVars(colors: Partial<Record<keyof BrandColors4, string | undefined | null>>): Record<string, string> | null {
  const v = validateBrand(colors);
  return v.ok ? v.vars : null;
}
