"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordLinkAction, type PasswordState } from "../actions";
import { authInput, authLabel, authLink, authPrimary } from "@/components/AuthShell";

export function RequestLinkForm() {
  const [s, action, pending] = useActionState<PasswordState, FormData>(requestPasswordLinkAction, {});
  return (
    <div className="mt-6 space-y-4">
      {s.sent ? (
        <div role="status" className="space-y-2 rounded-md bg-sand px-4 py-3 text-base text-navy">
          <p>{s.sent}</p>
          <p className="text-[13px] font-medium text-body">Belum masuk? Cek folder Spam/Promosi. Link berlaku 60 menit (undangan staf baru: 72 jam).</p>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <label className={authLabel} htmlFor="email">Email staf</label>
            <input id="email" name="email" type="email" required autoComplete="email" defaultValue={s.email} placeholder="nama@klinik.id" className={authInput} />
          </div>
          {s.error && <p role="alert" className="text-base text-critical">{s.error}</p>}
          <button type="submit" disabled={pending} className={authPrimary}>
            {pending ? "Mengirim…" : "Kirim link"}
          </button>
        </form>
      )}
      <div className="border-t border-line pt-3">
        <Link href="/masuk" className={authLink}>Kembali ke halaman masuk</Link>
      </div>
    </div>
  );
}
