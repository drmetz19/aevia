import Link from "next/link";
import { notFound } from "next/navigation";
import { scaleAnchors } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getCheckinForm, requirePatient } from "@/lib/session";
import { submitCheckinAction } from "../actions";


export default async function Checkin({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ pesan?: string }> }) {
  const { slug } = await params;
  const { pesan } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const form = await getCheckinForm(slug);
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Check-in</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Waktunya check-in singkat</h1>
        <p className="mt-2 text-base text-body">
          {form.general
            ? "Beri penilaian singkat untuk beberapa area umum. Tidak ada jawaban benar atau salah."
            : "Penilaian ini mengikuti hal yang perlu dipantau dalam rencana Anda. Tidak ada jawaban benar atau salah."}
        </p>
        <form action={submitCheckinAction} className="mt-6 space-y-5">
          <input type="hidden" name="slug" value={slug} />
          {pesan && <p role="alert" className="text-base text-critical">{pesan}</p>}
          {form.fields.map((f) => (
            <fieldset key={f.key} className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <legend className="px-1 text-xl font-semibold leading-7 text-navy">{f.label}</legend>
              {f.scale ? (
                <>
                  <p className="text-[13px] font-medium text-body">Skala 1 sampai 5 ({f.key === "stres" ? "5 = paling tenang" : "5 = paling baik"})</p>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="flex cursor-pointer flex-col items-center rounded-md border border-line bg-ivory px-1 py-3 text-base font-semibold text-navy has-[:checked]:border-navy has-[:checked]:bg-sand has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand-accent)]">
                        <input type="radio" name={`v:${f.key}`} value={n} required aria-label={`${n}, ${scaleAnchors(f.key)[n - 1]}`} className="sr-only" />
                        {n}
                        <span className="mt-1 hidden text-center text-[13px] font-medium leading-tight text-body sm:block">{scaleAnchors(f.key)[n - 1]}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-3">
                  <label htmlFor={`v-${f.key}`} className="block text-[13px] font-medium text-navy">Nilai saat ini{f.unit ? ` (${f.unit})` : ""}</label>
                  <input id={`v-${f.key}`} name={`v:${f.key}`} type="number" inputMode="decimal" step="any" min={f.min} max={f.max} className="mt-1 w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy" />
                </div>
              )}
            </fieldset>
          ))}
          <div>
            <label htmlFor="note" className="block text-[13px] font-medium text-navy">Catatan (opsional)</label>
            <textarea id="note" name="note" rows={3} maxLength={500} placeholder="Hal lain yang ingin Anda catat" className="mt-1 w-full rounded-md border border-line bg-white px-4 py-3 text-base text-navy" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft">Simpan check-in</button>
            <Link href={`/c/${slug}/beranda`} className="text-base font-semibold text-navy underline underline-offset-4">Nanti saja</Link>
          </div>
        </form>
      </main>
    </div>
  );
}
