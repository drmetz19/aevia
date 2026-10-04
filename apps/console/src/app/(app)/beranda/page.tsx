import Link from "next/link";
import { requireStaff } from "@/lib/api";

export default async function Beranda() {
  const me = await requireStaff();
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Console</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">Selamat datang, {me.name}</h1>
      <p className="mt-2 text-base text-body">{me.email}</p>
      {me.role !== "aevia_admin" ? (
        <Link href="/antrean" className="mt-6 inline-flex rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">
          Lihat antrean permintaan
        </Link>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/admin/klinik" className="inline-flex rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">
            Kelola klinik
          </Link>
          <Link href="/admin/asisten" className="inline-flex rounded-pill border border-line px-6 py-3 text-base font-semibold text-navy">
            Tinjau nama asisten
          </Link>
        </div>
      )}
    </main>
  );
}
