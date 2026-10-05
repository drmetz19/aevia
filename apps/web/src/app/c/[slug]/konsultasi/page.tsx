import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Send } from "lucide-react";
import { PREP_INTRO, PREP_NOTE } from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnPrimary, card } from "@/components/PageIntro";
import { SoviaAvatar } from "@/components/SoviaHeader";
import { fetchClinic } from "@/lib/api";
import { fetchPrograms, getDraft, getMyRequests, requirePatient, rupiah } from "@/lib/session";
import { submitRequestAction } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ program?: string; pesan?: string }> };
const field = "field";
const label = "flex items-center gap-2 text-[14px] font-semibold text-navy";
const Num = ({ n }: { n: number }) => (
  <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-pill bg-sand text-[12px] font-bold text-copper-ink">{n}</span>
);

export default async function Konsultasi({ params, searchParams }: Props) {
  const { slug } = await params;
  const { program: programId, pesan } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const programs = await fetchPrograms(slug);
  const program = programs.find((p) => p.id === programId);
  if (!program) redirect(`/c/${slug}/program`);
  const open = (await getMyRequests(slug)).find((r) => r.program_id === program.id && r.status === "submitted");
  const draft = await getDraft(slug);
  const prep = draft.prep;
  const name = clinic.assistant_name;

  return (
    <PatientShell clinic={clinic} active="program" width="max-w-5xl">
        <PageIntro eyebrow="Siapkan konsultasi" title="Hal yang ingin dibahas bersama profesional" />

        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section aria-labelledby="form-prep">
            <h2 id="form-prep" className="sr-only">Formulir persiapan</h2>
            <div className="reveal flex gap-3 rounded-lg border border-sand bg-sand/70 p-4 text-base text-navy">
              <SoviaAvatar clinic={clinic} size={36} />
              <div>
                <p>{PREP_INTRO}</p>
                <p className="mt-1">{PREP_NOTE.replace("Sovia", name)}</p>
                <p className="mt-2 inline-flex items-center gap-2 text-[13px] font-medium">
                  <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-copper" />
                  Draf dari {name}, siap Anda ubah. {name} adalah AI.
                </p>
              </div>
            </div>
            {open ? (
              <p role="status" className={`mt-6 text-base text-navy ${card}`}>
                Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik.{" "}
                <Link href={`/c/${slug}/beranda`} className="font-semibold underline underline-offset-4">
                  Lihat status
                </Link>
              </p>
            ) : (
              <form action={submitRequestAction} className={`mt-6 space-y-6 ${card}`}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="program_id" value={program.id} />
                {pesan && (
                  <p role="alert" className="text-base text-critical">
                    {pesan}
                  </p>
                )}
                <div>
                  <label htmlFor="tujuan" className={label}><Num n={1} />Tujuan utama konsultasi</label>
                  <textarea id="tujuan" name="tujuan" rows={2} maxLength={600} required defaultValue={prep.tujuan} className={`mt-2 ${field}`} />
                </div>
                <div>
                  <label htmlFor="keluhan" className={label}><Num n={2} />Keluhan atau hal yang dirasakan</label>
                  <textarea id="keluhan" name="keluhan" rows={4} maxLength={1200} defaultValue={prep.keluhan} className={`mt-2 ${field}`} />
                </div>
                <div>
                  <label htmlFor="pertanyaan" className={label}><Num n={3} />Pertanyaan untuk profesional (satu per baris)</label>
                  <textarea id="pertanyaan" name="pertanyaan" rows={4} defaultValue={prep.pertanyaan.join("\n")} className={`mt-2 ${field}`} />
                </div>
                <div>
                  <label htmlFor="konteks" className={label}><Num n={4} />Konteks dari assessment</label>
                  <textarea id="konteks" name="konteks_assessment" rows={3} maxLength={1200} defaultValue={prep.konteks_assessment} className={`mt-2 ${field}`} />
                </div>
                <button type="submit" className={btnPrimary}>
                  <Send aria-hidden="true" size={18} strokeWidth={1.75} /> Kirim permintaan konsultasi
                </button>
              </form>
            )}
          </section>

          <aside aria-label="Program yang dipilih" className="hero-atmos panel-deep order-first h-fit p-5 text-white sm:p-6 lg:sticky lg:top-24 lg:order-none">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-copper-light">Program dipilih</p>
            <h2 className="mt-1 text-xl font-semibold leading-7">{program.name}</h2>
            <p className="mt-2 hidden text-[15px] text-white/75 sm:block">{program.summary}</p>
            <p className="mt-3 font-serif text-[32px] leading-tight">{rupiah(program.price_idr)}</p>
            <Link href={`/c/${slug}/program`} className="mt-3 inline-block text-[15px] font-semibold text-white underline decoration-copper-light decoration-2 underline-offset-4">
              Pilih program lain
            </Link>
            {!draft.from_assessment && (
              <p className="mt-4 text-[13px] font-medium text-white/75">
                Belum ada hasil assessment.{" "}
                <Link href={`/c/${slug}/assessment`} className="underline underline-offset-4">Mulai assessment</Link> agar draf terisi otomatis.
              </p>
            )}
          </aside>
        </div>
    </PatientShell>
  );
}
