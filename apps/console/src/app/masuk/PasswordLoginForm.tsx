"use client";

import Link from "next/link";
import { useActionState } from "react";
import { passwordLogin, type PasswordState } from "../actions";
import { authInput, authLabel, authLink, authPrimary } from "@/components/AuthShell";

export function PasswordLoginForm({ ended }: { ended: boolean }) {
  const [s, action, pending] = useActionState<PasswordState, FormData>(passwordLogin, {});
  return (
    <div className="mt-6 space-y-4">
      {ended && !s.error && (
        <p role="status" className="rounded-md bg-sand px-4 py-3 text-base text-navy">
          Sepertinya sesi Anda sudah berakhir. Silakan masuk kembali.
        </p>
      )}
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <label className={authLabel} htmlFor="email">Email staf</label>
          <input id="email" name="email" type="email" required autoComplete="username" defaultValue={s.email} placeholder="nama@klinik.id" className={authInput} />
        </div>
        <div className="space-y-1.5">
          <label className={authLabel} htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className={authInput} />
        </div>
        {s.error && <p role="alert" className="text-base text-critical">{s.error}</p>}
        <button type="submit" disabled={pending} className={authPrimary}>
          {pending ? "Memeriksa…" : "Masuk"}
        </button>
      </form>
      <div className="flex flex-col border-t border-line pt-3">
        <Link href="/lupa-password" className={authLink}>Lupa atau belum punya password?</Link>
        <Link href="/masuk/kode" className={`${authLink} text-body`}>Masuk dengan kode email</Link>
      </div>
    </div>
  );
}
