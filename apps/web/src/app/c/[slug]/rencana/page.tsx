import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarClock, Check, Pill, Target } from "lucide-react";
import {
  EMPTY_PLAN,
  PLAN_CO_BRAND_LINE,
  PLAN_HEADINGS,
  PLAN_WHITELABEL_LINE,
  SUMMARY_HEADINGS,
  SUMMARY_OPENING,
  formatDateId,
  planUpdatedLine,
} from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { PageIntro, card, eyebrowCls, linkCls } from "@/components/PageIntro";
import { SoviaAvatar } from "@/components/SoviaHeader";
import { fetchClinic } from "@/lib/api";
import { getCurrentPlan, requirePatient } from "@/lib/session";

const h2 = "text-xl font-semibold leading-7 text-navy";
const eyebrow = eyebrowCls;

const Badge = ({ children }: { children: string }) => (
  <span className="inline-flex items-center gap-2 rounded-pill border border-white/20 bg-white/[0.08] px-3 py-1 text-[13px] font-semibold text-white">
    <BadgeCheck aria-hidden="true" size={15} strokeWidth={2} className="text-copper-light" />
    {children}
  </span>
);

export default async function Rencana({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const plan = await getCurrentPlan(slug);
  const white = clinic.brand_mode === "whitelabel";
  const name = clinic.assistant_name;

  return (
    <PatientShell clinic={clinic} active="rencana" width="max-w-3xl">
        <PageIntro eyebrow="Rencana personal" title="Rencana Anda" />

        {!plan ? (
          <div className={`reveal mt-7 text-center ${card}`}>
            <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-sand text-copper-ink">
              <CalendarClock size={26} strokeWidth={1.75} />
            </span>
            <p role="status" className="mx-auto mt-4 max-w-sm text-base text-body">{EMPTY_PLAN}</p>
            <Link href={`/c/${slug}/beranda`} className={`mt-4 inline-block ${linkCls}`}>Kembali ke beranda</Link>
          </div>
        ) : (
          <>
            <div className="hero-atmos panel-deep reveal mt-6 p-6 text-white sm:p-7">
            <div aria-hidden="true" className="orb" />
            <p className="text-lg font-semibold leading-snug">{planUpdatedLine(plan.clinic_name)}</p>
            <p className="mt-1 text-[15px] text-white/75">{white ? PLAN_WHITELABEL_LINE(plan.clinic_name) : PLAN_CO_BRAND_LINE}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>Reviewed by Professional</Badge>
              <Badge>Professional Plan</Badge>
            </div>
            <p className="mt-4 border-t border-white/12 pt-4 text-[13px] font-medium text-white/70">
              Ditandatangani {plan.signed_by_name} · {new Date(plan.signed_at).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" })} · Versi {plan.version}
            </p>
            </div>

            <section aria-labelledby="ringkas" className={`mt-6 ${card}`}>
              <p className={eyebrow}>Ringkasan konsultasi</p>
              <h2 id="ringkas" className={`mt-1 ${h2}`}>{SUMMARY_OPENING}</h2>
              <h3 className="mt-4 text-base font-semibold text-navy">{SUMMARY_HEADINGS.discussed}</h3>
              <p className="mt-1 text-base text-body">{plan.summary.discussed || "-"}</p>
              <h3 className="mt-4 text-base font-semibold text-navy">{SUMMARY_HEADINGS.priorities}</h3>
              {plan.summary.priorities.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {plan.summary.priorities.map((p) => (
                    <li key={p} className="rounded-pill bg-sand px-3 py-1 text-[15px] font-medium text-navy">{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-base text-body">-</p>
              )}
            </section>

            <section aria-labelledby="rencana" className={`mt-6 ${card}`}>
              <p className={eyebrow}>{SUMMARY_HEADINGS.plan}</p>
              <h2 id="rencana" className="sr-only">{SUMMARY_HEADINGS.plan}</h2>
              <h3 className={`mt-1 ${h2}`}>{PLAN_HEADINGS.focus}</h3>
              <ul className="mt-3 space-y-2">
                {plan.content.focus.map((f) => (
                  <li key={f} className="flex gap-3 text-base text-body">
                    <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-sand text-copper-ink">
                      <Check size={13} strokeWidth={2.5} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.next}</h3>
              <ol className="mt-3 space-y-3">
                {plan.content.next_steps.map((f, i) => (
                  <li key={f} className="flex gap-4 text-base text-body">
                    <span aria-hidden="true" className="numeral w-6 shrink-0 text-center text-[32px]">{i + 1}</span>
                    <span className="pt-1">{f}</span>
                  </li>
                ))}
              </ol>
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.monitor}</h3>
              {plan.content.monitor.length ? (
                <ul className="mt-2 space-y-2">
                  {plan.content.monitor.map((m) => (
                    <li key={m.metric_key} className="flex gap-3 rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy">
                      <Target aria-hidden="true" size={18} strokeWidth={1.75} className="mt-1 shrink-0 text-copper-ink" />
                      <span className="min-w-0">
                      <span className="font-semibold">{m.label}</span>
                      <span className="block text-[13px] font-medium text-body">
                        Saat ini {m.baseline ?? "-"} · Target {m.target ?? "-"} {m.unit} · {m.direction === "up" ? "Diharapkan naik" : "Diharapkan turun"}
                      </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-base text-body">Belum ada yang perlu dipantau.</p>
              )}
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.review}</h3>
              <p className="mt-2 inline-flex items-center gap-2 rounded-pill bg-sand px-4 py-2 text-base font-medium text-navy">
                <CalendarClock aria-hidden="true" size={18} strokeWidth={1.75} className="text-copper-ink" />
                {plan.content.review_at ? formatDateId(plan.content.review_at) : "Akan ditentukan bersama profesional Anda."}
              </p>
            </section>

            <section aria-labelledby="sovia" className="mt-6 flex gap-3 rounded-lg border border-sand bg-sand/70 p-5 text-base text-navy">
              <SoviaAvatar clinic={clinic} size={40} />
              <div>
                <h2 id="sovia" className="text-base font-semibold">{name} menjelaskan rencana Anda</h2>
                <p className="mt-1">{plan.explanation}</p>
                <p className="mt-2 inline-flex items-center gap-2 text-[13px] font-medium">
                  <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-copper" />
                  {name} adalah AI. Isi rencana ditetapkan profesional Anda.
                </p>
              </div>
            </section>

            {plan.prescription && (
              <section aria-labelledby="resep" className={`mt-6 ${card}`}>
                <p className={eyebrow}>Resep</p>
                <h2 id="resep" className={`mt-1 ${h2}`}>Resep dari {plan.prescription.issued_by_name}</h2>
                <ul className="mt-3 space-y-3">
                  {plan.prescription.items.map((i, idx) => (
                    <li key={idx} className="flex gap-3 rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy">
                      <Pill aria-hidden="true" size={18} strokeWidth={1.75} className="mt-1 shrink-0 text-copper-ink" />
                      <span className="min-w-0">
                      <span className="font-semibold">{i.name}</span>
                      <span className="block text-[13px] font-medium text-body">
                        {[i.strength, i.dose, i.frequency, i.route, i.duration].filter(Boolean).join(" · ")}
                      </span>
                      {i.notes && <span className="block text-base text-body">{i.notes}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] font-medium text-body">Hanya untuk dilihat. Ikuti arahan profesional Anda.</p>
              </section>
            )}

            <Link href={`/c/${slug}/beranda`} className={`mt-8 inline-block ${linkCls}`}>Kembali ke beranda</Link>
          </>
        )}
    </PatientShell>
  );
}
