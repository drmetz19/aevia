"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Tombol kirim dengan umpan balik: selama aksi server berjalan, tombol nonaktif (cegah kirim ganda)
 * dan tombol yang ditekan menampilkan `pendingLabel` + indikator putar.
 * `notWhen`: untuk tombol tanpa name yang berbagi form dengan tombol bernama (mis. Lanjut vs Lewati) —
 * label proses tidak tampil bila field itu yang terkirim.
 */
export function SubmitButton({
  className,
  children,
  pendingLabel = "Menyimpan…",
  name,
  value,
  notWhen,
  formNoValidate,
}: {
  className: string;
  children: ReactNode;
  pendingLabel?: string;
  name?: string;
  value?: string;
  notWhen?: string;
  formNoValidate?: boolean;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && (name ? data?.get(name) === value : !(notWhen && data?.has(notWhen)));
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formNoValidate={formNoValidate}
      disabled={pending}
      aria-busy={mine || undefined}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {mine ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 animate-spin rounded-pill border-2 border-current border-t-transparent" />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
