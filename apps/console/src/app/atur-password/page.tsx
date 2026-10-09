import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, authLink } from "@/components/AuthShell";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = { title: "Buat password — AEVIA Console", referrer: "no-referrer" };

export default async function AturPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(token);
  return (
    <AuthShell eyebrow="Password" title="Buat password" lead="Buat password untuk akun staf Anda. Minimal 10 karakter; gabungan kata yang mudah Anda ingat sudah cukup kuat.">
      {valid ? (
        <SetPasswordForm token={token} />
      ) : (
        <div className="mt-6 space-y-3">
          <p role="alert" className="text-base text-critical">Link ini belum lengkap atau sudah tidak berlaku.</p>
          <Link href="/lupa-password" className={authLink}>Minta link baru</Link>
        </div>
      )}
    </AuthShell>
  );
}
