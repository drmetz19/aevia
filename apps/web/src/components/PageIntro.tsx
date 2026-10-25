import type { ReactNode } from "react";

/** Pembuka halaman: eyebrow bergaris cyan + judul + lead. */
export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="reveal">
      {eyebrow && (
        <p className="inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">
          <span aria-hidden="true" className="h-px w-6 bg-copper" />
          {eyebrow}
        </p>
      )}
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-9 text-navy sm:text-4xl sm:leading-[44px]">{title}</h1>
      {children && <div className="mt-3 max-w-2xl space-y-2 text-base text-body sm:text-[17px] sm:leading-7">{children}</div>}
    </div>
  );
}

/** Kartu permukaan standar. */
export const card = "rounded-lg border border-line bg-surface p-4 sm:p-6";
export const eyebrowCls = "text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink";
export const btnPrimary =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-action px-6 py-3 text-base font-semibold text-white transition hover:brightness-90 active:scale-[0.98] sm:w-auto sm:px-7";
export const btnNavy =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-navy px-6 py-3 text-base font-semibold text-white transition hover:brightness-125 active:scale-[0.98] sm:w-auto sm:px-7";
export const btnGhost =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface px-6 py-3 text-base font-semibold text-navy transition hover:border-line-strong hover:bg-ivory active:scale-[0.98] sm:w-auto sm:px-7";
export const linkCls = "text-base font-semibold text-copper-ink underline decoration-copper decoration-2 underline-offset-4";
