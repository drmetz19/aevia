import { notFound } from "next/navigation";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { LoginForm } from "./LoginForm";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sesi?: string }> };

export default async function Masuk({ params, searchParams }: Props) {
  const { slug } = await params;
  const { sesi } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-md px-4 py-12">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Masuk</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-9 text-navy">Masuk ke {clinic.name}</h1>
          <p className="mt-2 text-base text-body">Cukup dengan email. Kami kirim kode sekali pakai, tanpa kata sandi.</p>
          <div className="mt-6">
            <LoginForm slug={clinic.slug} ended={sesi === "berakhir"} />
          </div>
        </div>
      </main>
    </div>
  );
}
