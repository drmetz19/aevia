import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot } from "lucide-react";
import { COMPLETION_LINE, RESULT_LINES, areaLabel, type Level } from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnPrimary, card, linkCls } from "@/components/PageIntro";
import { SoviaHeader } from "@/components/SoviaHeader";
import { fetchClinic } from "@/lib/api";
import { getLatestAssessment, requirePatient } from "@/lib/session";

const levelIcon: Record<Level, { Icon: typeof CheckCircle2; cls: string; bar: string }> = {
  stable: { Icon: CheckCircle2, cls: "text-success", bar: "border-l-success" },
  attention: { Icon: CircleDot, cls: "text-warning", bar: "border-l-warning" },
  priority: { Icon: AlertTriangle, cls: "text-critical", bar: "border-l-critical" },
};

export default async function Hasil({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const state = await getLatestAssessment(slug, true);
  if (!state?.result) redirect(`/c/${slug}/assessment`);
  const r = state.result;

  return (
    <PatientShell clinic={clinic} active="assessment" width="max-w-3xl">
        <div className="reveal mb-7 overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
          <SoviaHeader clinic={clinic} />
        </div>
        <PageIntro eyebrow="Hasil assessment" title="Gambaran awal kondisi Anda">
          <p>{COMPLETION_LINE}</p>
          <p>{RESULT_LINES[0]}</p>
          <p>
            {RESULT_LINES[1]} <strong className="font-semibold text-navy">{r.disclaimer}</strong>
          </p>
        </PageIntro>
        {state.flagged && state.emergency_message && (
          <div role="alert" className="mt-4 flex gap-3 rounded-lg border border-critical bg-surface p-4 text-base text-navy">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-critical" size={22} strokeWidth={1.5} />
            <p>{state.emergency_message}</p>
          </div>
        )}
        {r.goal && (
          <p className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-pill border border-line bg-surface px-4 py-2 text-[15px] text-body shadow-soft">
            Fokus yang Anda pilih: <strong className="font-semibold text-navy">{r.goal}</strong>
          </p>
        )}

        <section aria-labelledby="prioritas" className="hero-atmos panel-deep reveal mt-8 p-6 text-white sm:p-8">
          <h2 id="prioritas" className="text-balance font-serif text-2xl leading-tight sm:text-[28px]">
            Tiga area yang layak dibahas lebih dulu
          </h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {r.priorities.map((p, i) => (
              <li key={p} className="flex items-center gap-3 rounded-md border border-white/12 bg-white/[0.06] px-4 py-3 sm:flex-col sm:items-start">
                <span aria-hidden="true" className="font-serif text-3xl leading-none text-copper-light">{i + 1}</span>
                <span className="text-base font-semibold">{areaLabel(p)}</span>
              </li>
            ))}
          </ol>
        </section>

        <h2 className="mt-10 text-xl font-semibold leading-7 text-navy">Per area</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {r.areas.map((a, i) => {
            const { Icon, cls, bar } = levelIcon[a.level];
            return (
              <li key={a.area} style={{ "--d": i } as React.CSSProperties} className={`reveal card-lift rounded-lg border border-line border-l-4 ${bar} bg-surface p-5 shadow-soft`}>
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">{a.label}</p>
                <p className="mt-2 flex items-center gap-2 text-base font-semibold text-navy">
                  <Icon aria-hidden="true" className={cls} size={20} strokeWidth={1.5} />
                  {a.level_label}
                </p>
                <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-pill bg-sand">
                  <div className="progress-glow h-full rounded-pill" style={{ width: `${Math.max(a.score, 6)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Link href={`/c/${slug}/program`} className={btnPrimary}>
            Siapkan konsultasi <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
          </Link>
          <Link href={`/c/${slug}/beranda`} className={linkCls}>
            Kembali ke beranda
          </Link>
        </div>
        <p className="mt-8 border-t border-line pt-4 text-[13px] font-medium text-body">
          {clinic.assistant_name} adalah AI. {r.disclaimer}
        </p>
    </PatientShell>
  );
}
