import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { PROGRESS_EMPTY } from "@aevia/core";
import { ProgressCard } from "@aevia/ui/progress";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnNavy, btnPrimary, card, linkCls } from "@/components/PageIntro";
import { fetchClinic } from "@/lib/api";
import { getProgress, requirePatient } from "@/lib/session";

export default async function Progres({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ info?: string }> }) {
  const { slug } = await params;
  const { info } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const progress = await getProgress(slug);
  return (
    <PatientShell clinic={clinic} active="progres" width="max-w-3xl">
        <PageIntro eyebrow="Progres" title="Progres Anda" />
        {info === "tersimpan" && (
          <p role="status" className="reveal mt-5 rounded-md border border-success/30 bg-surface px-4 py-3 text-base text-navy shadow-soft">Selesai. Check-in Anda tersimpan. Mari lihat apa yang berubah sejak check-in terakhir.</p>
        )}
        {progress.checkin_count === 0 ? (
          <div className={`reveal mt-7 text-center ${card}`}>
            <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-sand text-copper-ink">
              <TrendingUp size={26} strokeWidth={1.75} />
            </span>
            <p role="status" className="mx-auto mt-4 max-w-sm text-base text-body">{PROGRESS_EMPTY}</p>
            <Link href={`/c/${slug}/checkin`} className={`mt-5 ${btnPrimary}`}>Mulai check-in</Link>
          </div>
        ) : (
          <>
            {progress.general && <p className="mt-2 text-base text-body">Ini gambaran umum. Setelah rencana personal Anda ditandatangani, progres akan mengikuti hal yang perlu dipantau di sana.</p>}
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {progress.metrics.map((m, i) => (
                <div key={m.key} style={{ "--d": i } as React.CSSProperties} className="reveal card-lift rounded-lg">
                  <ProgressCard metric={m} />
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
              <Link href={`/c/${slug}/checkin`} className={btnNavy}>Check-in lagi</Link>
              <Link href={`/c/${slug}/beranda`} className={linkCls}>Kembali ke beranda</Link>
            </div>
          </>
        )}
    </PatientShell>
  );
}
