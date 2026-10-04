/** Guardrail Sovia: kata terlarang (Verbal Identity §14), larangan diagnosis, deteksi darurat. */

export const FORBIDDEN_WORDS = [
  "wajib",
  "gagal",
  "permanen",
  "garansi",
  "instan",
  "miracle",
  "bahaya",
  "rusak",
  "cure",
  "guarantee",
  "perfect",
  "kewajiban",
] as const;

const DIAGNOSIS_PATTERNS: RegExp[] = [
  /\banda\s+(?:sedang\s+|telah\s+|sudah\s+)?(?:mengalami|menderita|terkena|mengidap)\b/i,
  /\bdiagnosis\s+anda\b/i,
  /\banda\s+(?:pasti|positif)\b/i,
  /\banda\s+harus\b/i,
  /\bsembuh\s+total\b/i,
];

const forbiddenRe = new RegExp(`(?<![\\p{L}])(?:${FORBIDDEN_WORDS.join("|")})(?![\\p{L}])`, "iu");

export const SAFE_SENTENCE = "Bagian ini sebaiknya dibahas langsung dengan profesional Anda.";

export interface GuardResult {
  text: string;
  changed: boolean;
}

/** Ganti setiap kalimat yang memuat kata terlarang atau klaim diagnosis dengan kalimat aman. */
export function sanitizeOutput(text: string): GuardResult {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  let changed = false;
  const out: string[] = [];
  for (const s of sentences) {
    if (forbiddenRe.test(s) || DIAGNOSIS_PATTERNS.some((p) => p.test(s))) {
      changed = true;
      if (out[out.length - 1] !== SAFE_SENTENCE) out.push(SAFE_SENTENCE);
    } else out.push(s.trim());
  }
  return { text: out.join(" ").trim(), changed };
}

const EMERGENCY_PATTERNS: RegExp[] = [
  /nyeri\s+dada/i,
  /sesak\s+(?:napas|nafas)/i,
  /sulit\s+(?:bernapas|bernafas)/i,
  /pingsan/i,
  /kejang/i,
  /(?:perdarahan|pendarahan)\s+(?:hebat|banyak|tidak\s+berhenti)/i,
  /(?:ingin|mau|pengen|berpikir\s+untuk)\s+(?:bunuh\s+diri|mati|mengakhiri\s+hidup)/i,
  /mengakhiri\s+hidup/i,
  /bunuh\s+diri/i,
  /menyakiti\s+diri/i,
  /chest\s+pain/i,
  /short(?:ness)?\s+of\s+breath|can'?t\s+breathe/i,
  /faint(?:ed|ing)?\b|pass(?:ed)?\s+out/i,
  /suicid/i,
  /kill\s+myself|end\s+my\s+life/i,
  /severe\s+bleeding|bleeding\s+heavily/i,
];

export function detectEmergency(text: string | null | undefined): boolean {
  if (!text) return false;
  return EMERGENCY_PATTERNS.some((p) => p.test(text));
}

export const EMERGENCY_MESSAGE =
  "Yang Anda tuliskan terdengar perlu perhatian medis segera. Mohon hubungi IGD terdekat atau layanan darurat 119 sekarang, atau minta orang terdekat menemani Anda. Sovia adalah AI dan tidak dapat menangani kondisi darurat.";
