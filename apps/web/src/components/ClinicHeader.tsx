import Link from "next/link";
import type { PublicClinic } from "@aevia/core";
import { PatientTopNav, type PatientTab } from "@/components/PatientNav";

export function ClinicHeader({ clinic, nav = false, active }: { clinic: PublicClinic; nav?: boolean; active?: PatientTab }) {
  return (
    <header className="glass-bar border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:py-3 md:px-8">
        <Link href={`/c/${clinic.slug}${nav ? "/beranda" : ""}`} className="flex min-w-0 items-center gap-3">
          {clinic.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinic.logo_url} alt={`Logo ${clinic.name}`} className="h-10 w-10 rounded-pill object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-navy font-serif text-lg text-white shadow-[inset_0_-6px_12px_rgba(255,255,255,0.08)] ring-2 ring-copper/40 ring-offset-2 ring-offset-surface"
            >
              {clinic.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-sans text-base font-semibold text-navy">{clinic.name}</span>
            {clinic.tagline && <span className="block truncate text-[13px] font-medium text-slate">{clinic.tagline}</span>}
          </span>
        </Link>
        {nav && <PatientTopNav slug={clinic.slug} active={active} />}
        {clinic.brand_mode === "cobrand" && (
          <p className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-slate">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-pill bg-navy font-serif text-xs text-white"
            >
              A
            </span>
            <span className="sr-only sm:not-sr-only">powered by AEVIA</span>
          </p>
        )}
      </div>
    </header>
  );
}
