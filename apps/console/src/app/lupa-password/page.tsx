import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { RequestLinkForm } from "./RequestLinkForm";

export const metadata: Metadata = { title: "Atur password — AEVIA Console" };

export default function LupaPassword() {
  return (
    <AuthShell eyebrow="Password" title="Atur password" lead="Masukkan email staf Anda. Kami kirim link untuk membuat atau mengganti password.">
      <RequestLinkForm />
    </AuthShell>
  );
}
