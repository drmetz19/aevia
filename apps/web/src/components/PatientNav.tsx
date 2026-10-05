import Link from "next/link";
import { ClipboardList, House, LayoutGrid, ScrollText, TrendingUp } from "lucide-react";

export type PatientTab = "beranda" | "assessment" | "program" | "rencana" | "progres";

const TABS: { key: PatientTab; label: string; Icon: typeof House }[] = [
  { key: "beranda", label: "Beranda", Icon: House },
  { key: "assessment", label: "Assessment", Icon: ClipboardList },
  { key: "program", label: "Program", Icon: LayoutGrid },
  { key: "rencana", label: "Rencana", Icon: ScrollText },
  { key: "progres", label: "Progres", Icon: TrendingUp },
];

/** Tab bar bawah untuk layar kecil (jempol-friendly, aman untuk notch). */
export function PatientTabBar({ slug, active }: { slug: string; active?: PatientTab }) {
  return (
    <nav aria-label="Navigasi pasien" className="tabbar fixed inset-x-0 bottom-0 z-40 border-t border-line lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map(({ key, label, Icon }) => {
          const on = key === active;
          return (
            <li key={key}>
              <Link
                href={`/c/${slug}/${key}`}
                aria-current={on ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-semibold tracking-wide ${on ? "text-navy" : "text-slate"}`}
              >
                {on && <span aria-hidden="true" className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-copper" />}
                <span className={`flex h-8 w-12 items-center justify-center rounded-pill transition-colors ${on ? "bg-sand" : ""}`}>
                  <Icon aria-hidden="true" size={20} strokeWidth={on ? 2 : 1.5} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Menu horizontal di header untuk layar lebar. */
export function PatientTopNav({ slug, active }: { slug: string; active?: PatientTab }) {
  return (
    <nav aria-label="Menu pasien" className="hidden lg:block">
      <ul className="flex items-center gap-1">
        {TABS.map(({ key, label }) => {
          const on = key === active;
          return (
            <li key={key}>
              <Link
                href={`/c/${slug}/${key}`}
                aria-current={on ? "page" : undefined}
                className={`rounded-pill px-4 py-2 text-[15px] font-semibold transition-colors ${on ? "bg-navy text-white" : "text-navy hover:bg-sand"}`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
