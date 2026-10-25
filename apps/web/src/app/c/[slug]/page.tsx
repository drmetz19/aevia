import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronDown, ClipboardList, MessagesSquare, Repeat2, Stethoscope } from "lucide-react";
import { ClinicHeader } from "@/components/ClinicHeader";
import { btnGhost, btnPrimary } from "@/components/PageIntro";
import { ProgramCard } from "@/components/ProgramCard";
import { fetchPrograms } from "@/lib/session";
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

const faq = (clinic: string) => [
  { q: "Apakah hasil assessment adalah diagnosis?", a: "Bukan. Hasil assessment membantu Anda dan profesional memahami kondisi awal. Penilaian dan keputusan perawatan tetap ditetapkan profesional klinik." },
  { q: "Siapa yang dapat melihat data saya?", a: `Data Anda disimpan terpisah untuk ${clinic}. Hasil assessment dibagikan kepada tim klinis hanya setelah Anda memberi persetujuan, dan persetujuan itu dapat Anda cabut kapan saja.` },
  { q: "Bagaimana biaya program ditentukan?", a: `Biaya ditetapkan oleh ${clinic}. Bila belum ditetapkan, kartu program menampilkan “Segera hadir”.` },
  { q: "Apa itu kode voucher?", a: "Sebagian program memerlukan kode dari klinik. Masukkan kode saat menyiapkan konsultasi; bila belum punya, hubungi klinik." },
  { q: "Apa yang terjadi setelah saya mengajukan konsultasi?", a: "Tim klinik meninjau permintaan Anda, lalu menghubungi Anda untuk menjadwalkan sesi bersama profesional." },
];

export default async function ClinicLanding({ params }: Props) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();

  const white = clinic.brand_mode === "whitelabel";
  const programs = await fetchPrograms(slug);
  const assistant = clinic.assistant_name;
  const eyebrow = white ? (clinic.tagline ?? clinic.name) : "Guidance for Better Aging.";

  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main>
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-20">
            <p className="reveal inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">
              <span aria-hidden="true" className="h-px w-8 bg-copper" />{eyebrow}
            </p>
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="reveal mt-4 max-w-3xl text-[28px] font-bold leading-9 text-navy sm:text-4xl sm:leading-[44px] md:text-5xl md:leading-[56px]">
              Pendampingan kesehatan yang <em className="not-italic text-copper-ink">tenang</em>, terarah, dan personal.
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="reveal mt-5 max-w-xl text-base text-body sm:text-lg">
              Mulai dari memahami kondisi Anda hari ini, lalu berjalan bersama tim profesional {clinic.name} menuju
              rencana yang sesuai untuk Anda.
            </p>
            <div style={{ "--d": 3 } as React.CSSProperties} className="reveal mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={`/c/${clinic.slug}/assessment`} className={btnPrimary}>
                Mulai assessment <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
              </Link>
              <Link href={`/c/${clinic.slug}/masuk`} className={btnGhost}>
                Masuk
              </Link>
            </div>
            <p className="reveal mt-6 text-[13px] font-medium text-slate" style={{ "--d": 4 } as React.CSSProperties}>
              Hasil assessment bukan diagnosis. Setiap rencana ditinjau dan disetujui profesional klinik.
            </p>
          </div>
        </section>

        <section aria-labelledby="alur" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">Alur pendampingan</p>
          <h2 id="alur" className="mt-2 text-[22px] font-semibold leading-[30px] text-navy sm:text-[28px] sm:leading-9">
            Langkah demi langkah, satu perjalanan
          </h2>
          <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
            {steps.map(({ title, desc, Icon }, i) => (
              <li key={title} style={{ "--d": i + 2 } as React.CSSProperties} className="reveal card-lift rounded-lg border border-line bg-surface p-4 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-md bg-sand text-copper-ink">
                    <Icon aria-hidden="true" size={22} strokeWidth={1.75} />
                  </span>
                  <span className="rounded-pill border border-line bg-sand px-2 py-0.5 text-[11px] font-semibold text-slate">Langkah {i + 1}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold leading-7 text-navy">{title}</h3>
                <p className="mt-1 text-base text-body">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {programs.length > 0 && (
          <section aria-labelledby="program" className="border-y border-line bg-surface">
            <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">Program</p>
              <h2 id="program" className="mt-2 text-[22px] font-semibold leading-[30px] text-navy sm:text-[28px] sm:leading-9">
                Pilihan pendampingan
              </h2>
              <p className="mt-2 max-w-2xl text-base text-body">Biaya ditetapkan oleh {clinic.name}. Anda baru mengajukan permintaan; tim klinik akan meninjau dan menghubungi Anda.</p>
              <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                {programs.map((p, i) => (
                  <ProgramCard key={p.id} p={p} level="h3" delay={i + 1} href={`/c/${slug}/program`} cta="Lihat program" />
                ))}
              </ul>
            </div>
          </section>
        )}

        <section aria-labelledby="sovia" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
          <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-4 sm:p-6 md:flex-row md:items-center">
            <Image
              src={clinic.avatar_url ?? "/sovia-avatar.png"}
              alt={`Avatar ${assistant}, asisten AI`}
              width={88}
              height={88}
              className="h-[88px] w-[88px] shrink-0 rounded-pill object-cover ring-4 ring-sand ring-offset-2 ring-offset-surface"
              unoptimized={Boolean(clinic.avatar_url)}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">
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

        <section aria-labelledby="faq" className="mx-auto max-w-6xl px-4 pb-10 md:px-8 md:pb-16">
          <h2 id="faq" className="text-[22px] font-semibold leading-[30px] text-navy sm:text-[28px] sm:leading-9">Pertanyaan yang sering diajukan</h2>
          <div className="mt-6 max-w-3xl space-y-3">
            {faq(clinic.name).map(({ q, a }) => (
              <details key={q} className="group rounded-lg border border-line bg-surface p-4 open:border-line-strong">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-navy [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown aria-hidden="true" size={18} strokeWidth={1.75} className="shrink-0 text-slate transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-base text-body">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="mulai" className="mx-auto max-w-6xl px-4 pb-12 md:px-8 md:pb-20">
          <div className="rounded-lg border border-line bg-deep p-6 text-white md:p-10">
            <h2 id="mulai" className="max-w-2xl text-[22px] font-bold leading-[30px] sm:text-[28px] sm:leading-9">Siap memulai bersama {clinic.name}?</h2>
            <p className="mt-2 max-w-xl text-base text-white/80">Mulai dari beberapa pertanyaan singkat. Anda yang menentukan apa yang dibagikan kepada tim klinik.</p>
            <Link href={`/c/${clinic.slug}/assessment`} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-surface px-6 py-3 text-base font-semibold text-navy transition hover:brightness-95 sm:w-auto">
              Mulai dari assessment <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
            </Link>
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
