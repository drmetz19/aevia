import Link from "next/link";
import { requireStaff } from "@/lib/api";

export default async function Beranda() {
  const me = await requireStaff();
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Console</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">Selamat datang, {me.name}</h1>
      <p className="mt-2 text-base text-body">{me.email}</p>
      {me.role !== "aevia_admin" ? (
        <Link href="/antrean" className="mt-6 inline-flex rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">
          Lihat antrean permintaan
        </Link>
      ) : (
        <p className="mt-6 text-base text-body">Alat admin platform akan tersedia pada tahap berikutnya.</p>
      )}
    </main>
  );
}
