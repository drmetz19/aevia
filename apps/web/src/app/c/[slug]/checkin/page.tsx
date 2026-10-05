import Link from "next/link";
import { notFound } from "next/navigation";
import { scaleAnchors } from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnPrimary, linkCls } from "@/components/PageIntro";
import { fetchClinic } from "@/lib/api";
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
    <PatientShell clinic={clinic} active="progres" width="max-w-2xl">
        <PageIntro eyebrow="Check-in" title="Waktunya check-in singkat">
          <p>
            {form.general
            ? "Beri penilaian singkat untuk beberapa area umum. Tidak ada jawaban benar atau salah."
            : "Penilaian ini mengikuti hal yang perlu dipantau dalam rencana Anda. Tidak ada jawaban benar atau salah."}
          </p>
        </PageIntro>
        <form action={submitCheckinAction} className="mt-6 space-y-5">
          <input type="hidden" name="slug" value={slug} />
          {pesan && <p role="alert" className="text-base text-critical">{pesan}</p>}
          {form.fields.map((f) => (
            <fieldset key={f.key} className="reveal rounded-lg border border-line bg-surface p-5 shadow-soft">
              <legend className="float-left w-full text-lg font-semibold leading-7 text-navy">{f.label}</legend>
              {f.scale ? (
                <>
                  <p className="clear-both pt-0.5 text-[13px] font-medium text-body">Skala 1 sampai 5 ({f.key === "stres" ? "5 = paling tenang" : "5 = paling baik"})</p>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="flex cursor-pointer flex-col items-center rounded-md border border-line bg-ivory px-1 py-3 font-serif text-xl text-navy transition active:scale-95 has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-white has-[:checked]:shadow-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand-accent)]">
                        <input type="radio" name={`v:${f.key}`} value={n} required aria-label={`${n}, ${scaleAnchors(f.key)[n - 1]}`} className="sr-only" />
                        {n}
                        <span className="mt-1 hidden text-center font-sans text-[12px] font-medium leading-tight opacity-80 sm:block">{scaleAnchors(f.key)[n - 1]}</span>
                      </label>
                    ))}
                  </div>
                  <p aria-hidden="true" className="mt-2 flex justify-between gap-3 text-[12px] font-medium text-slate sm:hidden">
                    <span>1 · {scaleAnchors(f.key)[0]}</span>
                    <span className="text-right">5 · {scaleAnchors(f.key)[4]}</span>
                  </p>
                </>
              ) : (
                <div className="clear-both pt-3">
                  <label htmlFor={`v-${f.key}`} className="block text-[13px] font-semibold text-navy">Nilai saat ini{f.unit ? ` (${f.unit})` : ""}</label>
                  <input id={`v-${f.key}`} name={`v:${f.key}`} type="number" inputMode="decimal" step="any" min={f.min} max={f.max} className="field mt-1" />
                </div>
              )}
            </fieldset>
          ))}
          <div>
            <label htmlFor="note" className="block text-[13px] font-semibold text-navy">Catatan (opsional)</label>
            <textarea id="note" name="note" rows={3} maxLength={500} placeholder="Hal lain yang ingin Anda catat" className="field mt-1" />
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <button type="submit" className={btnPrimary}>Simpan check-in</button>
            <Link href={`/c/${slug}/beranda`} className={linkCls}>Nanti saja</Link>
          </div>
        </form>
    </PatientShell>
  );
}
