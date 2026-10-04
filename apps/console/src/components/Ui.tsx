"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { SettingsState } from "@/app/(app)/pengaturan/actions";

export const inputCls = "w-full rounded-md border border-line bg-white px-4 py-3 text-base text-navy";
export const labelCls = "block text-[13px] font-semibold text-navy";
export const primaryCls = "rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white disabled:opacity-60";
export const ghostCls = "rounded-pill border border-navy px-5 py-2 text-base font-semibold text-navy disabled:opacity-60";

export function Notice({ s }: { s: SettingsState }) {
  return (
    <>
      {s.ok && (
        <div role="status" className="rounded-md bg-sand px-4 py-3 text-base text-navy">
          <p>{s.ok}</p>
          {s.secrets?.map((x) => (
            <p key={x.label} className="mt-2">
              <span className="block text-[13px] font-semibold">{x.label}</span>
              <code className="block break-all rounded-md bg-white px-3 py-2 text-base text-navy select-all">{x.value}</code>
            </p>
          ))}
        </div>
      )}
      {s.error && (
        <div role="alert" className="rounded-md border border-critical px-4 py-3 text-base text-critical">
          <p>{s.error}</p>
          {s.problems && s.problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {s.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** Form server-action dengan umpan balik; children menerima status pending. */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
  encType,
}: {
  action: (p: SettingsState, fd: FormData) => Promise<SettingsState>;
  children: ReactNode;
  className?: string;
  encType?: string;
}) {
  const [s, run] = useActionState<SettingsState, FormData>(action, {});
  return (
    <form action={run} className={className} encType={encType}>
      {children}
      <Notice s={s} />
    </form>
  );
}

export function PageHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <>
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">{eyebrow}</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">{title}</h1>
      <p className="mt-2 max-w-2xl text-base text-body">{lead}</p>
    </>
  );
}

export function Submit({ className, disabled, name, value, children }: { className: string; disabled?: boolean; name?: string; value?: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={className}>
      {children}
    </button>
  );
}
