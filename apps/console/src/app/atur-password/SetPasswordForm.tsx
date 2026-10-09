"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setPasswordAction, type PasswordState } from "../actions";
import { authInput, authLabel, authLink, authPrimary } from "@/components/AuthShell";

export function SetPasswordForm({ token }: { token: string }) {
  const [s, action, pending] = useActionState<PasswordState, FormData>(setPasswordAction, {});
  const expired = s.error?.includes("tidak berlaku");
  return (
    <div className="mt-6 space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-1.5">
          <label className={authLabel} htmlFor="password">Password baru</label>
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={authInput} />
        </div>
        <div className="space-y-1.5">
          <label className={authLabel} htmlFor="confirm">Ulangi password</label>
          <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={authInput} />
        </div>
        {s.error && <p role="alert" className="text-base text-critical">{s.error}</p>}
        <button type="submit" disabled={pending} className={authPrimary}>
          {pending ? "Menyimpan…" : "Simpan dan masuk"}
        </button>
      </form>
      {expired && (
        <Link href="/lupa-password" className={authLink}>Minta link baru</Link>
      )}
    </div>
  );
}
