import Link from "next/link";
import { notFound } from "next/navigation";
import { PROGRESS_EMPTY } from "@aevia/core";
import { ProgressCard } from "@aevia/ui/progress";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getProgress, requirePatient } from "@/lib/session";

export default async function Progres({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ info?: string }> }) {
  const { slug } = await params;
  const { info } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const progress = await getProgress(slug);
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Progres</p>
        <h1 className="mt-1 font-serif text-[28px] leading-[1.2] sm:text-4xl sm:leading-tight text-navy">Progres Anda</h1>
        {info === "tersimpan" && (
          <p role="status" className="mt-4 rounded-md bg-sand px-4 py-3 text-base text-navy">Selesai. Check-in Anda tersimpan. Mari lihat apa yang berubah sejak check-in terakhir.</p>
        )}
        {progress.checkin_count === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-6">
            <p role="status" className="text-base text-body">{PROGRESS_EMPTY}</p>
            <Link href={`/c/${slug}/checkin`} className="mt-4 inline-flex justify-center rounded-pill bg-copper w-full text-center px-6 py-3.5 text-base font-semibold sm:px-7 sm:text-lg sm:w-auto text-white shadow-soft">Mulai check-in</Link>
          </div>
        ) : (
          <>
            {progress.general && <p className="mt-2 text-base text-body">Ini gambaran umum. Setelah rencana personal Anda ditandatangani, progres akan mengikuti hal yang perlu dipantau di sana.</p>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {progress.metrics.map((m) => <ProgressCard key={m.key} metric={m} />)}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href={`/c/${slug}/checkin`} className="rounded-pill bg-navy px-6 py-3.5 text-base font-semibold text-white w-full text-center sm:w-auto sm:px-7">Check-in lagi</Link>
              <Link href={`/c/${slug}/beranda`} className="text-base font-semibold text-navy underline underline-offset-4">Kembali ke beranda</Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
