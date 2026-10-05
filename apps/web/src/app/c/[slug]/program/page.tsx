import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { fetchPrograms, requirePatient, rupiah } from "@/lib/session";

export default async function Program({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const programs = await fetchPrograms(slug);
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Program</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Pilih pendampingan yang sesuai</h1>
        <p className="mt-2 max-w-xl text-base text-body">
          Biaya ditetapkan oleh {clinic.name}. Anda baru mengajukan permintaan; tim klinik akan meninjau dan menghubungi Anda.
        </p>
        {programs.length === 0 ? (
          <p className="mt-8 rounded-lg border border-line bg-surface p-6 text-base text-body">Program akan segera tersedia di klinik ini.</p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {programs.map((p) => (
              <li key={p.id} className="flex flex-col rounded-lg border border-line bg-surface p-6 shadow-soft">
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">
                  {p.duration_weeks ? `${p.duration_weeks} minggu` : "Konsultasi"}
                </p>
                <h2 className="mt-1 text-xl font-semibold leading-7 text-navy">{p.name}</h2>
                <p className="mt-2 text-base text-body">{p.summary}</p>
                <ul className="mt-4 space-y-2">
                  {p.includes.map((i) => (
                    <li key={i} className="flex gap-2 text-base text-navy">
                      <Check aria-hidden="true" size={18} strokeWidth={1.5} className="mt-1 shrink-0 text-copper-ink" />
                      {i}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 font-serif text-3xl text-navy">{rupiah(p.price_idr)}</p>
                <Link
                  href={`/c/${slug}/konsultasi?program=${p.id}`}
                  className="mt-4 inline-flex justify-center rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white"
                >
                  Siapkan konsultasi
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/c/${slug}/beranda`} className="mt-8 inline-block text-base font-semibold text-navy underline underline-offset-4">
          Kembali ke beranda
        </Link>
      </main>
    </div>
  );
}
