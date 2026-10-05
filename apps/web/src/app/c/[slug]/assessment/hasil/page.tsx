import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDot } from "lucide-react";
import { COMPLETION_LINE, RESULT_LINES, areaLabel, type Level } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { SoviaHeader } from "@/components/SoviaHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getLatestAssessment, requirePatient } from "@/lib/session";

const levelIcon: Record<Level, { Icon: typeof CheckCircle2; cls: string }> = {
  stable: { Icon: CheckCircle2, cls: "text-success" },
  attention: { Icon: CircleDot, cls: "text-warning" },
  priority: { Icon: AlertTriangle, cls: "text-critical" },
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
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
          <SoviaHeader clinic={clinic} />
        </div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Hasil assessment</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Gambaran awal kondisi Anda</h1>
        <p className="mt-2 text-base text-body">
          {COMPLETION_LINE}
        </p>
        <p className="mt-2 text-base text-body">{RESULT_LINES[0]}</p>
        <p className="mt-2 text-base text-body">
          {RESULT_LINES[1]} <strong className="font-semibold text-navy">{r.disclaimer}</strong>
        </p>
        {state.flagged && state.emergency_message && (
          <div role="alert" className="mt-4 flex gap-3 rounded-lg border border-critical bg-surface p-4 text-base text-navy">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-critical" size={22} strokeWidth={1.5} />
            <p>{state.emergency_message}</p>
          </div>
        )}
        {r.goal && (
          <p className="mt-4 text-base text-body">
            Fokus yang Anda pilih: <strong className="font-semibold text-navy">{r.goal}</strong>
          </p>
        )}

        <section aria-labelledby="prioritas" className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-soft">
          <h2 id="prioritas" className="text-xl font-semibold leading-7 text-navy">
            Tiga area yang layak dibahas lebih dulu
          </h2>
          <ol className="mt-3 list-inside list-decimal space-y-1 text-base text-navy">
            {r.priorities.map((p) => (
              <li key={p}>{areaLabel(p)}</li>
            ))}
          </ol>
        </section>

        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {r.areas.map((a) => {
            const { Icon, cls } = levelIcon[a.level];
            return (
              <li key={a.area} className="rounded-lg border border-line bg-surface p-5 shadow-soft">
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">{a.label}</p>
                <p className="mt-2 flex items-center gap-2 text-base font-semibold text-navy">
                  <Icon aria-hidden="true" className={cls} size={20} strokeWidth={1.5} />
                  {a.level_label}
                </p>
                <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-pill bg-sand">
                  <div className="h-full bg-copper" style={{ width: `${Math.max(a.score, 6)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href={`/c/${slug}/program`} className="inline-flex rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft">
            Siapkan konsultasi
          </Link>
          <Link href={`/c/${slug}/beranda`} className="text-base font-semibold text-navy underline underline-offset-4">
            Kembali ke beranda
          </Link>
        </div>
        <p className="mt-6 text-[13px] font-medium text-body">
          {clinic.assistant_name} adalah AI. {r.disclaimer}
        </p>
      </main>
    </div>
  );
}
