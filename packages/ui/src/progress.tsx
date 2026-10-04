import type { ProgressMetric } from "@aevia/core";
import { PROGRESS_LABELS } from "@aevia/core";

const fmt = (n: number | null, unit: string) =>
  n === null ? "–" : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n)}${unit && unit.toLowerCase() !== "skor" ? ` ${unit}` : ""}`;

/** Sparkline SVG inline (tanpa pustaka). Satu titik → hanya titik. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 120;
  const h = 36;
  const pad = 4;
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const last = pts.at(-1)!;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} className="h-9 w-[120px]">
      {pts.length > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--brand-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--brand-accent)" />
    </svg>
  );
}

/** Kartu progres (desain-terkunci): angka serif besar, delta copper-ink, sparkline, baris Saat ini/Sebelumnya/Target. Bahasa Verbal Identity §25/§37. */
export function ProgressCard({ metric }: { metric: ProgressMetric }) {
  const m = metric;
  const trend = m.history.map((x) => x.value);
  return (
    <article className="rounded-lg border border-line bg-white p-6 shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-ink">{m.label}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="font-serif text-5xl leading-none text-navy">{fmt(m.current, m.unit)}</p>
        <figure className="text-right">
          <Sparkline values={trend} label={`${PROGRESS_LABELS.trend} ${m.label}: ${trend.join(", ")}`} />
          <figcaption className="text-[13px] font-medium text-body">{PROGRESS_LABELS.trend}</figcaption>
        </figure>
      </div>
      {m.delta_text && <p className="mt-3 text-base font-semibold text-copper-ink">{m.delta_text}</p>}
      <p className="mt-1 text-base text-body">{m.status_text}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
        {([
          [PROGRESS_LABELS.current, fmt(m.current, m.unit)],
          [PROGRESS_LABELS.previous, fmt(m.previous, m.unit)],
          [PROGRESS_LABELS.target, fmt(m.target, m.unit)],
        ] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[13px] font-medium text-body">{k}</dt>
            <dd className="text-base font-semibold text-navy">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
