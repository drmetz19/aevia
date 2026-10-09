import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, authLink } from "@/components/AuthShell";
import { StaffLoginForm } from "./StaffLoginForm";

export const metadata: Metadata = { title: "Masuk dengan kode — AEVIA Console" };

export default async function MasukKode({ searchParams }: { searchParams: Promise<{ sesi?: string }> }) {
  const { sesi } = await searchParams;
  return (
    <AuthShell eyebrow="Console" title="Masuk dengan kode" lead="Kami akan mengirim kode masuk sekali pakai ke email staf Anda.">
      <StaffLoginForm ended={sesi === "berakhir"} />
      <div className="mt-3 border-t border-line pt-3">
        <Link href="/masuk" className={authLink}>Masuk dengan password</Link>
      </div>
    </AuthShell>
  );
}
