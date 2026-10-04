import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";

export default async function KonsultasiStub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-serif text-4xl text-navy">Persiapan konsultasi segera hadir</h1>
        <p className="mt-4 text-body">Kami sedang menyiapkan langkah berikutnya untuk Anda.</p>
        <Link href={`/c/${slug}/beranda`} className="mt-6 inline-block rounded-pill border border-navy px-6 py-3 font-semibold text-navy">
          Kembali ke beranda
        </Link>
      </main>
    </div>
  );
}
