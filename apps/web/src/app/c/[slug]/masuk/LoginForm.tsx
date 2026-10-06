"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type FormState } from "../actions";

const input = "field";
const primary =
  "w-full rounded-pill bg-navy px-6 py-3.5 text-base font-semibold text-white shadow-soft transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70";

export function LoginForm({ slug, ended }: { slug: string; ended: boolean }) {
  const [req, reqAction, reqPending] = useActionState<FormState, FormData>(requestCode, {});
  const [ver, verAction, verPending] = useActionState<FormState, FormData>(verifyCode, {});
  const email = req.email;

  return (
    <div className="space-y-4">
      {ended && !email && (
        <p role="status" className="rounded-md bg-sand px-4 py-3 text-base text-navy">
          Sepertinya sesi Anda sudah berakhir. Silakan masuk kembali.
        </p>
      )}
      {!email ? (
        <form action={reqAction} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <label htmlFor="email" className="block text-[13px] font-semibold text-navy">
            Email Anda
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="nama@email.com" className={input} />
          {req.error && (
            <p role="alert" className="text-base text-critical">
              {req.error}
            </p>
          )}
          <button type="submit" disabled={reqPending} className={primary}>
            {reqPending ? "Mengirim…" : "Kirim kode masuk"}
          </button>
        </form>
      ) : (
        <>
          <form action={verAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="email" value={email} />
            <p className="text-base text-body">
              Kami mengirim kode 6 angka ke <strong className="font-semibold text-navy">{email}</strong>. Kode berlaku 10 menit.
            </p>
            <label htmlFor="code" className="block text-[13px] font-semibold text-navy">
              Kode masuk
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              placeholder="000000"
              className={`${input} text-center font-serif !text-[28px] tracking-[0.5em]`}
            />
            {ver.error && (
              <p role="alert" className="text-base text-critical">
                {ver.error}
              </p>
            )}
            <button type="submit" disabled={verPending} className={primary}>
              Masuk
            </button>
          </form>
          <form action={reqAction} className="text-center">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="email" value={email} />
            <button type="submit" disabled={reqPending} className="text-base font-semibold text-navy underline underline-offset-4">
              Kirim ulang kode
            </button>
          </form>
        </>
      )}
    </div>
  );
}
