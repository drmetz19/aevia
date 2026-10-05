export default function NotFound() {
  return (
    <div className="page-atmos flex min-h-screen items-center">
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <p aria-hidden="true" className="numeral text-[120px]">404</p>
        <h1 className="mt-2 font-serif text-[30px] leading-[1.15] text-navy sm:text-4xl">Klinik belum ditemukan</h1>
        <p className="mt-4 text-body">Periksa kembali tautan dari klinik Anda, lalu coba lagi.</p>
      </main>
    </div>
  );
}
