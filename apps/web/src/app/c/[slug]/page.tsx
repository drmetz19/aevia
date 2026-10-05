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
        <section className="bg-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-24">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-light">{eyebrow}</p>
            <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-[1.15] md:text-5xl md:leading-[56px]">
              Pendampingan kesehatan yang tenang, terarah, dan personal.
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/80">
              Mulai dari memahami kondisi Anda hari ini, lalu berjalan bersama tim profesional {clinic.name} menuju
              rencana yang sesuai untuk Anda.
            </p>
            <Link
              href={`/c/${clinic.slug}/assessment`}
              className="mt-8 inline-flex items-center gap-2 rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft"
            >
              Mulai assessment <ArrowRight aria-hidden="true" size={18} strokeWidth={1.5} />
            </Link>
            <Link
              href={`/c/${clinic.slug}/masuk`}
              className="ml-3 mt-8 inline-flex items-center rounded-pill border border-white/60 px-6 py-3 text-base font-semibold text-white"
            >
              Masuk
            </Link>
          </div>
        </section>

        <section aria-labelledby="alur" className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Alur pendampingan</p>
          <h2 id="alur" className="mt-2 text-[28px] font-semibold leading-9 text-navy">
            Empat langkah, satu perjalanan
          </h2>
          <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
            {steps.map(({ title, desc, Icon }, i) => (
              <li key={title} className="rounded-lg border border-line bg-surface p-5 shadow-soft">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-sand text-sm font-semibold text-navy">
                    {i + 1}
                  </span>
                  <Icon aria-hidden="true" className="text-copper-ink" size={22} strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 text-xl font-semibold leading-7 text-navy">{title}</h3>
                <p className="mt-1 text-base text-body">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="sovia" className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 shadow-soft md:flex-row md:items-center">
            <Image
              src={clinic.avatar_url ?? "/sovia-avatar.png"}
              alt={`Avatar ${assistant}, asisten AI`}
              width={88}
              height={88}
              className="h-[88px] w-[88px] shrink-0 rounded-pill object-cover"
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
