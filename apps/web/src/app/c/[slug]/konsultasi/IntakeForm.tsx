"use client";

import { useActionState } from "react";
import { Send, Ticket } from "lucide-react";
import type { Prep } from "@aevia/core";
import { SubmitButton } from "@/components/SubmitButton";
import { btnPrimary } from "@/components/PageIntro";
import { submitRequestAction, type RequestFormState } from "../actions";

const label = "flex items-center gap-2 text-[14px] font-semibold text-navy";
const Num = ({ n }: { n: number }) => (
  <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-pill bg-sand text-[12px] font-bold text-copper-ink">{n}</span>
);

/** Isian persiapan + kode voucher. Bila kirim gagal, isian dipulihkan dari status (tidak hilang). */
export function IntakeForm({ slug, programId, voucherRequired, prep, initialMessage }: { slug: string; programId: string; voucherRequired: boolean; prep: Prep; initialMessage?: string }) {
  const [state, action] = useActionState<RequestFormState, FormData>(submitRequestAction, {});
  const v = state.values ?? {
    tujuan: prep.tujuan,
    keluhan: prep.keluhan,
    pertanyaan: prep.pertanyaan.join("\n"),
    konteks_assessment: prep.konteks_assessment,
    voucher_code: "",
  };
  const message = state.error ?? (state.values ? undefined : initialMessage);
  // `key` memaksa isian memakai nilai pulihan setelah form di-reset React 19.
  const k = state.values ? JSON.stringify(state.values).length : 0;
  const voucherField = (
    <div>
      <label htmlFor="voucher_code" className={label}>
        <Ticket aria-hidden="true" size={16} strokeWidth={1.75} className="text-copper" />
        Kode voucher{voucherRequired ? "" : " (opsional)"}
      </label>
      <input
        id="voucher_code"
        name="voucher_code"
        defaultValue={v.voucher_code}
        key={`v${k}`}
        required={voucherRequired}
        maxLength={64}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={state.voucherError ? true : undefined}
        aria-describedby={state.voucherError ? "voucher-err" : "voucher-help"}
        className="field mt-2 font-mono uppercase tracking-wide"
      />
      {state.voucherError ? (
        <p id="voucher-err" role="alert" className="mt-2 text-[14px] font-medium text-critical">{state.voucherError}</p>
      ) : (
        <p id="voucher-help" className="mt-2 text-[13px] text-slate">
          {voucherRequired ? "Program ini memerlukan kode dari klinik. Hubungi klinik bila Anda belum memilikinya." : "Isi bila klinik memberi Anda kode khusus."}
        </p>
      )}
    </div>
  );
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="program_id" value={programId} />
      {message && (
        <p role="alert" className="text-base text-critical">
          {message}
        </p>
      )}
      <div>
        <label htmlFor="tujuan" className={label}><Num n={1} />Tujuan utama konsultasi</label>
        <textarea id="tujuan" name="tujuan" key={`t${k}`} rows={2} maxLength={600} required defaultValue={v.tujuan} className="field mt-2" />
      </div>
      <div>
        <label htmlFor="keluhan" className={label}><Num n={2} />Keluhan atau hal yang dirasakan</label>
        <textarea id="keluhan" name="keluhan" key={`k${k}`} rows={4} maxLength={1200} defaultValue={v.keluhan} className="field mt-2" />
      </div>
      <div>
        <label htmlFor="pertanyaan" className={label}><Num n={3} />Pertanyaan untuk profesional (satu per baris)</label>
        <textarea id="pertanyaan" name="pertanyaan" key={`p${k}`} rows={4} defaultValue={v.pertanyaan} className="field mt-2" />
      </div>
      <div>
        <label htmlFor="konteks" className={label}><Num n={4} />Konteks dari assessment</label>
        <textarea id="konteks" name="konteks_assessment" key={`c${k}`} rows={3} maxLength={1200} defaultValue={v.konteks_assessment} className="field mt-2" />
      </div>
      {voucherRequired ? (
        <div className="rounded-lg border border-line bg-ivory p-4">{voucherField}</div>
      ) : (
        <details open={Boolean(state.voucherError || v.voucher_code)} className="rounded-lg border border-line bg-ivory p-4">
          <summary className="cursor-pointer text-[14px] font-semibold text-navy">Punya kode voucher?</summary>
          <div className="mt-3">{voucherField}</div>
        </details>
      )}
      <SubmitButton className={btnPrimary} pendingLabel="Mengirim…">
        <Send aria-hidden="true" size={18} strokeWidth={1.75} /> Kirim permintaan konsultasi
      </SubmitButton>
    </form>
  );
}
