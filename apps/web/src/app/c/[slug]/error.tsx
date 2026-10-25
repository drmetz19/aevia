"use client";

import { useEffect, useState } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";

const RELOAD_KEY = "aevia-reload-at";

/**
 * Batas error halaman pasien. Kasus utama: halaman dibuka sebelum deploy baru lalu form dikirim —
 * aksi server versi lama tidak dikenal (UnrecognizedActionError). Muat ulang sekali otomatis;
 * bila terulang dalam 30 dtk, tampilkan pesan agar tidak berputar terus.
 */
export default function PatientError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
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
    <div className="page-atmos flex min-h-screen items-center">
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-bold text-[30px] leading-[1.15] text-navy sm:text-4xl">
          {stale ? "Halaman sudah diperbarui" : "Ada yang belum berjalan semestinya"}
        </h1>
        <p className="mt-4 text-body">
          {reloading
            ? "Sebentar, kami memuat versi terbaru…"
            : stale
              ? "Muat ulang halaman, lalu kirim lagi. Isian terakhir Anda belum terkirim."
              : "Silakan coba lagi. Bila masih terjadi, muat ulang halaman."}
        </p>
        {!reloading && (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex w-full items-center justify-center rounded-md bg-action px-6 py-3.5 text-base font-semibold text-white transition active:scale-[0.98] sm:w-auto"
            >
              Muat ulang halaman
            </button>
            {!stale && (
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex w-full items-center justify-center rounded-md border border-line bg-surface px-6 py-3.5 text-base font-semibold text-navy transition active:scale-[0.98] sm:w-auto"
              >
                Coba lagi
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
