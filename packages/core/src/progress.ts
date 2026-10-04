import { z } from "zod";
import type { MonitorMetric } from "./plan";

/** Metrik umum bila pasien belum punya rencana yang ditandatangani. Skala 1–5. */
export const GENERAL_METRICS: MonitorMetric[] = [
  { metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: null, target: null, direction: "up" },
  { metric_key: "energi", label: "Tingkat energi", unit: "skor", baseline: null, target: null, direction: "up" },
  { metric_key: "stres", label: "Ketenangan (kebalikan stres)", unit: "skor", baseline: null, target: null, direction: "up" },
];

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;
export const NUMERIC_MAX = 100000;
/** Satuan kosong atau "skor" = skala 1–5; selain itu angka bebas (mis. kg, %, cm). */
export const isScaleMetric = (m: Pick<MonitorMetric, "unit">) => ["", "skor"].includes(m.unit.trim().toLowerCase());

/** Semua skala 1–5 bermakna "5 = paling baik" (untuk stres: paling tenang), apa pun `direction` yang tersimpan di rencana.
 *  Karena itu arah efektif skala selalu naik; `direction` hanya berlaku untuk metrik numerik (mis. berat badan). */
export const effectiveDirection = (m: Pick<MonitorMetric, "unit" | "direction">): "up" | "down" => (isScaleMetric(m) ? "up" : m.direction);

export const SCALE_ANCHORS = ["Perlu perhatian lebih", "Kurang", "Cukup", "Baik", "Sangat baik"] as const;
export const SCALE_ANCHORS_CALM = ["Sangat tegang", "Tegang", "Cukup tenang", "Tenang", "Sangat tenang"] as const;
export const scaleAnchors = (key: string) => (key === "stres" ? SCALE_ANCHORS_CALM : SCALE_ANCHORS);
export const CHECKIN_REQUIRED = "Ada satu bagian yang belum terisi.";

export const checkinFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  scale: z.boolean(),
  min: z.number(),
  max: z.number(),
});
export const checkinFormSchema = z.object({
  general: z.boolean(),
  plan_id: z.string().nullable(),
  fields: z.array(checkinFieldSchema),
});
export type CheckinForm = z.infer<typeof checkinFormSchema>;

export const checkinBodySchema = z.object({
  values: z.record(z.string(), z.number().finite()),
  note: z.string().trim().max(500).optional(),
  mood: z.number().int().min(1).max(5).optional(),
});

export function checkinFields(metrics: MonitorMetric[]): CheckinForm["fields"] {
  return metrics.map((m) => {
    const scale = isScaleMetric(m);
    return { key: m.metric_key, label: m.label, unit: m.unit, scale, min: scale ? SCALE_MIN : 0, max: scale ? SCALE_MAX : NUMERIC_MAX };
  });
}

export const progressMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  direction: z.enum(["up", "down"]),
  current: z.number().nullable(),
  previous: z.number().nullable(),
  target: z.number().nullable(),
  change_pct: z.number().nullable(),
  delta_text: z.string().nullable(),
  status: z.enum(["first", "positive", "stable", "slow"]),
  status_text: z.string(),
  history: z.array(z.object({ at: z.string(), value: z.number() })),
});
export type ProgressMetric = z.infer<typeof progressMetricSchema>;
export const progressSchema = z.object({
  general: z.boolean(),
  checkin_count: z.number(),
  last_checkin_at: z.string().nullable(),
  metrics: z.array(progressMetricSchema),
});
export type Progress = z.infer<typeof progressSchema>;

export const PROGRESS_LABELS = { current: "Saat ini", previous: "Sebelumnya", target: "Target", trend: "Tren", change: "Perubahan" } as const;
export const PROGRESS_EMPTY = "Belum ada data progres. Setelah check-in pertama, perkembangan Anda akan mulai terlihat di sini.";
export const STATUS_TEXT = {
  first: "Check-in pertama sudah tercatat. Mari lihat apa yang berubah sejak check-in berikutnya.",
  positive: "Ada perubahan positif pada area ini.",
  stable: "Kondisi masih relatif stabil.",
  slow: "Area ini mungkin memerlukan waktu lebih panjang.",
} as const;
export const NO_CHANGE_TEXT = "Belum terlihat perubahan yang berarti pada area ini.";
export const STABLE_THRESHOLD_PCT = 3;

export interface HistoryPoint {
  at: string;
  value: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hitung kartu progres dari riwayat. Bahasa tidak pernah menghakimi ("buruk"/"gagal"); arah naik/turun dihitung sesuai metrik. */
export function computeMetric(m: MonitorMetric, history: HistoryPoint[]): ProgressMetric {
  const dir = effectiveDirection(m);
  const h = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const current = h.at(-1)?.value ?? null;
  const previous = h.length > 1 ? h.at(-2)!.value : null;
  let change: number | null = null;
  if (current !== null && previous !== null && previous !== 0) change = round1(((current - previous) / Math.abs(previous)) * 100);
  const improved = change !== null && (dir === "up" ? change > 0 : change < 0);
  let status: ProgressMetric["status"] = "first";
  let text: string = STATUS_TEXT.first;
  if (previous !== null) {
    if (change === null || Math.abs(change) < STABLE_THRESHOLD_PCT) {
      status = "stable";
      text = h.length >= 3 && Math.abs(change ?? 0) < STABLE_THRESHOLD_PCT && h.slice(-3).every((x) => x.value === current) ? NO_CHANGE_TEXT : STATUS_TEXT.stable;
    } else if (improved) {
      status = "positive";
      text = STATUS_TEXT.positive;
    } else {
      status = "slow";
      text = STATUS_TEXT.slow;
    }
  }
  const delta = change === null ? null : change === 0 ? "Tidak berubah sejak check-in terakhir" : `${change > 0 ? "Naik" : "Turun"} ${Math.abs(change)}% sejak check-in terakhir`;
  return {
    key: m.metric_key,
    label: m.label,
    unit: m.unit,
    direction: dir,
    current,
    previous,
    target: m.target,
    change_pct: change,
    delta_text: delta,
    status,
    status_text: text,
    history: h,
  };
}

export function computeProgress(metrics: MonitorMetric[], checkins: { at: string; values: Record<string, number> }[], general: boolean): Progress {
  const cs = [...checkins].sort((a, b) => a.at.localeCompare(b.at));
  return {
    general,
    checkin_count: cs.length,
    last_checkin_at: cs.at(-1)?.at ?? null,
    metrics: metrics.map((m) =>
      computeMetric(
        m,
        cs.filter((c) => typeof c.values[m.metric_key] === "number").map((c) => ({ at: c.at, value: c.values[m.metric_key]! })),
      ),
    ),
  };
}

export const reminderKindSchema = z.enum(["checkin", "review", "plan"]);
export const reminderSchema = z.object({ id: z.string(), kind: reminderKindSchema, message: z.string(), due_at: z.string() });
export const reminderListSchema = z.object({ reminders: z.array(reminderSchema) });
export const REMINDER_CTA = { checkin: "Mulai check-in", review: "Lihat rencana", plan: "Lihat perubahan terbaru" } as const;
export const REMINDER_MESSAGE = {
  checkin: "Waktunya check-in singkat.",
  review: "Sudah waktunya meninjau rencana Anda. Mari lihat apa yang berubah.",
  plan: "Rencana Anda sudah diperbarui.",
} as const;
export const CHECKIN_INTERVAL_DAYS = 14;
