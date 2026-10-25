import { useId } from "react";

/**
 * Logo Aevia Konsult (sumber: design/stitch/aevia-konsult-logo.svg), SVG inline.
 * Hanya untuk tampilan cobrand / console AEVIA — jangan dirender pada whitelabel.
 */

/** Mark lingkaran saja. `decorative`: sembunyikan dari pembaca layar (mis. bila teks "Aevia Konsult" ada di sebelahnya). */
export function AeviaMark({ size = 32, decorative = false, className }: { size?: number; decorative?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const grad = `aevia-grad-${uid}`;
  const soft = `aevia-soft-${uid}`;
  return (
    <svg
      data-aevia-mark=""
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 96"
      width={size}
      height={size}
      fill="none"
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Aevia Konsult" })}
    >
      <defs>
        <linearGradient id={grad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0e7490" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id={soft} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0891b2" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="44" fill={`url(#${soft})`} />
      <path d="M48 16 C30 16 18 30 18 48 C18 66 30 80 48 80 C66 80 78 66 78 48" stroke={`url(#${grad})`} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M48 26 C36 26 28 36 28 48 C28 60 38 70 48 70 C58 70 68 60 68 48 C68 36 58 26 48 26 Z" stroke="#0e7490" strokeWidth="3" strokeDasharray="0.5 8" strokeLinecap="round" />
      <path d="M48 34 L56 48 L48 62 L40 48 Z" fill={`url(#${grad})`} />
      <circle cx="48" cy="48" r="3" fill="#ffffff" />
      <circle cx="48" cy="18" r="2.5" fill="#10b981" />
      <circle cx="78" cy="48" r="2.5" fill="#06b6d4" />
      <circle cx="48" cy="78" r="2.5" fill="#0e7490" />
      <circle cx="18" cy="48" r="2.5" fill="#0891b2" />
    </svg>
  );
}

/** Logo lengkap: mark + "AEVIA KONSULT". `tone="light"` untuk latar gelap. */
export function AeviaLogo({ size = 36, tone = "dark", className = "" }: { size?: number; tone?: "dark" | "light"; className?: string }) {
  const main = tone === "light" ? "text-white" : "text-navy";
  const accent = tone === "light" ? "text-copper-light" : "text-copper";
  return (
    <span role="img" aria-label="Aevia Konsult" className={`inline-flex items-center gap-2 ${className}`}>
      <AeviaMark size={size} decorative />
      <span aria-hidden="true" className={`leading-none ${main}`} style={{ fontSize: Math.round(size * 0.5) }}>
        <span className="font-bold tracking-[-0.03em]">AEVIA</span>{" "}
        <span className={`font-light tracking-[0.04em] ${accent}`}>KONSULT</span>
      </span>
    </span>
  );
}
