import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { PREP_INTRO, PREP_NOTE } from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { IntakeStepper } from "@/components/IntakeStepper";
import { PageIntro, card } from "@/components/PageIntro";
import { SoviaAvatar } from "@/components/SoviaHeader";
import { fetchClinic } from "@/lib/api";
import { fetchPrograms, getDraft, getMyRequests, requirePatient, rupiah } from "@/lib/session";
import { IntakeForm } from "./IntakeForm";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ program?: string; pesan?: string }> };
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
        <IntakeStepper assessmentDone={draft.from_assessment} />
        <div className="mt-6">
          <PageIntro eyebrow="Siapkan konsultasi" title="Hal yang ingin dibahas bersama profesional" />
        </div>

        <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="form-prep">
            <h2 id="form-prep" className="sr-only">Formulir persiapan</h2>
            <div className="reveal flex gap-3 rounded-lg border border-line bg-sand p-4 text-base text-navy">
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
              <div className={`mt-6 ${card}`}>
                <IntakeForm slug={slug} programId={program.id} voucherRequired={program.access === "voucher"} prep={prep} initialMessage={pesan} />
              </div>
            )}
          </section>

          <aside aria-label="Ringkasan program" className="h-fit space-y-4 lg:sticky lg:top-24">
            <div className={card}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">Program dipilih</p>
              <h2 className="mt-1 text-xl font-semibold leading-7 text-navy">{program.name}</h2>
              <p className="mt-1 text-[13px] font-medium text-slate">{program.duration_weeks ? `Durasi ${program.duration_weeks} minggu` : "Konsultasi"} · {clinic.name}</p>
              {program.summary && <p className="mt-2 hidden text-[15px] text-body sm:block">{program.summary}</p>}
              <p className="mt-4 text-[28px] font-bold leading-9 text-navy [font-variant-numeric:tabular-nums]">
                {program.price_mode === "coming_soon" ? "Segera hadir" : rupiah(program.price_idr)}
              </p>
              {program.includes.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-line pt-4">
                  {program.includes.map((i) => (
                    <li key={i} className="flex gap-2 text-[15px] text-navy">
                      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-success/10 text-success">
                        <Check size={13} strokeWidth={2.5} />
                      </span>
                      {i}
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/c/${slug}/program`} className="mt-4 inline-block text-[15px] font-semibold text-copper-ink underline decoration-copper decoration-2 underline-offset-4">
                Pilih program lain
              </Link>
              {!draft.from_assessment && (
                <p className="mt-4 text-[13px] font-medium text-body">
                  Belum ada hasil assessment.{" "}
                  <Link href={`/c/${slug}/assessment`} className="underline underline-offset-4">Mulai assessment</Link> agar draf terisi otomatis.
                </p>
              )}
            </div>
            <div className="flex gap-3 rounded-lg border border-line bg-surface p-4 text-[14px] text-body">
              <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-copper" />
              <p>Data Anda disimpan terpisah untuk {clinic.name} dan hanya dapat dibuka oleh tim klinis klinik ini.</p>
            </div>
          </aside>
        </div>
    </PatientShell>
  );
}
