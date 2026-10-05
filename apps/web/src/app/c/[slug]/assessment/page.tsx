import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronDown, History } from "lucide-react";
import { COMPLETION_LINE, PROGRESS_LINE, areaLabel, findQuestion, guardEngine, scriptEngine } from "@aevia/core";
import { PatientShell } from "@/components/PatientShell";
import { SoviaAvatar, SoviaHeader } from "@/components/SoviaHeader";
import { fetchClinic } from "@/lib/api";
import { getConsents, getLatestAssessment, requirePatient } from "@/lib/session";
import { answerAction, completeAction, startAssessmentAction } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ pesan?: string }> };

const engine = guardEngine(scriptEngine);
const primary =
  "inline-flex flex-1 items-center justify-center rounded-pill bg-navy px-6 py-3.5 text-base font-semibold text-white shadow-soft transition active:scale-[0.98] sm:flex-none";

function SoviaBubble({ clinic, children, live }: { clinic: Parameters<typeof SoviaAvatar>[0]["clinic"]; children: React.ReactNode; live?: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${live ? "reveal" : ""}`} {...(live ? { "aria-live": "polite" as const } : {})}>
      <SoviaAvatar clinic={clinic} size={32} />
      <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-sand bg-sand/80 px-4 py-3 text-base text-navy shadow-[0_1px_2px_rgba(11,31,58,0.05)]">{children}</div>
    </div>
  );
}
const PatientBubble = ({ children }: { children: React.ReactNode }) => (
  <div className="flex justify-end">
    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-navy px-4 py-3 text-base text-white shadow-soft">{children}</div>
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
    <PatientShell clinic={clinic} active="assessment" width="max-w-2xl">
        <h1 className="sr-only">Assessment bersama {name}</h1>
        <div className="reveal -mx-4 -mt-7 overflow-hidden border-b border-line bg-surface shadow-soft sm:mx-0 sm:mt-0 sm:rounded-lg sm:border">
          <SoviaHeader clinic={clinic} />

          {!active ? (
            <div className="chat-bg space-y-4 px-4 py-6">
              <SoviaBubble clinic={clinic}>{engine.intro(name)}</SoviaBubble>
              {!consented && (
                <p className="rounded-md border border-line bg-surface px-4 py-3 text-base text-body">
                  Agar hasil bisa dibagikan ke klinik, kami akan meminta persetujuan Anda di akhir. Anda juga bisa{" "}
                  <Link href={`/c/${slug}/consent`} className="font-semibold text-navy underline underline-offset-4">
                    mengaturnya lebih dulu
                  </Link>
                  .
                </p>
              )}
              <form action={startAssessmentAction} className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
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
              <div className="sticky top-[61px] z-20 border-b border-line bg-surface/95 px-4 pb-3 pt-3 backdrop-blur sm:static">
                <div className="flex items-center justify-between text-[13px] font-medium text-body">
                  <span>
                    Pertanyaan {Math.min(active.answered + 1, active.total)} dari {active.total}
                  </span>
                  <span className="font-serif text-base text-copper-ink">{Math.round((active.answered / active.total) * 100)}%</span>
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
                  <div className="progress-glow h-full rounded-pill transition-[width] duration-700" style={{ width: `${(active.answered / active.total) * 100}%` }} />
                </div>
              </div>

              <div className="chat-bg space-y-3 px-4 py-6">
                {active.answers.length === 0 && <SoviaBubble clinic={clinic}>{engine.intro(name)}</SoviaBubble>}
                {(() => {
                  const rows = active.answers
                    .map((a, i) => {
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
                    })
                    .filter(Boolean);
                  const older = rows.slice(0, -1);
                  return (
                    <>
                      {older.length > 0 && (
                        <details className="group rounded-md border border-line bg-surface/80">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[14px] font-semibold text-navy [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-2">
                              <History aria-hidden="true" size={16} strokeWidth={1.75} className="text-copper-ink" />
                              Jawaban sebelumnya ({older.length})
                            </span>
                            <ChevronDown aria-hidden="true" size={18} className="text-slate transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="space-y-3 border-t border-line px-3 py-4">{older}</div>
                        </details>
                      )}
                      {rows.at(-1)}
                    </>
                  );
                })()}

                {active.flagged && active.emergency_message && (
                  <div role="alert" className="flex gap-3 rounded-lg border border-critical bg-surface p-4 text-base text-navy">
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
                      <span className="mb-1 block text-[13px] font-semibold uppercase tracking-[0.12em] text-navy">
                        {areaLabel(active.next_question.area)}
                      </span>
                      {active.next_question.text}
                    </SoviaBubble>
                    <form action={answerAction} className="space-y-3 sm:pl-10">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="assessment_id" value={active.id} />
                      <input type="hidden" name="question_id" value={active.next_question.id} />
                      {active.next_question.type === "choice" ? (
                        <fieldset className="space-y-2">
                          <legend className="sr-only">{active.next_question.text}</legend>
                          {active.next_question.options.map((o) => (
                            <label
                              key={o.value}
                              className="group flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-4 py-3.5 text-base font-medium text-navy shadow-[0_1px_2px_rgba(11,31,58,0.04)] transition hover:border-navy/40 active:scale-[0.99] has-[:checked]:border-navy has-[:checked]:bg-sand has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand-accent)]"
                            >
                              <input type="radio" name="value" value={o.value} required className="peer sr-only" />
                              <span
                                aria-hidden="true"
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2 border-line bg-surface transition peer-checked:border-navy peer-checked:[&>span]:scale-100"
                              >
                                <span className="h-2.5 w-2.5 scale-0 rounded-pill bg-navy transition-transform" />
                              </span>
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
                            className="field"
                          />
                        </>
                      )}
                      <div className="flex gap-3 pt-1">
                        <button type="submit" className={primary}>
                          Lanjut
                        </button>
                        {active.next_question.type === "text" && (
                          <button type="submit" name="skip" value="1" formNoValidate className="inline-flex flex-1 items-center justify-center rounded-pill border border-navy px-6 py-3.5 text-base font-semibold text-navy transition active:scale-[0.98] sm:flex-none">
                            Lewati
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <SoviaBubble clinic={clinic} live>{COMPLETION_LINE}</SoviaBubble>
                    <form action={completeAction} className="flex sm:pl-10">
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
        <p className="py-4 text-center text-[13px] font-medium text-body">Hasil assessment bukan diagnosis. {name} adalah AI.</p>
    </PatientShell>
  );
}
