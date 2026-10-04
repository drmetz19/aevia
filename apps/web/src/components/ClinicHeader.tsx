import type { PublicClinic } from "@aevia/core";

export function ClinicHeader({ clinic }: { clinic: PublicClinic }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {clinic.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinic.logo_url} alt={`Logo ${clinic.name}`} className="h-10 w-10 rounded-pill object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-navy font-serif text-lg text-white"
            >
              {clinic.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate font-sans text-base font-semibold text-navy">{clinic.name}</p>
            {clinic.tagline && <p className="truncate text-[13px] font-medium text-slate">{clinic.tagline}</p>}
          </div>
        </div>
        {clinic.brand_mode === "cobrand" && (
          <p className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-slate">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-pill bg-navy font-serif text-xs text-white"
            >
              A
            </span>
            <span>powered by AEVIA</span>
          </p>
        )}
      </div>
    </header>
  );
}
