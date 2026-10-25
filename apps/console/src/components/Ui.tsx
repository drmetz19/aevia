"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { inputCls, labelCls, primaryCls, dangerCls, ghostCls } from "@/lib/ui-classes";
import type { SettingsState } from "@/app/(app)/pengaturan/actions";


/** Konstanta kelas ada di `@/lib/ui-classes` (modul server-safe); diekspor ulang demi kompatibilitas. */
export { inputCls, labelCls, primaryCls, dangerCls, ghostCls };

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
  noticeFirst = false,
}: {
  action: (p: SettingsState, fd: FormData) => Promise<SettingsState>;
  children: ReactNode;
  className?: string;
  encType?: string;
  /** Notice tampil di atas isi (mis. form yang membungkus tabel). */
  noticeFirst?: boolean;
}) {
  const [s, run] = useActionState<SettingsState, FormData>(action, {});
  return (
    <form action={run} className={className} encType={encType}>
      {noticeFirst && <Notice s={s} />}
      {children}
      {!noticeFirst && <Notice s={s} />}
    </form>
  );
}

export function PageHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper-ink">{eyebrow}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-9 text-navy md:text-4xl md:leading-[44px]">{title}</h1>
      <p className="mt-2 max-w-2xl text-base text-body">{lead}</p>
    </>
  );
}

export function Submit({ className, disabled, name, value, children, confirm }: { className: string; disabled?: boolean; name?: string; value?: string; children: ReactNode; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={className} onClick={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {children}
    </button>
  );
}
