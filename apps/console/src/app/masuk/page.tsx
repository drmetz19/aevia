import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { PasswordLoginForm } from "./PasswordLoginForm";

export const metadata: Metadata = { title: "Masuk — AEVIA Console" };

export default async function Masuk({ searchParams }: { searchParams: Promise<{ sesi?: string }> }) {
  const { sesi } = await searchParams;
  return (
    <AuthShell eyebrow="Console" title="Masuk" lead="Masuk dengan email staf dan password Anda.">
      <PasswordLoginForm ended={sesi === "berakhir"} />
    </AuthShell>
  );
}
