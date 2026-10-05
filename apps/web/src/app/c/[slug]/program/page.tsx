import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock } from "lucide-react";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnNavy, card, linkCls } from "@/components/PageIntro";
import { fetchClinic } from "@/lib/api";
import { fetchPrograms, requirePatient, rupiah } from "@/lib/session";

export default async function Program({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const programs = await fetchPrograms(slug);
  return (
    <PatientShell clinic={clinic} active="program" width="max-w-5xl">
        <PageIntro eyebrow="Program" title="Pilih pendampingan yang sesuai">
          <p>Biaya ditetapkan oleh {clinic.name}. Anda baru mengajukan permintaan; tim klinik akan meninjau dan menghubungi Anda.</p>
        </PageIntro>
        {programs.length === 0 ? (
          <p className={`mt-8 text-base text-body ${card}`}>Program akan segera tersedia di klinik ini.</p>
        ) : (
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {programs.map((p, i) => (
              <li
                key={p.id}
                style={{ "--d": i + 1 } as React.CSSProperties}
                className="reveal card-lift relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-6"
              >
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-copper via-copper/60 to-transparent" />
                <p className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-sand px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-copper-ink">
                  <Clock aria-hidden="true" size={13} strokeWidth={2} />
                  {p.duration_weeks ? `${p.duration_weeks} minggu` : "Konsultasi"}
                </p>
                <h2 className="mt-3 text-xl font-semibold leading-7 text-navy">{p.name}</h2>
                <p className="mt-2 text-base text-body">{p.summary}</p>
                <ul className="mt-4 flex-1 space-y-2">
                  {p.includes.map((i) => (
                    <li key={i} className="flex gap-2 text-base text-navy">
                      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-sand text-copper-ink">
                        <Check size={13} strokeWidth={2.5} />
                      </span>
                      {i}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 border-t border-dashed border-line pt-5">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate">Biaya</p>
                  <p className="font-serif text-[32px] leading-tight text-navy">{rupiah(p.price_idr)}</p>
                </div>
                <Link href={`/c/${slug}/konsultasi?program=${p.id}`} className={`mt-4 ${btnNavy} sm:w-full`}>
                  Siapkan konsultasi <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/c/${slug}/beranda`} className={`mt-8 inline-block ${linkCls}`}>
          Kembali ke beranda
        </Link>
    </PatientShell>
  );
}
