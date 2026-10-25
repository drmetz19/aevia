import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock, Ticket } from "lucide-react";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, btnPrimary, card, linkCls } from "@/components/PageIntro";
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
          <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {programs.map((p, i) => (
              <li
                key={p.id}
                style={{ "--d": i + 1 } as React.CSSProperties}
                className="reveal card-lift flex flex-col rounded-lg border border-line bg-surface p-4 sm:p-6"
              >
                <p className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                  <Clock aria-hidden="true" size={13} strokeWidth={1.75} />
                  {p.duration_weeks ? `Durasi ${p.duration_weeks} minggu` : "Konsultasi"}
                </p>
                {p.access === "voucher" && (
                  <p className="mt-2">
                    <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-sand px-2 py-0.5 text-[11px] font-semibold text-navy">
                      <Ticket aria-hidden="true" size={12} strokeWidth={1.75} />
                      Perlu kode voucher
                    </span>
                  </p>
                )}
                <h2 className="mt-3 text-xl font-semibold leading-7 text-navy">{p.name}</h2>
                <p className="mt-2 text-base text-body">{p.summary}</p>
                <ul className="mt-4 mb-5 flex-1 space-y-2">
                  {p.includes.map((i) => (
                    <li key={i} className="flex gap-2 text-base text-navy">
                      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-success/10 text-success">
                        <Check size={13} strokeWidth={2.5} />
                      </span>
                      {i}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto border-t border-line pt-4">
                  <p className="text-[12px] font-semibold leading-4 text-slate">{p.price_mode === "coming_soon" ? "Harga" : "Total biaya program"}</p>
                  <p className="text-[28px] font-bold leading-9 text-navy [font-variant-numeric:tabular-nums]">
                    {p.price_mode === "coming_soon" ? "Segera hadir" : rupiah(p.price_idr)}
                  </p>
                </div>
                <Link href={`/c/${slug}/konsultasi?program=${p.id}`} className={`mt-4 ${btnPrimary} sm:w-full`}>
                  Siapkan konsultasi <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
                </Link>
                <p className="mt-2 min-h-[18px] text-center text-[13px] leading-[18px] text-slate">
                  {p.access === "voucher" ? "Siapkan kode voucher dari klinik." : ""}
                </p>
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
