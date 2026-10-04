import Link from "next/link";

const tabs = [
  { href: "/pengaturan/brand", label: "Merek & asisten" },
  { href: "/pengaturan/program", label: "Program" },
  { href: "/pengaturan/staf", label: "Staf" },
];

export function SettingsTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Pengaturan klinik" className="mb-8 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`rounded-pill px-4 py-2 text-base font-semibold ${t.href === current ? "bg-navy text-white" : "border border-line bg-white text-navy"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
