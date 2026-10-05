"use client";

import { useState } from "react";
import { FONT_ALLOWLIST, validateBrand, type BrandSettings } from "@aevia/core";
import { saveBrand } from "../actions";
import { ActionForm, inputCls, labelCls, primaryCls, Submit } from "@/components/Ui";

type K = "primary" | "accent" | "background" | "surface";
const colorLabels: Record<K, string> = { primary: "Warna utama", accent: "Warna aksen", background: "Warna latar", surface: "Warna kartu" };

export function BrandForm({ b }: { b: BrandSettings }) {
  const [c, setC] = useState(b.colors);
  const v = validateBrand(c);
  return (
    <ActionForm action={saveBrand}>
              <>
          <fieldset className="space-y-2">
            <legend className={labelCls}>Mode merek</legend>
            {[
              ["cobrand", "Co-brand: tampil bersama “powered by AEVIA”"],
              ["whitelabel", "White-label: hanya merek klinik Anda"],
            ].map(([val, text]) => (
              <label key={val} className="flex items-center gap-3 text-base text-body">
                <input type="radio" name="brand_mode" value={val} defaultChecked={b.brand_mode === val} className="h-5 w-5" />
                {text}
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(Object.keys(colorLabels) as K[]).map((k) => (
              <div key={k}>
                <label htmlFor={k} className={labelCls}>{colorLabels[k]}</label>
                <div className="mt-1 flex items-center gap-3">
                  <input aria-label={`Pilih ${colorLabels[k].toLowerCase()}`} type="color" value={/^#[0-9a-f]{6}$/i.test(c[k]) ? c[k] : "#000000"} onChange={(e) => setC({ ...c, [k]: e.target.value.toUpperCase() })} className="h-12 w-14 rounded-md border border-line bg-white p-1" />
                  <input id={k} name={k} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className={inputCls} inputMode="text" autoComplete="off" spellCheck={false} />
                </div>
              </div>
            ))}
          </div>

          <section aria-labelledby="kontras" className="rounded-md border border-line bg-white p-4">
            <h2 id="kontras" className="text-base font-semibold text-navy">Pemeriksaan keterbacaan</h2>
            {v.problems.length === 0 && v.checks.length > 0 ? (
              <p role="status" className="mt-1 text-base text-success">Semua kombinasi warna terbaca dengan jelas.</p>
            ) : (
              <ul role="status" className="mt-1 list-disc space-y-1 pl-5 text-base text-critical">
                {v.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {v.checks.length > 0 && (
              <ul className="mt-3 grid grid-cols-1 gap-1 text-[13px] font-medium text-body sm:grid-cols-2">
                {v.checks.map((k) => (
                  <li key={k.id}>
                    {k.label}: {String(k.ratio).replace(".", ",")}:1 (minimal {String(k.min).replace(".", ",")}:1)
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div>
            <label htmlFor="font" className={labelCls}>Font</label>
            <select id="font" name="font" defaultValue={b.font ?? ""} className={inputCls}>
              <option value="">Bawaan AEVIA (Manrope)</option>
              {FONT_ALLOWLIST.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="custom_domain" className={labelCls}>Domain khusus (opsional)</label>
            <input id="custom_domain" name="custom_domain" defaultValue={b.custom_domain ?? ""} placeholder="sehat.klinikanda.id" className={inputCls} autoComplete="off" />
            <p className="mt-1 text-[13px] font-medium text-body">
              {b.custom_domain
                ? b.domain_verified
                  ? "Domain sudah diverifikasi dan aktif."
                  : "Domain menunggu verifikasi tim AEVIA. Arahkan DNS domain ke layanan kami; setelah diverifikasi, domain aktif otomatis."
                : "Setelah disimpan, tim AEVIA akan memverifikasi domain Anda."}
            </p>
          </div>

          <Submit disabled={!v.ok} className={primaryCls}>
            Simpan pengaturan merek
          </Submit>
        </>
    </ActionForm>
  );
}
