import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
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
import { ClinicHeader } from "@/components/ClinicHeader";
import { SoviaAvatar } from "@/components/SoviaHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getCurrentPlan, requirePatient } from "@/lib/session";

const card = "rounded-lg border border-line bg-surface p-6 shadow-soft";
const h2 = "text-xl font-semibold leading-7 text-navy";
const eyebrow = "text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink";

const Badge = ({ children }: { children: string }) => (
  <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1 text-[13px] font-medium text-navy">
    <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-copper" />
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
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className={eyebrow}>Rencana personal</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Rencana Anda</h1>

        {!plan ? (
          <div className={`mt-6 ${card}`}>
            <p role="status" className="text-base text-body">{EMPTY_PLAN}</p>
            <Link href={`/c/${slug}/beranda`} className="mt-4 inline-block text-base font-semibold text-navy underline underline-offset-4">Kembali ke beranda</Link>
          </div>
        ) : (
          <>
            <p className="mt-2 text-base text-navy">{planUpdatedLine(plan.clinic_name)}</p>
            <p className="mt-1 text-base text-body">{white ? PLAN_WHITELABEL_LINE(plan.clinic_name) : PLAN_CO_BRAND_LINE}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>Reviewed by Professional</Badge>
              <Badge>Professional Plan</Badge>
            </div>
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-body">
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.5} />
              Ditandatangani {plan.signed_by_name} · {new Date(plan.signed_at).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" })} · Versi {plan.version}
            </p>

            <section aria-labelledby="ringkas" className={`mt-6 ${card}`}>
              <p className={eyebrow}>Ringkasan konsultasi</p>
              <h2 id="ringkas" className={`mt-1 ${h2}`}>{SUMMARY_OPENING}</h2>
              <h3 className="mt-4 text-base font-semibold text-navy">{SUMMARY_HEADINGS.discussed}</h3>
              <p className="mt-1 text-base text-body">{plan.summary.discussed || "-"}</p>
              <h3 className="mt-4 text-base font-semibold text-navy">{SUMMARY_HEADINGS.priorities}</h3>
              {plan.summary.priorities.length ? (
                <ul className="mt-1 list-inside list-disc text-base text-body">{plan.summary.priorities.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <p className="mt-1 text-base text-body">-</p>
              )}
            </section>

            <section aria-labelledby="rencana" className={`mt-6 ${card}`}>
              <p className={eyebrow}>{SUMMARY_HEADINGS.plan}</p>
              <h2 id="rencana" className="sr-only">{SUMMARY_HEADINGS.plan}</h2>
              <h3 className={`mt-1 ${h2}`}>{PLAN_HEADINGS.focus}</h3>
              <ul className="mt-2 list-inside list-disc text-base text-body">{plan.content.focus.map((f) => <li key={f}>{f}</li>)}</ul>
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.next}</h3>
              <ol className="mt-2 list-inside list-decimal text-base text-body">{plan.content.next_steps.map((f) => <li key={f}>{f}</li>)}</ol>
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.monitor}</h3>
              {plan.content.monitor.length ? (
                <ul className="mt-2 space-y-2">
                  {plan.content.monitor.map((m) => (
                    <li key={m.metric_key} className="rounded-md bg-ivory px-4 py-3 text-base text-navy">
                      <span className="font-semibold">{m.label}</span>
                      <span className="block text-[13px] font-medium text-body">
                        Saat ini {m.baseline ?? "-"} · Target {m.target ?? "-"} {m.unit} · {m.direction === "up" ? "Diharapkan naik" : "Diharapkan turun"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-base text-body">Belum ada yang perlu dipantau.</p>
              )}
              <h3 className={`mt-6 ${h2}`}>{PLAN_HEADINGS.review}</h3>
              <p className="mt-2 text-base text-body">{plan.content.review_at ? formatDateId(plan.content.review_at) : "Akan ditentukan bersama profesional Anda."}</p>
            </section>

            <section aria-labelledby="sovia" className="mt-6 flex gap-3 rounded-lg bg-sand p-5 text-base text-navy">
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
                    <li key={idx} className="rounded-md bg-ivory px-4 py-3 text-base text-navy">
                      <span className="font-semibold">{i.name}</span>
                      <span className="block text-[13px] font-medium text-body">
                        {[i.strength, i.dose, i.frequency, i.route, i.duration].filter(Boolean).join(" · ")}
                      </span>
                      {i.notes && <span className="block text-base text-body">{i.notes}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] font-medium text-body">Hanya untuk dilihat. Ikuti arahan profesional Anda.</p>
              </section>
            )}

            <Link href={`/c/${slug}/beranda`} className="mt-8 inline-block text-base font-semibold text-navy underline underline-offset-4">Kembali ke beranda</Link>
          </>
        )}
      </main>
    </div>
  );
}
