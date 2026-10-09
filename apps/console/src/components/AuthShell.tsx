import type { ReactNode } from "react";

/** Kerangka halaman masuk/atur password console: panel navy di desktop, kartu tunggal di HP. */
export function AuthShell({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="hidden bg-deep p-8 text-white md:block">
        <p className="font-serif text-2xl">AEVIA</p>
        <p className="mt-2 text-[13px] font-medium text-white/70">Console klinik & profesional</p>
      </aside>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-soft">
          <p className="font-serif text-xl text-navy md:hidden">AEVIA</p>
          <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink md:mt-0">{eyebrow}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-9 text-navy">{title}</h1>
          <p className="mt-2 text-base text-body">{lead}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

export const authInput = "w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy";
export const authLabel = "block text-[13px] font-medium text-navy";
export const authPrimary = "w-full rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white disabled:opacity-60";
export const authLink = "inline-flex min-h-11 items-center text-base font-semibold text-navy underline underline-offset-4";
