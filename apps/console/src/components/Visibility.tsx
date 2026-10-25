import { Eye, Lock } from "lucide-react";

/** Penanda visual: catatan internal (indigo) — tidak pernah terlihat pasien. Hanya tampilan; tidak mengubah data. */
export function InternalBadge({ children = "Hanya tim klinis" }: { children?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill border border-[var(--status-internal-border)] bg-[var(--status-internal-bg)] px-2 py-0.5 text-[11px] font-semibold text-internal">
      <Lock aria-hidden="true" size={12} strokeWidth={1.75} />
      {children}
    </span>
  );
}

/** Penanda visual: konten yang terlihat pasien (rencana bertanda tangan, resep terbit). */
export function PatientVisibleBadge({ children = "Terlihat pasien" }: { children?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill border border-copper/40 bg-[#ECFEFF] px-2 py-0.5 text-[11px] font-semibold text-copper-ink">
      <Eye aria-hidden="true" size={12} strokeWidth={1.75} />
      {children}
    </span>
  );
}

/** Kartu catatan internal: latar indigo muda + penanda gembok. */
export const internalCard = "rounded-lg border border-[var(--status-internal-border)] bg-[var(--status-internal-bg)] p-4 md:p-6";
/** Kartu konten terlihat pasien: putih dengan border cyan. */
export const visibleCard = "rounded-lg border-2 border-copper bg-white p-4 md:p-6";
