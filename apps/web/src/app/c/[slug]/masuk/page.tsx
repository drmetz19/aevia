import { PageIntro } from "@/components/PageIntro";
import { notFound } from "next/navigation";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
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
    <div style={brandStyle(clinic)} className="page-atmos min-h-screen">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-md px-4 pb-14 pt-8 sm:pt-12">
        <PageIntro eyebrow="Masuk" title={`Masuk ke ${clinic.name}`}>
          <p>Cukup dengan email. Kami kirim kode sekali pakai, tanpa kata sandi.</p>
        </PageIntro>
        <div style={{ "--d": 3 } as React.CSSProperties} className="reveal mt-6 rounded-lg border border-line bg-surface p-4 sm:p-6">
          <span aria-hidden="true" className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-sand text-copper-ink">
            <KeyRound size={20} strokeWidth={1.75} />
          </span>
          <LoginForm slug={clinic.slug} ended={sesi === "berakhir"} />
        </div>
        <p className="mt-6 flex items-start justify-center gap-2 text-center text-[13px] font-medium text-slate">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>
            Dengan masuk, Anda menyetujui{" "}
            <Link href={`/c/${clinic.slug}/syarat`} className="underline underline-offset-4">
              syarat &amp; ketentuan
            </Link>
            .
          </span>
        </p>
      </main>
    </div>
  );
}
