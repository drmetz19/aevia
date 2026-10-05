import type { ReactNode } from "react";

/** Pembuka halaman: eyebrow bergaris tembaga + judul serif + lead. */
export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="reveal">
      {eyebrow && (
        <p className="inline-flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-copper-ink">
          <span aria-hidden="true" className="h-px w-6 bg-copper" />
          {eyebrow}
        </p>
      )}
      <h1 className="mt-2 text-balance font-serif text-[30px] leading-[1.15] text-navy sm:text-[40px] sm:leading-[1.12]">{title}</h1>
      {children && <div className="mt-3 max-w-2xl space-y-2 text-base text-body sm:text-[17px] sm:leading-7">{children}</div>}
    </div>
  );
}

/** Kartu permukaan standar. */
export const card = "rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-6";
export const eyebrowCls = "text-[13px] font-semibold uppercase tracking-[0.14em] text-copper-ink";
export const btnPrimary =
  "inline-flex w-full items-center justify-center gap-2 rounded-pill bg-copper px-6 py-3.5 text-base font-semibold text-white shadow-soft transition hover:brightness-105 active:scale-[0.98] sm:w-auto sm:px-7 sm:text-lg";
export const btnNavy =
  "inline-flex w-full items-center justify-center gap-2 rounded-pill bg-navy px-6 py-3.5 text-base font-semibold text-white transition hover:brightness-110 active:scale-[0.98] sm:w-auto sm:px-7";
export const btnGhost =
  "inline-flex w-full items-center justify-center gap-2 rounded-pill border border-navy px-6 py-3.5 text-base font-semibold text-navy transition hover:bg-sand active:scale-[0.98] sm:w-auto sm:px-7";
export const linkCls = "text-base font-semibold text-navy underline decoration-copper decoration-2 underline-offset-4";
