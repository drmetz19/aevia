import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PREP_INTRO, PREP_NOTE } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { SoviaAvatar } from "@/components/SoviaHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { fetchPrograms, getDraft, getMyRequests, requirePatient, rupiah } from "@/lib/session";
import { submitRequestAction } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ program?: string; pesan?: string }> };
const field = "w-full rounded-md border border-line bg-surface px-4 py-3 text-base text-navy";
const label = "block text-[13px] font-medium text-navy";

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
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Siapkan konsultasi</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Hal yang ingin dibahas bersama profesional</h1>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="form-prep">
            <h2 id="form-prep" className="sr-only">Formulir persiapan</h2>
            <div className="flex gap-3 rounded-lg bg-sand p-4 text-base text-navy">
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
              <p role="status" className="mt-6 rounded-lg border border-line bg-surface p-5 text-base text-navy">
                Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik.{" "}
                <Link href={`/c/${slug}/beranda`} className="font-semibold underline underline-offset-4">
                  Lihat status
                </Link>
              </p>
            ) : (
              <form action={submitRequestAction} className="mt-6 space-y-5 rounded-lg border border-line bg-surface p-6 shadow-soft">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="program_id" value={program.id} />
                {pesan && (
                  <p role="alert" className="text-base text-critical">
                    {pesan}
                  </p>
                )}
                <div>
                  <label htmlFor="tujuan" className={label}>Tujuan utama konsultasi</label>
                  <textarea id="tujuan" name="tujuan" rows={2} maxLength={600} required defaultValue={prep.tujuan} className={`mt-1 ${field}`} />
                </div>
                <div>
                  <label htmlFor="keluhan" className={label}>Keluhan atau hal yang dirasakan</label>
                  <textarea id="keluhan" name="keluhan" rows={4} maxLength={1200} defaultValue={prep.keluhan} className={`mt-1 ${field}`} />
                </div>
                <div>
                  <label htmlFor="pertanyaan" className={label}>Pertanyaan untuk profesional (satu per baris)</label>
                  <textarea id="pertanyaan" name="pertanyaan" rows={4} defaultValue={prep.pertanyaan.join("\n")} className={`mt-1 ${field}`} />
                </div>
                <div>
                  <label htmlFor="konteks" className={label}>Konteks dari assessment</label>
                  <textarea id="konteks" name="konteks_assessment" rows={3} maxLength={1200} defaultValue={prep.konteks_assessment} className={`mt-1 ${field}`} />
                </div>
                <button type="submit" className="w-full rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft sm:w-auto">
                  Kirim permintaan konsultasi
                </button>
              </form>
            )}
          </section>

          <aside aria-label="Program yang dipilih" className="h-fit rounded-lg border border-line bg-surface p-6 shadow-soft">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Program dipilih</p>
            <h2 className="mt-1 text-xl font-semibold leading-7 text-navy">{program.name}</h2>
            <p className="mt-2 text-base text-body">{program.summary}</p>
            <p className="mt-4 font-serif text-3xl text-navy">{rupiah(program.price_idr)}</p>
            <Link href={`/c/${slug}/program`} className="mt-4 inline-block text-base font-semibold text-navy underline underline-offset-4">
              Pilih program lain
            </Link>
            {!draft.from_assessment && (
              <p className="mt-4 text-[13px] font-medium text-body">
                Belum ada hasil assessment.{" "}
                <Link href={`/c/${slug}/assessment`} className="underline underline-offset-4">Mulai assessment</Link> agar draf terisi otomatis.
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
