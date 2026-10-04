import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardList, Home, LogOut } from "lucide-react";
import { requireStaff } from "@/lib/api";
import { staffLogout } from "../actions";

const roleLabel = { professional: "Profesional", clinic_admin: "Admin klinik", aevia_admin: "Admin platform", patient: "Pasien" };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff();
  const nav = [
    { href: "/beranda", label: "Beranda", Icon: Home },
    ...(me.role === "aevia_admin" ? [] : [{ href: "/antrean", label: "Antrean", Icon: ClipboardList }]),
  ];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-deep text-white md:sticky md:top-0 md:h-screen">
        <div className="flex items-center justify-between gap-4 px-4 py-4 md:block md:p-6">
          <div>
            <p className="font-serif text-2xl">AEVIA</p>
            <p className="text-[13px] font-medium text-white/70">Console</p>
          </div>
          <nav aria-label="Navigasi utama" className="flex gap-1 md:mt-8 md:flex-col">
            {nav.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium text-white/90 hover:bg-white/10">
                <Icon aria-hidden="true" size={18} strokeWidth={1.5} />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden border-t border-white/10 p-6 md:absolute md:bottom-0 md:block md:w-full">
          <p className="text-base font-semibold">{me.name}</p>
          <p className="text-[13px] font-medium text-white/70">
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
