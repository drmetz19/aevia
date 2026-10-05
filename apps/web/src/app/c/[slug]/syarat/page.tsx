import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicHeader } from "@/components/ClinicHeader";
import { PageIntro, linkCls } from "@/components/PageIntro";
import { brandStyle, fetchClinic } from "@/lib/api";

export default async function Syarat({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  return (
    <div style={brandStyle(clinic)} className="page-atmos min-h-screen">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-2xl px-4 pb-14 pt-8 sm:pt-12">
        <PageIntro eyebrow="Ketentuan layanan" title="Syarat & ketentuan">
          <p>Layanan ini dijalankan oleh {clinic.name} dengan teknologi dari AEVIA. Berikut hal-hal yang perlu Anda ketahui.</p>
        </PageIntro>
        <div className="mt-8 rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-7">
        <h2 className="text-xl font-semibold text-navy">Peran asisten AI</h2>
        <p className="mt-2 text-base text-body">
          {clinic.assistant_name} adalah asisten AI yang membantu merangkum keluhan dan tujuan Anda. Asisten tidak memberi
          diagnosis. Rencana pendampingan baru berlaku setelah ditinjau dan disetujui profesional klinik.
        </p>
        <h2 className="mt-8 text-xl font-semibold text-navy">Data Anda</h2>
        <p className="mt-2 text-base text-body">
          Data Anda disimpan terpisah untuk {clinic.name}. Anda dapat mengatur persetujuan penggunaan data kapan saja, dan
          AEVIA memprosesnya atas nama klinik sebagai penyedia teknologi.
        </p>
        </div>
        <p className="mt-8">
          <Link href={`/c/${slug}`} className={linkCls}>
            Kembali ke beranda klinik
          </Link>
        </p>
      </main>
    </div>
  );
}
