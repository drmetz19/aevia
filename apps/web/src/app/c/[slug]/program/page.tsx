import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgramCard } from "@/components/ProgramCard";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, card, linkCls } from "@/components/PageIntro";
import { fetchClinic } from "@/lib/api";
import { fetchPrograms, requirePatient } from "@/lib/session";

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
              <ProgramCard key={p.id} p={p} delay={i + 1} href={`/c/${slug}/konsultasi?program=${p.id}`} cta="Siapkan konsultasi" />
            ))}
          </ul>
        )}
        <Link href={`/c/${slug}/beranda`} className={`mt-8 inline-block ${linkCls}`}>
          Kembali ke beranda
        </Link>
    </PatientShell>
  );
}
