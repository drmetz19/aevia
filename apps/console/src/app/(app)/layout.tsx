import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { AeviaLogo } from "@aevia/ui/logo";
import { SidebarNav, type NavItem } from "@/components/SidebarNav";
import { requireStaff } from "@/lib/api";
import { staffLogout } from "../actions";

const roleLabel = { professional: "Profesional", clinic_admin: "Admin klinik", aevia_admin: "Admin platform", patient: "Pasien" };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff();
  const nav: NavItem[] = [
    { href: "/beranda", label: "Beranda", icon: "home" },
    ...(me.role === "aevia_admin"
      ? [
          { href: "/admin/klinik", label: "Klinik", icon: "building" },
          { href: "/admin/asisten", label: "Nama asisten", icon: "sparkles" },
        ]
      : [{ href: "/antrean", label: "Antrean", icon: "clipboard" }]),
    ...(me.role === "clinic_admin"
      ? [
          { href: "/pengaturan/brand", label: "Pengaturan", icon: "palette" },
          { href: "/pengaturan/staf", label: "Staf", icon: "users" },
        ]
      : []),
  ];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-4 px-4 pt-4 md:block md:px-6 md:pt-6">
          <div>
            <AeviaLogo size={32} />
            <p className="mt-1 hidden text-[13px] font-medium text-slate md:block">Console klinik &amp; profesional</p>
          </div>
          <form action={staffLogout} className="md:hidden">
            <button type="submit" aria-label={`Keluar (${me.name})`} className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-4 text-[13px] font-semibold text-navy">
              <LogOut aria-hidden="true" size={16} strokeWidth={1.75} /> Keluar
            </button>
          </form>
        </div>
        <SidebarNav items={nav} />
        <div className="mt-auto hidden border-t border-line p-6 md:block">
          <p className="text-base font-semibold text-navy">{me.name}</p>
          <p className="text-[13px] font-medium text-slate">
            {roleLabel[me.role]}
            {me.clinic_slug ? ` · ${me.clinic_slug}` : ""}
          </p>
          <form action={staffLogout} className="mt-3">
            <button type="submit" className="flex items-center gap-2 text-base font-medium text-navy underline underline-offset-4">
              <LogOut aria-hidden="true" size={16} strokeWidth={1.75} /> Keluar
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 bg-ivory">{children}</div>
    </div>
  );
}
