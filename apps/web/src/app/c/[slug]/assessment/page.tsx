import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { COMPLETION_LINE, PROGRESS_LINE, areaLabel, findQuestion, guardEngine, scriptEngine } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { SoviaAvatar, SoviaHeader } from "@/components/SoviaHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getConsents, getLatestAssessment, requirePatient } from "@/lib/session";
import { answerAction, completeAction, startAssessmentAction } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ pesan?: string }> };

const engine = guardEngine(scriptEngine);
const primary = "rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white";

function SoviaBubble({ clinic, children, live }: { clinic: Parameters<typeof SoviaAvatar>[0]["clinic"]; children: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex items-end gap-2" {...(live ? { "aria-live": "polite" as const } : {})}>
      <SoviaAvatar clinic={clinic} size={32} />
      <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-sand px-4 py-3 text-base text-navy">{children}</div>
    </div>
  );
}
const PatientBubble = ({ children }: { children: React.ReactNode }) => (
  <div className="flex justify-end">
    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-navy px-4 py-3 text-base text-white">{children}</div>
  </div>
);

export default async function AssessmentPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { pesan } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const consents = await getConsents(slug);
  const consented = consents.find((c) => c.scope === "assessment")?.granted ?? false;
  const state = await getLatestAssessment(slug);
  const name = clinic.assistant_name;
  const active = state && state.status === "in_progress" ? state : null;

  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-2xl px-0 sm:px-4 sm:py-8">
        <h1 className="sr-only">Assessment bersama {name}</h1>
        <div className="overflow-hidden border-y border-line bg-white shadow-soft sm:rounded-lg sm:border">
          <SoviaHeader clinic={clinic} />

          {!active ? (
            <div className="space-y-4 px-4 py-6">
              <SoviaBubble clinic={clinic}>{engine.intro(name)}</SoviaBubble>
              {!consented && (
                <p className="rounded-md bg-ivory px-4 py-3 text-base text-body">
                  Agar hasil bisa dibagikan ke klinik, kami akan meminta persetujuan Anda di akhir. Anda juga bisa{" "}
                  <Link href={`/c/${slug}/consent`} className="font-semibold text-navy underline underline-offset-4">
                    mengaturnya lebih dulu
                  </Link>
                  .
                </p>
              )}
              <form action={startAssessmentAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className={primary}>
                  Mulai assessment
                </button>
                {state?.status === "completed" && (
                  <Link href={`/c/${slug}/assessment/hasil`} className="text-base font-semibold text-navy underline underline-offset-4">
                    Lihat hasil terakhir
                  </Link>
                )}
              </form>
            </div>
          ) : (
            <>
              <div className="px-4 pt-4">
                <div className="flex items-center justify-between text-[13px] font-medium text-body">
                  <span>
                    Pertanyaan {Math.min(active.answered + 1, active.total)} dari {active.total}
                  </span>
                  <span>{Math.round((active.answered / active.total) * 100)}%</span>
                </div>
                <p className="mt-1 text-[13px] font-medium text-body">{PROGRESS_LINE}</p>
                <div
                  role="progressbar"
                  aria-label="Kemajuan assessment"
                  aria-valuemin={0}
                  aria-valuemax={active.total}
                  aria-valuenow={active.answered}
                  className="mt-2 h-2 overflow-hidden rounded-pill bg-sand"
                >
                  <div className="h-full bg-copper" style={{ width: `${(active.answered / active.total) * 100}%` }} />
                </div>
              </div>

              <div className="space-y-3 px-4 py-6">
                <SoviaBubble clinic={clinic}>{engine.intro(name)}</SoviaBubble>
                {active.answers.map((a, i) => {
                  const q = findQuestion(a.question_id);
                  if (!q) return null;
                  const label = q.type === "choice" ? q.options.find((o) => o.value === a.value)?.label : a.text;
                  return (
                    <div key={a.question_id} className="space-y-3">
                      <SoviaBubble clinic={clinic}>{q.text}</SoviaBubble>
                      <PatientBubble>{label ?? "Dilewati"}</PatientBubble>
                      {i === active.answers.length - 1 && <SoviaBubble clinic={clinic}>{engine.acknowledge(i)}</SoviaBubble>}
                    </div>
                  );
                })}

                {active.flagged && active.emergency_message && (
                  <div role="alert" className="flex gap-3 rounded-lg border border-critical bg-white p-4 text-base text-navy">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-critical" size={22} strokeWidth={1.5} />
                    <p>
                      <strong className="font-semibold text-critical">Perlu perhatian segera. </strong>
                      {active.emergency_message}
                    </p>
                  </div>
                )}
                {pesan && (
                  <p role="alert" className="text-base text-critical">
                    {pesan}
                  </p>
                )}

                {active.next_question ? (
                  <div className="space-y-3">
                    <SoviaBubble clinic={clinic} live>
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-navy">
                        {areaLabel(active.next_question.area)}
                      </span>
                      {active.next_question.text}
                    </SoviaBubble>
                    <form action={answerAction} className="space-y-3 pl-10">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="assessment_id" value={active.id} />
                      <input type="hidden" name="question_id" value={active.next_question.id} />
                      {active.next_question.type === "choice" ? (
                        <fieldset className="space-y-2">
                          <legend className="sr-only">{active.next_question.text}</legend>
                          {active.next_question.options.map((o) => (
                            <label
                              key={o.value}
                              className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-white px-4 py-3 text-base text-navy has-[:checked]:border-navy has-[:checked]:bg-sand"
                            >
                              <input type="radio" name="value" value={o.value} required className="h-4 w-4 accent-[var(--brand-primary)]" />
                              {o.label}
                            </label>
                          ))}
                        </fieldset>
                      ) : (
                        <>
                          <label htmlFor="text" className="sr-only">
                            Jawaban Anda (opsional)
                          </label>
                          <textarea
                            id="text"
                            name="text"
                            rows={3}
                            maxLength={500}
                            placeholder="Tulis di sini bila ingin menambahkan"
                            className="w-full rounded-md border border-line bg-white px-4 py-3 text-base text-navy"
                          />
                        </>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <button type="submit" className={primary}>
                          Lanjut
                        </button>
                        {active.next_question.type === "text" && (
                          <button type="submit" name="skip" value="1" formNoValidate className="rounded-pill border border-navy px-6 py-3 text-base font-semibold text-navy">
                            Lewati
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <SoviaBubble clinic={clinic} live>{COMPLETION_LINE}</SoviaBubble>
                    <form action={completeAction} className="pl-10">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="assessment_id" value={active.id} />
                      <button type="submit" className={primary}>
                        Lihat hasil
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <p className="px-4 py-4 text-[13px] font-medium text-body">Hasil assessment bukan diagnosis. {name} adalah AI.</p>
      </main>
    </div>
  );
}
