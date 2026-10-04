"use client";

import { useActionState } from "react";
import { requestStaffCode, verifyStaffCode, type FormState } from "../actions";

const input = "w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy";
const primary = "w-full rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white";

export function StaffLoginForm({ ended }: { ended: boolean }) {
  const [req, reqAction, reqPending] = useActionState<FormState, FormData>(requestStaffCode, {});
  const [ver, verAction, verPending] = useActionState<FormState, FormData>(verifyStaffCode, {});
  const email = req.email;
  return (
    <div className="mt-6 space-y-4">
      {ended && !email && (
        <p role="status" className="rounded-md bg-sand px-4 py-3 text-base text-navy">
          Sepertinya sesi Anda sudah berakhir. Silakan masuk kembali.
        </p>
      )}
      {!email ? (
        <form action={reqAction} className="space-y-4">
          <label className="block text-[13px] font-medium text-navy" htmlFor="email">
            Email staf
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="nama@klinik.id" className={input} />
          {req.error && <p role="alert" className="text-base text-critical">{req.error}</p>}
          <button type="submit" disabled={reqPending} className={primary}>
            Kirim kode masuk
          </button>
        </form>
      ) : (
        <form action={verAction} className="space-y-4">
          <input type="hidden" name="email" value={email} />
          <p className="text-base text-body">Jika email terdaftar, kode 6 angka sudah kami kirim. Kode berlaku 10 menit.</p>
          <label className="block text-[13px] font-medium text-navy" htmlFor="code">
            Kode masuk
          </label>
          <input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" className={`${input} tracking-[0.4em]`} />
          {ver.error && <p role="alert" className="text-base text-critical">{ver.error}</p>}
          <button type="submit" disabled={verPending} className={primary}>
            Masuk
          </button>
        </form>
      )}
    </div>
  );
}
