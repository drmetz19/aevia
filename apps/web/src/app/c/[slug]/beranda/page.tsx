import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  LogOut,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  Video,
} from "lucide-react";
import { PatientShell } from "@/components/PatientShell";
import { btnPrimary, linkCls } from "@/components/PageIntro";
import { fetchClinic } from "@/lib/api";
import { REMINDER_CTA } from "@aevia/core";
import { getConsents, getCurrentPlan, getLatestAssessment, getMyRequests, getReminders, requirePatient } from "@/lib/session";
import { logout, markReminderReadAction } from "../actions";

export default async function Beranda({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ info?: string }> }) {
  const { slug } = await params;
  const { info } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  const me = await requirePatient(slug);
  const consents = await getConsents(slug);
  if (consents.every((c) => !c.decided)) redirect(`/c/${slug}/consent`);
  const granted = consents.filter((c) => c.granted).length;
  const assessment = await getLatestAssessment(slug);
  const requests = await getMyRequests(slug);
  const plan = await getCurrentPlan(slug);
  const reminders = await getReminders(slug);
  const target = { checkin: "checkin", review: "rencana", plan: "rencana" } as const;
  const accepted = requests.find((r) => r.status === "accepted" && r.consultation);
  const pending = requests.find((r) => r.status === "submitted");
  const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }) + " WIB";
  const steps: { title: string; status: string; state: "done" | "wait" | "todo" }[] = [
    {
      title: "Assessment",
      status: assessment?.status === "completed" ? "Selesai" : assessment ? "Sedang berjalan" : "Belum dimulai",
      state: assessment?.status === "completed" ? "done" : "todo",
    },
    {
      title: "Konsultasi",
      status: accepted ? `Terjadwal ${fmt(accepted.consultation!.scheduled_at)}` : pending ? "Menunggu tinjauan" : "Belum diajukan",
      state: accepted ? "done" : pending ? "wait" : "todo",
    },
    {
      title: "Rencana personal",
      status: plan ? `Siap dilihat · versi ${plan.version}` : accepted ? "Menunggu tinjauan profesional" : "Tersedia setelah konsultasi",
      state: plan ? "done" : accepted ? "wait" : "todo",
    },
    { title: "Follow-up & progres", status: plan ? "Check-in tersedia" : "Belum dimulai", state: plan ? "wait" : "todo" },
  ];

  const done = steps.filter((s) => s.state === "done").length;
  const next: { title: string; note: string; cta?: { label: string; href: string; external?: boolean } } =
    assessment?.status !== "completed"
      ? {
          title: assessment ? "Lanjutkan assessment Anda" : "Mulai dengan assessment singkat",
          note: `Jawab beberapa pertanyaan bersama ${clinic.assistant_name}. Sekitar 5 menit.`,
          cta: { label: assessment ? "Lanjutkan assessment" : "Mulai assessment", href: `/c/${clinic.slug}/assessment` },
        }
      : plan
        ? { title: "Rencana personal Anda siap", note: "Disusun dan ditandatangani profesional klinik.", cta: { label: "Lihat rencana", href: `/c/${clinic.slug}/rencana` } }
        : accepted?.consultation
          ? {
              title: "Konsultasi Anda sudah terjadwal",
              note: fmt(accepted.consultation.scheduled_at),
              cta: { label: "Buka ruang konsultasi", href: accepted.consultation.meeting_url, external: true },
            }
          : pending
            ? { title: "Permintaan sedang ditinjau", note: "Tim klinik akan menghubungi Anda untuk menjadwalkan konsultasi." }
            : { title: "Siapkan konsultasi pertama", note: "Pilih program, lalu kirim ringkasan untuk ditinjau tim klinik.", cta: { label: "Siapkan konsultasi", href: `/c/${clinic.slug}/program` } };

  const actions = [
    { label: assessment?.status === "completed" ? "Ulangi assessment" : "Mulai assessment", href: `/c/${clinic.slug}/assessment`, Icon: ClipboardList },
    ...(plan ? [{ label: "Lihat rencana", href: `/c/${clinic.slug}/rencana`, Icon: ScrollText }] : []),
    { label: "Mulai check-in", href: `/c/${clinic.slug}/checkin`, Icon: CalendarCheck },
    { label: "Cek progres", href: `/c/${clinic.slug}/progres`, Icon: TrendingUp },
    { label: "Siapkan konsultasi", href: `/c/${clinic.slug}/program`, Icon: Stethoscope },
  ];
  const R = 26;
  const C = 2 * Math.PI * R;

  return (
    <PatientShell clinic={clinic} active="beranda">
      <section aria-labelledby="sapa" className="hero-atmos panel-deep reveal p-6 text-white sm:p-8">
        <div aria-hidden="true" className="orb" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-copper-light">
              <span aria-hidden="true" className="h-px w-6 bg-copper-light" />
              Beranda
            </p>
            <h1 id="sapa" className="mt-2 text-balance font-serif text-[28px] leading-[1.15] sm:text-4xl">
              Selamat datang di {clinic.name}
            </h1>
            <p className="mt-2 truncate text-[15px] text-white/70">Masuk sebagai {me.email}</p>
          </div>
          <figure className="relative shrink-0" aria-label={`${done} dari 4 langkah selesai`}>
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90 sm:h-20 sm:w-20" aria-hidden="true">
              <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="5" />
              <circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                stroke="var(--brand-accent)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C - (C * done) / 4}
              />
            </svg>
            <figcaption className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span className="font-serif text-xl sm:text-2xl">{done}/4</span>
            </figcaption>
          </figure>
        </div>

        <div className="mt-6 rounded-md border border-white/12 bg-white/[0.06] p-4 backdrop-blur-sm sm:p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-copper-light">Langkah berikutnya</p>
          <p className="mt-1 text-lg font-semibold leading-snug">{next.title}</p>
          <p className="mt-1 text-[15px] text-white/75">{next.note}</p>
          {next.cta &&
            (next.cta.external ? (
              <a href={next.cta.href} rel="noopener noreferrer" className={`mt-4 ${btnPrimary}`}>
                <Video aria-hidden="true" size={18} strokeWidth={1.75} /> {next.cta.label}
              </a>
            ) : (
              <Link href={next.cta.href} className={`mt-4 ${btnPrimary}`}>
                {next.cta.label} <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
              </Link>
            ))}
        </div>
      </section>

      {info === "terkirim" && (
        <p role="status" className="reveal mt-5 flex gap-3 rounded-md border border-success/30 bg-surface px-4 py-3 text-base text-navy shadow-soft">
          <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={20} strokeWidth={1.75} />
          Selesai. Permintaan konsultasi Anda sudah terkirim dan akan ditinjau tim klinik.
        </p>
      )}
      {info === "ada" && (
        <p role="status" className="reveal mt-5 flex gap-3 rounded-md border border-line bg-surface px-4 py-3 text-base text-navy shadow-soft">
          <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0 text-copper-ink" size={20} strokeWidth={1.75} />
          Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik.
        </p>
      )}
      {accepted?.consultation && (
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-sand/70 px-4 py-3 text-base text-navy">
          <Video aria-hidden="true" size={18} strokeWidth={1.75} className="text-copper-ink" />
          Tautan pertemuan:{" "}
          <a href={accepted.consultation.meeting_url} rel="noopener noreferrer" className={linkCls}>
            Buka ruang konsultasi
          </a>
        </p>
      )}

      {reminders.length > 0 && (
        <section aria-labelledby="notif" className="mt-8">
          <h2 id="notif" className="flex items-center gap-2 text-xl font-semibold leading-7 text-navy">
            <Bell aria-hidden="true" size={20} strokeWidth={1.75} className="text-copper-ink" />
            Pemberitahuan
          </h2>
          <ul className="mt-3 space-y-3">
            {reminders.map((r, i) => (
              <li
                key={r.id}
                style={{ "--d": i } as React.CSSProperties}
                className="reveal flex flex-col gap-3 rounded-lg border border-line border-l-4 border-l-copper bg-surface p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-base text-navy">{r.message}</p>
                <form action={markReminderReadAction} className="w-full sm:w-auto">
                  <input type="hidden" name="slug" value={clinic.slug} />
                  <input type="hidden" name="reminder_id" value={r.id} />
                  <input type="hidden" name="next" value={target[r.kind]} />
                  <button type="submit" className="w-full rounded-pill bg-navy px-5 py-3 text-base font-semibold text-white transition active:scale-[0.98] sm:w-auto">{REMINDER_CTA[r.kind]}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="perjalanan" className="mt-10">
        <h2 id="perjalanan" className="text-xl font-semibold leading-7 text-navy">Perjalanan Anda</h2>
        <ol className="timeline mt-4 grid gap-3.5 lg:grid-cols-4" aria-label="Perjalanan Anda">
          {steps.map((st, i) => (
            <li
              key={st.title}
              data-state={st.state}
              style={{ "--d": i + 1 } as React.CSSProperties}
              className="reveal flex gap-4 lg:flex-col lg:gap-3 lg:rounded-lg lg:border lg:border-line lg:bg-surface lg:p-4 lg:shadow-soft"
            >
              <span
                aria-hidden="true"
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-sm font-semibold ${
                  st.state === "done"
                    ? "bg-copper text-white"
                    : st.state === "wait"
                      ? "border-2 border-copper bg-surface text-copper-ink"
                      : "border border-line bg-surface text-slate"
                }`}
              >
                {st.state === "done" ? <Check size={16} strokeWidth={2.5} /> : i + 1}
              </span>
              <div
                className={`min-w-0 flex-1 rounded-lg border bg-surface px-4 py-3 shadow-soft lg:border-0 lg:p-0 lg:shadow-none ${
                  st.state === "todo" ? "border-line" : "border-copper/50"
                }`}
              >
                <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-slate">Langkah {i + 1}</span>
                <span className="block text-base font-semibold text-navy">{st.title}</span>
                <span className={`mt-0.5 block text-[14px] font-medium ${st.state === "todo" ? "text-body" : "text-copper-ink"}`}>{st.status}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="aksi" className="mt-10">
        <h2 id="aksi" className="text-xl font-semibold leading-7 text-navy">Akses cepat</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map(({ label, href, Icon }, i) => (
            <li key={label} style={{ "--d": i + 2 } as React.CSSProperties} className="reveal">
              <Link
                href={href}
                className="card-lift group flex h-full flex-col justify-between gap-4 rounded-lg border border-line bg-surface p-4 shadow-soft active:scale-[0.98]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-sand text-copper-ink transition-colors group-hover:bg-navy group-hover:text-white">
                  <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                </span>
                <span className="flex items-end justify-between gap-2 text-[15px] font-semibold leading-snug text-navy">
                  {label}
                  <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-slate transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 flex items-start gap-4 rounded-lg border border-line bg-surface p-5 shadow-soft" aria-labelledby="pers">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-sand text-navy">
          <ShieldCheck aria-hidden="true" size={22} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="pers" className="text-base font-semibold text-navy">
            Persetujuan data
          </h2>
          <p className="text-[15px] text-body">{granted} dari 4 cakupan sedang Anda setujui.</p>
          <Link href={`/c/${clinic.slug}/consent`} className={`mt-2 inline-block ${linkCls}`}>
            Atur persetujuan
          </Link>
        </div>
      </section>

      <form action={logout} className="mt-8 flex justify-center">
        <input type="hidden" name="slug" value={clinic.slug} />
        <button type="submit" className="inline-flex items-center gap-2 rounded-pill px-5 py-2.5 text-base font-semibold text-slate transition hover:bg-sand hover:text-navy">
          <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
          Keluar
        </button>
      </form>
    </PatientShell>
  );
}
