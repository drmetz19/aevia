"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ClipboardList, Home, Palette, Sparkles, Users, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { home: Home, building: Building2, sparkles: Sparkles, clipboard: ClipboardList, palette: Palette, users: Users };

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

/** Navigasi utama console: item aktif latar cyan muda + teks cyan (desain terkunci). */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Navigasi utama"
      className="-mb-px flex gap-1 overflow-x-auto px-2 pb-2 pt-3 [scrollbar-width:none] md:mt-6 md:flex-col md:overflow-visible md:px-4 md:pb-0 [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,#000_85%,transparent)] md:[mask-image:none]"
    >
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]!;
        const on =
          href === "/pengaturan/brand"
            ? path.startsWith("/pengaturan") && !path.startsWith("/pengaturan/staf")
            : path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-base font-medium ${on ? "bg-[#ECFEFF] font-semibold text-copper" : "text-body hover:bg-sand"}`}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
