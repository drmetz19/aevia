import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";

export default async function Syarat({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-serif text-4xl leading-tight text-navy">Syarat &amp; ketentuan</h1>
        <p className="mt-3 text-base text-body">
          Layanan ini dijalankan oleh {clinic.name} dengan teknologi dari AEVIA. Berikut hal-hal yang perlu Anda ketahui.
        </p>
        <h2 className="mt-8 text-xl font-semibold text-navy">Peran asisten AI</h2>
        <p className="mt-2 text-base text-body">
          {clinic.assistant_name} adalah asisten AI yang membantu merangkum keluhan dan tujuan Anda. Asisten tidak memberi
          diagnosis. Rencana pendampingan baru berlaku setelah ditinjau dan disetujui profesional klinik.
        </p>
        <h2 className="mt-8 text-xl font-semibold text-navy">Data Anda</h2>
        <p className="mt-2 text-base text-body">
          Data Anda disimpan terpisah untuk {clinic.name}. Anda dapat mengatur persetujuan penggunaan data kapan saja, dan
          AEVIA memprosesnya atas nama klinik sebagai penyedia teknologi.
        </p>
        <p className="mt-8">
          <Link href={`/c/${slug}`} className="text-base font-semibold text-copper-ink underline underline-offset-4">
            Kembali ke beranda klinik
          </Link>
        </p>
      </main>
    </div>
  );
}
