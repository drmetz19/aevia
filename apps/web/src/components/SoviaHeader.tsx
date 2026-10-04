import Image from "next/image";
import type { PublicClinic } from "@aevia/core";

export function soviaTitle(c: PublicClinic) {
  return c.brand_mode === "whitelabel" ? `${c.assistant_name} · AI Guide` : `${c.assistant_name} · AI Guide by AEVIA`;
}

export function SoviaAvatar({ clinic, size = 40 }: { clinic: PublicClinic; size?: number }) {
  return (
    <Image
      src={clinic.avatar_url ?? "/sovia-avatar.png"}
      alt={`Avatar ${clinic.assistant_name}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-pill object-cover"
      unoptimized={Boolean(clinic.avatar_url)}
    />
  );
}

export function SoviaHeader({ clinic }: { clinic: PublicClinic }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <SoviaAvatar clinic={clinic} />
      <div className="min-w-0 leading-tight">
        <p className="text-base font-semibold text-navy">{soviaTitle(clinic)}</p>
        <p className="mt-0.5 inline-flex items-center gap-2 text-[13px] font-medium text-navy">
          <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-copper" />
          {clinic.assistant_name} adalah AI
        </p>
      </div>
    </div>
  );
}
