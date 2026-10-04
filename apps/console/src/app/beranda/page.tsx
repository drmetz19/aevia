import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { staffMeSchema } from "@aevia/core";
import { STAFF_COOKIE } from "@/lib/cookie";
import { staffLogout } from "../actions";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const roleLabel = { professional: "Profesional", clinic_admin: "Admin klinik", aevia_admin: "Admin platform", patient: "Pasien" };

export default async function Beranda() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const res = token
    ? await fetch(`${API_URL}/v1/staff/me`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
    : null;
  if (!res || !res.ok) redirect("/masuk?sesi=berakhir");
  const me = staffMeSchema.parse(await res.json());
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">Console</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">Selamat datang, {me.name}</h1>
      <p className="mt-2 text-base text-body">
        {roleLabel[me.role]}
        {me.clinic_slug ? ` · ${me.clinic_slug}` : ""} · {me.email}
      </p>
      <p className="mt-6 text-base text-body">Antrean dan alat kerja akan tersedia pada tahap berikutnya.</p>
      <form action={staffLogout} className="mt-8">
        <button type="submit" className="rounded-pill border border-navy px-6 py-3 text-base font-semibold text-navy">
          Keluar
        </button>
      </form>
    </main>
  );
}
