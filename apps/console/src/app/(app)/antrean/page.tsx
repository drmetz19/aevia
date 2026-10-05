import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, EyeOff } from "lucide-react";
import { queueSchema } from "@aevia/core";
import { fmtDate, requireStaff, staffFetch } from "@/lib/api";

const statusLabel = { submitted: "Menunggu ditinjau", accepted: "Diterima", declined: "Ditolak" } as const;

export default async function Antrean() {
  const me = await requireStaff();
  if (me.role === "aevia_admin") redirect("/beranda");
  const res = await staffFetch("/v1/staff/queue");
  const { items } = res.ok ? queueSchema.parse(await res.json()) : { items: [] };
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Antrean</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">Permintaan konsultasi</h1>
      <p className="mt-2 text-base text-body">Permintaan terbaru dari pasien klinik Anda. Yang menunggu ditinjau tampil lebih dulu.</p>
      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-white p-6 text-base text-body">Belum ada permintaan konsultasi.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-white shadow-soft">
          <table className="table-stack w-full min-w-[640px] text-left text-base">
            <caption className="sr-only">Daftar permintaan konsultasi</caption>
            <thead className="border-b border-line text-[13px] font-medium text-body">
              <tr>
                <th scope="col" className="px-4 py-3">Pasien</th>
                <th scope="col" className="px-4 py-3">Program</th>
                <th scope="col" className="px-4 py-3">Diajukan</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/pasien/${i.patient_id}`} className="inline-block py-2 font-semibold text-navy underline underline-offset-4 [overflow-wrap:anywhere]">
                      {i.patient_email}
                    </Link>
                    {i.flagged && (
                      <span className="mt-1 flex items-center gap-1 text-[13px] font-medium text-critical">
                        <AlertTriangle aria-hidden="true" size={14} strokeWidth={1.5} /> Perlu perhatian segera
                      </span>
                    )}
                    {!i.assessment_visible && (
                      <span className="mt-1 flex items-center gap-1 text-[13px] font-medium text-body">
                        <EyeOff aria-hidden="true" size={14} strokeWidth={1.5} /> Assessment tidak dibagikan
                      </span>
                    )}
                  </td>
                  <td data-label="Program" className="px-4 py-3 text-navy">{i.program_name}</td>
                  <td data-label="Diajukan" className="px-4 py-3 text-body">{fmtDate(i.created_at)}</td>
                  <td data-label="Status" className="px-4 py-3 font-semibold text-navy">
                    {statusLabel[i.status]}
                    {i.scheduled_at && <span className="block text-[13px] font-medium text-body">{fmtDate(i.scheduled_at)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
