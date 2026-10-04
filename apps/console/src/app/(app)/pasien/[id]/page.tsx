import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EyeOff } from "lucide-react";
import { PROGRESS_EMPTY, areaLabel, patientDetailSchema, progressSchema, resultSchema } from "@aevia/core";
import { ProgressCard } from "@aevia/ui/progress";
import { z } from "zod";
import { fmtDate, requireStaff, staffFetch } from "@/lib/api";
import { AcceptDialog } from "./AcceptDialog";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ info?: string; tab?: string }> };
const statusLabel = { submitted: "Menunggu ditinjau", accepted: "Diterima", declined: "Ditolak" } as const;

export default async function Pasien({ params, searchParams }: Props) {
  const { id } = await params;
  const { info, tab } = await searchParams;
  const me = await requireStaff();
  if (me.role === "aevia_admin") redirect("/beranda");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const res = await staffFetch(`/v1/staff/patients/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API pasien gagal (${res.status})`);
  const d = patientDetailSchema.parse(await res.json());
  const showProgress = tab === "progres";
  const pRes = showProgress ? await staffFetch(`/v1/staff/patients/${id}/progress`) : null;
  const prog = pRes?.ok
    ? z.object({ progress_visible: z.boolean(), hidden_reason: z.string().nullable(), progress: progressSchema.nullable() }).parse(await pRes.json())
    : null;
  const result = d.assessment ? resultSchema.safeParse(d.assessment.result) : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <Link href="/antrean" className="text-base font-semibold text-navy underline underline-offset-4">← Antrean</Link>
      <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Pasien</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">{d.patient.email}</h1>
      <p className="mt-1 text-base text-body">Terdaftar {fmtDate(d.patient.created_at)}</p>
      {info === "diterima" && (
        <p role="status" className="mt-4 rounded-md bg-sand px-4 py-3 text-base text-navy">Selesai. Konsultasi sudah dijadwalkan dan pasien dapat melihatnya.</p>
      )}

      <nav aria-label="Bagian pasien" className="mt-6 flex gap-2">
        {([["ringkasan", "Ringkasan"], ["progres", "Progres"]] as const).map(([k, l]) => (
          <Link key={k} href={`/pasien/${id}${k === "progres" ? "?tab=progres" : ""}`} aria-current={(showProgress ? "progres" : "ringkasan") === k ? "page" : undefined}
            className={`rounded-pill px-5 py-2 text-base font-semibold ${(showProgress ? "progres" : "ringkasan") === k ? "bg-navy text-white" : "border border-line bg-white text-navy"}`}>
            {l}
          </Link>
        ))}
      </nav>

      {showProgress && (
        <section aria-labelledby="pg" className="mt-6">
          <h2 id="pg" className="sr-only">Progres pasien</h2>
          {!prog ? (
            <p className="text-base text-body">Data progres belum dapat dimuat. Silakan coba lagi.</p>
          ) : !prog.progress_visible ? (
            <p className="flex gap-2 rounded-lg border border-line bg-white p-6 text-base text-body shadow-soft"><EyeOff aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />{prog.hidden_reason}</p>
          ) : prog.progress && prog.progress.checkin_count > 0 ? (
            <>
              <p className="mb-4 text-base text-body">{prog.progress.checkin_count} check-in · terakhir {fmtDate(prog.progress.last_checkin_at!)}{prog.progress.general ? " · metrik umum (belum ada rencana ditandatangani)" : ""}</p>
              <div className="grid gap-4 md:grid-cols-2">{prog.progress.metrics.map((m) => <ProgressCard key={m.key} metric={m} />)}</div>
            </>
          ) : (
            <p className="rounded-lg border border-line bg-white p-6 text-base text-body shadow-soft">{PROGRESS_EMPTY}</p>
          )}
        </section>
      )}

      {!showProgress && <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="as" className="rounded-lg border border-line bg-white p-6 shadow-soft">
          <h2 id="as" className="text-xl font-semibold leading-7 text-navy">Assessment</h2>
          {!d.assessment_visible ? (
            <p className="mt-3 flex gap-2 text-base text-body">
              <EyeOff aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />
              {d.hidden_reason}
            </p>
          ) : result?.success ? (
            <>
              {d.assessment?.flagged && (
                <p role="alert" className="mt-3 text-base font-semibold text-critical">Pasien menuliskan tanda yang perlu perhatian segera.</p>
              )}
              <ul className="mt-3 space-y-2">
                {result.data.areas.map((a) => (
                  <li key={a.area} className="flex items-center justify-between gap-3 text-base text-navy">
                    <span>{a.label}</span>
                    <span className="font-semibold">{a.level_label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-base text-body">
                Prioritas: {result.data.priorities.map(areaLabel).join(", ")}. {result.data.disclaimer}
              </p>
            </>
          ) : (
            <p className="mt-3 text-base text-body">Pasien belum menyelesaikan assessment.</p>
          )}
        </section>

        <section aria-labelledby="rq" className="space-y-4">
          <h2 id="rq" className="text-xl font-semibold leading-7 text-navy">Permintaan konsultasi</h2>
          {d.requests.length === 0 && <p className="text-base text-body">Belum ada permintaan.</p>}
          {d.requests.map((r) => (
            <article key={r.id} className="rounded-lg border border-line bg-white p-6 shadow-soft">
              <p className="text-[13px] font-medium text-body">{fmtDate(r.created_at)} · {statusLabel[r.status]}</p>
              <h3 className="mt-1 text-xl font-semibold leading-7 text-navy">{r.program_name}</h3>
              {r.prep ? (
                <dl className="mt-3 space-y-3 text-base text-navy">
                  <div><dt className="text-[13px] font-medium text-body">Tujuan</dt><dd>{r.prep.tujuan || "-"}</dd></div>
                  <div><dt className="text-[13px] font-medium text-body">Keluhan</dt><dd>{r.prep.keluhan || "-"}</dd></div>
                  <div>
                    <dt className="text-[13px] font-medium text-body">Pertanyaan untuk profesional</dt>
                    <dd>{r.prep.pertanyaan.length ? <ul className="list-inside list-disc">{r.prep.pertanyaan.map((q) => <li key={q}>{q}</li>)}</ul> : "-"}</dd>
                  </div>
                  <div><dt className="text-[13px] font-medium text-body">Konteks assessment</dt><dd>{r.prep.konteks_assessment || "-"}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 flex gap-2 text-base text-body"><EyeOff aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />Isi persiapan disembunyikan karena persetujuan assessment tidak aktif.</p>
              )}
              {r.consultation && (
                <p className="mt-3 text-base text-navy">
                  Terjadwal {fmtDate(r.consultation.scheduled_at)} ·{" "}
                  <Link href={`/konsultasi/${r.consultation.id}`} className="font-semibold underline underline-offset-4">Buka catatan konsultasi</Link> ·{" "}
                  <a href={r.consultation.meeting_url} rel="noopener noreferrer" className="font-semibold underline underline-offset-4">Tautan pertemuan</a>
                </p>
              )}
              {r.status === "submitted" && <div className="mt-4"><AcceptDialog requestId={r.id} patientId={d.patient.id} /></div>}
            </article>
          ))}
        </section>
      </div>}
    </main>
  );
}
