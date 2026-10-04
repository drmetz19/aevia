import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getConsents, requirePatient } from "@/lib/session";
import { logout } from "../actions";

const steps = ["Assessment", "Konsultasi", "Rencana personal", "Follow-up & progres"];

export default async function Beranda({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  const me = await requirePatient(slug);
  const consents = await getConsents(slug);
  if (consents.every((c) => !c.decided)) redirect(`/c/${slug}/consent`);
  const granted = consents.filter((c) => c.granted).length;

  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">Beranda</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Selamat datang di {clinic.name}</h1>
        <p className="mt-2 text-base text-body">Masuk sebagai {me.email}</p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-4" aria-label="Perjalanan Anda">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`rounded-lg border p-4 text-base font-semibold ${i === 0 ? "border-copper bg-white text-navy" : "border-line bg-white text-body"}`}
            >
              <span className="block text-[13px] font-medium text-slate">Langkah {i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        <Link
          href={`/c/${clinic.slug}/assessment`}
          className="mt-8 inline-flex items-center gap-2 rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft"
        >
          Mulai assessment <ArrowRight aria-hidden="true" size={18} strokeWidth={1.5} />
        </Link>

        <section className="mt-10 rounded-lg border border-line bg-white p-6 shadow-soft" aria-labelledby="pers">
          <h2 id="pers" className="text-xl font-semibold leading-7 text-navy">
            Persetujuan data
          </h2>
          <p className="mt-1 text-base text-body">{granted} dari 4 cakupan sedang Anda setujui.</p>
          <Link href={`/c/${clinic.slug}/consent`} className="mt-3 inline-block text-base font-semibold text-navy underline underline-offset-4">
            Atur persetujuan
          </Link>
        </section>

        <form action={logout} className="mt-8">
          <input type="hidden" name="slug" value={clinic.slug} />
          <button type="submit" className="rounded-pill border border-navy px-6 py-3 text-base font-semibold text-navy">
            Keluar
          </button>
        </form>
      </main>
    </div>
  );
}
