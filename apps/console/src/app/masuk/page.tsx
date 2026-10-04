import type { Metadata } from "next";

export const metadata: Metadata = { title: "Masuk — AEVIA Console" };

export default function Masuk() {
  return (
    <main className="grid min-h-screen md:grid-cols-[360px_1fr]">
      <aside className="hidden bg-deep p-8 text-white md:block">
        <p className="font-serif text-2xl">AEVIA</p>
        <p className="mt-2 text-[13px] font-medium text-white/70">Console klinik & profesional</p>
      </aside>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">Console</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-9 text-navy">Masuk</h1>
          <p className="mt-2 text-base text-slate">Gunakan email staf Anda. Kami akan mengirim kode masuk sekali pakai.</p>
          <form className="mt-6 space-y-4">
            <label className="block text-[13px] font-medium text-navy" htmlFor="email">
              Email staf
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="nama@klinik.id"
              className="w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy"
            />
            <button
              type="button"
              disabled
              className="w-full rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white opacity-60"
            >
              Kirim kode masuk
            </button>
            <p className="text-[13px] font-medium text-slate">Fitur masuk akan aktif pada tahap berikutnya.</p>
          </form>
        </div>
      </section>
    </main>
  );
}
