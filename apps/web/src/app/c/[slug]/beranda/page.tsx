import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getConsents, getCurrentPlan, getLatestAssessment, getMyRequests, requirePatient } from "@/lib/session";
import { logout } from "../actions";


export default async function Beranda({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ info?: string }> }) {
  const { slug } = await params;
  const { info } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  const me = await requirePatient(slug);
  const consents = await getConsents(slug);
  if (consents.every((c) => !c.decided)) redirect(`/c/${slug}/consent`);
  const granted = consents.filter((c) => c.granted).length;
  const assessment = await getLatestAssessment(slug);
  const requests = await getMyRequests(slug);
  const plan = await getCurrentPlan(slug);
  const accepted = requests.find((r) => r.status === "accepted" && r.consultation);
  const pending = requests.find((r) => r.status === "submitted");
  const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }) + " WIB";
  const steps: { title: string; status: string; state: "done" | "wait" | "todo" }[] = [
    {
      title: "Assessment",
      status: assessment?.status === "completed" ? "Selesai" : assessment ? "Sedang berjalan" : "Belum dimulai",
      state: assessment?.status === "completed" ? "done" : "todo",
    },
    {
      title: "Konsultasi",
      status: accepted ? `Terjadwal ${fmt(accepted.consultation!.scheduled_at)}` : pending ? "Menunggu tinjauan" : "Belum diajukan",
      state: accepted ? "done" : pending ? "wait" : "todo",
    },
    {
      title: "Rencana personal",
      status: plan ? `Siap dilihat · versi ${plan.version}` : accepted ? "Menunggu tinjauan profesional" : "Tersedia setelah konsultasi",
      state: plan ? "done" : accepted ? "wait" : "todo",
    },
    { title: "Follow-up & progres", status: "Belum dimulai", state: "todo" },
  ];

  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Beranda</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Selamat datang di {clinic.name}</h1>
        <p className="mt-2 text-base text-body">Masuk sebagai {me.email}</p>
        {info === "terkirim" && (
          <p role="status" className="mt-4 rounded-md bg-sand px-4 py-3 text-base text-navy">
            Selesai. Permintaan konsultasi Anda sudah terkirim dan akan ditinjau tim klinik.
          </p>
        )}
        {info === "ada" && (
          <p role="status" className="mt-4 rounded-md bg-sand px-4 py-3 text-base text-navy">
            Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik.
          </p>
        )}
        {accepted?.consultation && (
          <p className="mt-4 text-base text-navy">
            Tautan pertemuan:{" "}
            <a href={accepted.consultation.meeting_url} rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
              Buka ruang konsultasi
            </a>
          </p>
        )}

        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Perjalanan Anda">
          {steps.map((st, i) => (
            <li
              key={st.title}
              className={`rounded-lg border bg-white p-4 ${st.state === "todo" ? "border-line" : "border-copper"}`}
            >
              <span className="block text-[13px] font-medium text-body">Langkah {i + 1}</span>
              <span className="block text-base font-semibold text-navy">{st.title}</span>
              <span className="mt-1 block text-[13px] font-medium text-body">{st.status}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/c/${clinic.slug}/assessment`}
            className="inline-flex items-center gap-2 rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white shadow-soft"
          >
            {assessment?.status === "completed" ? "Ulangi assessment" : "Mulai assessment"} <ArrowRight aria-hidden="true" size={18} strokeWidth={1.5} />
          </Link>
          {plan && (
            <Link href={`/c/${clinic.slug}/rencana`} className="inline-flex items-center rounded-pill bg-navy px-7 py-3 text-lg font-semibold text-white">
              Lihat rencana
            </Link>
          )}
          <Link
            href={`/c/${clinic.slug}/program`}
            className="inline-flex items-center rounded-pill border border-navy px-7 py-3 text-lg font-semibold text-navy"
          >
            Siapkan konsultasi
          </Link>
        </div>

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
