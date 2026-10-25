import { Check } from "lucide-react";

/** Stepper alur intake: Assessment → Program → Kirim permintaan. Selesai = cyan + centang; aktif = ring cyan. */
export function IntakeStepper({ assessmentDone }: { assessmentDone: boolean }) {
  const steps = [
    { label: "Assessment", done: assessmentDone },
    { label: "Program", done: true },
    { label: "Kirim permintaan", done: false, current: true },
  ];
  return (
    <ol aria-label="Langkah permintaan konsultasi" className="flex items-center gap-1.5 text-[13px] font-semibold sm:gap-3">
      {steps.map((s, i) => (
        <li key={s.label} aria-current={s.current ? "step" : undefined} className="flex items-center gap-1.5 whitespace-nowrap sm:gap-3">
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[12px] ${
              s.done ? "bg-copper text-white" : s.current ? "border-2 border-copper bg-surface text-copper-ink ring-2 ring-copper/20" : "border border-line bg-surface text-slate"
            }`}
          >
            {s.done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
          </span>
          <span className={s.current ? "text-navy" : s.done ? "text-navy" : "text-slate"}>
            <span className="sr-only">{s.done ? "Selesai: " : s.current ? "Langkah saat ini: " : ""}</span>
            {s.label}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true" className="h-px w-2 bg-line sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}
