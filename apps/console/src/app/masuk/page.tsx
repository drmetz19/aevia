import type { Metadata } from "next";
import { StaffLoginForm } from "./StaffLoginForm";

export const metadata: Metadata = { title: "Masuk — AEVIA Console" };

export default async function Masuk({ searchParams }: { searchParams: Promise<{ sesi?: string }> }) {
  const { sesi } = await searchParams;
  return (
    <main className="grid min-h-screen md:grid-cols-[360px_1fr]">
      <aside className="hidden bg-deep p-8 text-white md:block">
        <p className="font-serif text-2xl">AEVIA</p>
        <p className="mt-2 text-[13px] font-medium text-white/70">Console klinik & profesional</p>
      </aside>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Console</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-9 text-navy">Masuk</h1>
          <p className="mt-2 text-base text-body">Gunakan email staf Anda. Kami akan mengirim kode masuk sekali pakai.</p>
          <StaffLoginForm ended={sesi === "berakhir"} />
        </div>
      </section>
    </main>
  );
}
