import type { ReactNode } from "react";
import type { PublicClinic } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { PatientTabBar, type PatientTab } from "@/components/PatientNav";
import { brandStyle } from "@/lib/api";

/** Kerangka halaman pasien: latar berlapis, header, menu (atas di desktop, tab bar bawah di mobile). */
export function PatientShell({
  clinic,
  active,
  nav = true,
  width = "max-w-3xl",
  children,
}: {
  clinic: PublicClinic;
  active?: PatientTab;
  nav?: boolean;
  width?: string;
  children: ReactNode;
}) {
  return (
    <div style={brandStyle(clinic)} className="page-atmos min-h-screen">
      <ClinicHeader clinic={clinic} nav={nav} active={active} />
      <main className={`mx-auto ${width} px-4 pt-7 sm:px-6 sm:pt-10 ${nav ? "pb-tabbar" : "pb-14"}`}>{children}</main>
      {nav && <PatientTabBar slug={clinic.slug} active={active} />}
    </div>
  );
}
