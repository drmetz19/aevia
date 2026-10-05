import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, ClipboardList, Home, LogOut, Palette, Sparkles, Users } from "lucide-react";
import { requireStaff } from "@/lib/api";
import { staffLogout } from "../actions";

const roleLabel = { professional: "Profesional", clinic_admin: "Admin klinik", aevia_admin: "Admin platform", patient: "Pasien" };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff();
  const nav = [
    { href: "/beranda", label: "Beranda", Icon: Home },
    ...(me.role === "aevia_admin"
      ? [
          { href: "/admin/klinik", label: "Klinik", Icon: Building2 },
          { href: "/admin/asisten", label: "Nama asisten", Icon: Sparkles },
        ]
      : [{ href: "/antrean", label: "Antrean", Icon: ClipboardList }]),
    ...(me.role === "clinic_admin"
      ? [
          { href: "/pengaturan/brand", label: "Pengaturan", Icon: Palette },
          { href: "/pengaturan/staf", label: "Staf", Icon: Users },
        ]
      : []),
  ];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="bg-deep text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex items-center justify-between gap-4 px-4 pt-4 md:block md:px-6 md:pt-6">
          <div>
            <p className="font-serif text-2xl">AEVIA</p>
            <p className="text-[13px] font-medium text-white/80">Console</p>
          </div>
          <form action={staffLogout} className="md:hidden">
            <button type="submit" aria-label={`Keluar (${me.name})`} className="flex min-h-11 items-center gap-2 rounded-pill border border-white/30 px-4 text-[13px] font-semibold text-white">
              <LogOut aria-hidden="true" size={16} strokeWidth={1.5} /> Keluar
            </button>
          </form>
        </div>
        <nav
          aria-label="Navigasi utama"
          className="-mb-px flex gap-1 overflow-x-auto px-2 pb-2 pt-3 [scrollbar-width:none] md:mt-6 md:flex-col md:overflow-visible md:px-4 md:pb-0 [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,#000_85%,transparent)] md:[mask-image:none]"
        >
          {nav.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-base font-medium text-white/90 hover:bg-white/10"
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.5} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-white/10 p-6 md:block">
          <p className="text-base font-semibold">{me.name}</p>
          <p className="text-[13px] font-medium text-white/80">
            {roleLabel[me.role]}
            {me.clinic_slug ? ` · ${me.clinic_slug}` : ""}
          </p>
          <form action={staffLogout} className="mt-3">
            <button type="submit" className="flex items-center gap-2 text-base font-medium text-white/90 underline underline-offset-4">
              <LogOut aria-hidden="true" size={16} strokeWidth={1.5} /> Keluar
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 bg-ivory">{children}</div>
    </div>
  );
}
