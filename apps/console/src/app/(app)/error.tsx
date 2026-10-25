"use client";

import { useEffect, useState } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";

const RELOAD_KEY = "aevia-console-reload-at";

/** Batas error konsol. Form dari halaman yang dibuka sebelum deploy baru → muat ulang sekali otomatis (maks. 1× per 30 dtk). */
export default function ConsoleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const stale = unstable_isUnrecognizedActionError(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    console.error(error);
    if (!stale) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    } catch {}
    if (Date.now() - last < 30_000) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {}
    setReloading(true);
    window.location.reload();
  }, [error, stale]);

  return (
    <div className="rounded-lg border border-line bg-white p-6">
      <h1 className="text-[22px] font-semibold text-navy">{stale ? "Konsol sudah diperbarui" : "Ada yang belum berjalan semestinya"}</h1>
      <p className="mt-2 text-base text-body">
        {reloading
          ? "Sebentar, kami memuat versi terbaru…"
          : stale
            ? "Muat ulang halaman, lalu kirim lagi. Isian terakhir belum tersimpan."
            : "Silakan coba lagi. Bila masih terjadi, muat ulang halaman."}
      </p>
      {!reloading && (
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-action px-6 py-3 text-base font-semibold text-white">
            Muat ulang halaman
          </button>
          {!stale && (
            <button type="button" onClick={() => retry()} className="rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-navy">
              Coba lagi
            </button>
          )}
        </div>
      )}
    </div>
  );
}
