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
      <section className="hero-atmos text-white">
        <div aria-hidden="true" className="orb" />
        <div className="mx-auto max-w-md px-4 pb-24 pt-10 sm:pt-14">
          <p className="reveal inline-flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-copper-light">
            <span aria-hidden="true" className="h-px w-6 bg-copper-light" />
            Masuk
          </p>
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="reveal mt-2 text-balance font-serif text-[32px] leading-[1.15] sm:text-4xl">
            Masuk ke {clinic.name}
          </h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="reveal mt-3 text-base text-white/75">
            Cukup dengan email. Kami kirim kode sekali pakai, tanpa kata sandi.
          </p>
        </div>
      </section>
      <main className="mx-auto -mt-16 max-w-md px-4 pb-14">
        <div style={{ "--d": 3 } as React.CSSProperties} className="reveal relative rounded-lg border border-line bg-surface p-5 shadow-[0_2px_4px_rgba(11,31,58,0.06),0_24px_48px_-12px_rgba(11,31,58,0.22)] sm:p-7">
          <span aria-hidden="true" className="absolute -top-6 left-5 flex h-12 w-12 items-center justify-center rounded-pill bg-copper text-white shadow-soft ring-4 ring-surface sm:left-7">
            <KeyRound size={22} strokeWidth={1.75} />
          </span>
          <div className="mt-5">
            <LoginForm slug={clinic.slug} ended={sesi === "berakhir"} />
          </div>
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
