import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardList, MessagesSquare, Repeat2, Stethoscope } from "lucide-react";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) return { title: "Klinik tidak ditemukan" };
  return { title: `${clinic.name} — Pendampingan kesehatan personal` };
}

const steps = [
  { title: "Assessment", desc: "Jawab pertanyaan singkat bersama Sovia.", Icon: ClipboardList },
  { title: "Konsultasi", desc: "Bertemu profesional klinik untuk menelaah kondisi Anda.", Icon: Stethoscope },
  { title: "Rencana personal", desc: "Langkah yang disusun dan ditinjau profesional.", Icon: MessagesSquare },
  { title: "Follow-up & progres", desc: "Check-in berkala agar perkembangan terlihat jelas.", Icon: Repeat2 },
];

export default async function ClinicLanding({ params }: Props) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();

  const white = clinic.brand_mode === "whitelabel";
  const assistant = clinic.assistant_name;
  const eyebrow = white ? (clinic.tagline ?? clinic.name) : "Guidance for Better Aging.";

  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main>
        <section className="hero-atmos text-white">
          <div aria-hidden="true" className="orb" />
          <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-24">
            <p className="reveal inline-flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-copper-light">
              <span aria-hidden="true" className="h-px w-8 bg-copper-light" />{eyebrow}
            </p>
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="reveal mt-5 max-w-3xl font-serif text-[32px] leading-[1.15] sm:text-4xl md:text-5xl md:leading-[56px]">
              Pendampingan kesehatan yang <em className="text-gradient-copper">tenang</em>, terarah, dan personal.
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="reveal mt-5 max-w-xl text-base text-white/80 sm:text-lg">
              Mulai dari memahami kondisi Anda hari ini, lalu berjalan bersama tim profesional {clinic.name} menuju
              rencana yang sesuai untuk Anda.
            </p>
            <div style={{ "--d": 3 } as React.CSSProperties} className="reveal mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={`/c/${clinic.slug}/assessment`}
              className="inline-flex justify-center items-center gap-2 rounded-pill bg-copper w-full text-center px-6 py-3.5 text-base font-semibold sm:px-7 sm:text-lg sm:w-auto text-white shadow-soft"
            >
              Mulai assessment <ArrowRight aria-hidden="true" size={18} strokeWidth={1.5} />
            </Link>
            <Link
              href={`/c/${clinic.slug}/masuk`}
              className="inline-flex w-full items-center justify-center rounded-pill border border-white/60 px-6 py-3.5 text-base font-semibold text-white sm:w-auto"
            >
              Masuk
            </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="alur" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Alur pendampingan</p>
          <h2 id="alur" className="mt-2 text-2xl font-semibold leading-8 sm:text-[28px] sm:leading-9 text-navy">
            Empat langkah, satu perjalanan
          </h2>
          <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
            {steps.map(({ title, desc, Icon }, i) => (
              <li key={title} style={{ "--d": i + 2 } as React.CSSProperties} className="reveal card-lift relative overflow-hidden rounded-lg border border-line bg-surface p-5 shadow-soft">
                <span aria-hidden="true" className="numeral pointer-events-none absolute -right-1 -top-2 text-[88px]">{i + 1}</span>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-sand text-copper-ink">
                    <Icon aria-hidden="true" size={22} strokeWidth={1.5} />
                  </span>
                  <span className="sr-only">Langkah {i + 1}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold leading-7 text-navy">{title}</h3>
                <p className="mt-1 text-base text-body">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="sovia" className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-6 md:flex-row md:items-center">
            <Image
              src={clinic.avatar_url ?? "/sovia-avatar.png"}
              alt={`Avatar ${assistant}, asisten AI`}
              width={88}
              height={88}
              className="h-[88px] w-[88px] shrink-0 rounded-pill object-cover ring-4 ring-sand ring-offset-2 ring-offset-surface"
              unoptimized={Boolean(clinic.avatar_url)}
            />
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">
                {white ? `${assistant} · AI Guide` : `${assistant} · AI Guide by AEVIA`}
              </p>
              <h2 id="sovia" className="mt-1 text-xl font-semibold leading-7 text-navy">
                Halo, saya {assistant}. Saya akan menemani Anda menyiapkan konsultasi.
              </h2>
              <p className="mt-2 text-base text-body">
                Saya membantu merangkum keluhan dan tujuan Anda agar waktu bersama profesional lebih bermakna. Saya
                tidak memberi diagnosis; setiap rencana ditinjau dan disetujui profesional klinik.
              </p>
              <p className="mt-3 inline-flex items-center gap-2 rounded-pill border border-line px-3 py-1 text-[13px] font-medium text-navy">
                <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-copper" />
                {assistant} adalah AI
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line bg-surface">
        <p className="mx-auto max-w-6xl px-4 py-6 text-[13px] font-medium text-slate md:px-8">
          Hasil assessment bukan diagnosis. © {clinic.name} ·{" "}
          <Link href={`/c/${slug}/syarat`} className="underline underline-offset-4">
            Syarat &amp; ketentuan
          </Link>
        </p>
      </footer>
    </div>
  );
}
