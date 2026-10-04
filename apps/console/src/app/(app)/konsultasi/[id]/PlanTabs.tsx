import { PLAN_HEADINGS, SUMMARY_HEADINGS, findForbidden, formatDateId, planListSchema, prescriptionListSchema, type PlanView, type PrescriptionView } from "@aevia/core";
import { fmtDate, staffFetch } from "@/lib/api";
import { issueRxAction, savePlanAction, saveRxAction, signPlanAction } from "./actions";

const card = "rounded-lg border border-line bg-white p-6 shadow-soft";
const h2 = "text-xl font-semibold leading-7 text-navy";
const input = "mt-1 w-full rounded-md border border-line bg-ivory px-3 py-2 text-base text-navy";
const lab = "block text-[13px] font-medium text-navy";
const STATUS = { draft: "Draf", issued: "Diterbitkan", superseded: "Digantikan", signed: "Ditandatangani" } as const;

/** Peringatan non-blocking: profesional yang memutuskan, kami hanya mengingatkan istilah di luar bahasa AEVIA. */
function Warning({ texts }: { texts: string[] }) {
  const terms = [...new Set(texts.flatMap((t) => findForbidden(t)))];
  if (!terms.length) return null;
  return (
    <p role="status" className="rounded-md border border-warning bg-white px-4 py-3 text-base text-navy">
      <strong className="font-semibold">Perhatian: </strong>
      teks memuat istilah yang sebaiknya dihindari dalam bahasa AEVIA ({terms.map((t) => `"${t}"`).join(", ")}). Anda tetap dapat menyimpan dan menandatangani; keputusan ada pada profesional.
    </p>
  );
}

const Status = ({ s }: { s: keyof typeof STATUS }) => (
  <span className="inline-flex items-center gap-2 rounded-pill border border-line px-3 py-0.5 text-[13px] font-semibold text-navy">
    <span aria-hidden="true" className={`h-2 w-2 rounded-pill ${s === "issued" || s === "signed" ? "bg-success" : s === "draft" ? "bg-warning" : "bg-slate"}`} />
    {STATUS[s]}
  </span>
);

export async function RxTab({ id }: { id: string }) {
  const res = await staffFetch(`/v1/staff/consultations/${id}/prescriptions`);
  const list: PrescriptionView[] = res.ok ? prescriptionListSchema.parse(await res.json()).prescriptions : [];
  const draft = list.find((r) => r.status === "draft");
  const base = draft ?? list.find((r) => r.status === "issued");
  const rows = [...(base?.items ?? [])];
  while (rows.length < Math.max(3, (base?.items.length ?? 0) + 1)) rows.push({ name: "", strength: "", dose: "", frequency: "", route: "", duration: "", notes: "" });
  const fields = [["name", "Nama obat"], ["strength", "Kekuatan"], ["dose", "Dosis"], ["frequency", "Frekuensi"], ["route", "Rute"], ["duration", "Durasi"], ["notes", "Catatan"]] as const;

  return (
    <div className="mt-6 space-y-6">
      <form action={saveRxAction} className={`space-y-4 ${card}`}>
        <input type="hidden" name="consultation_id" value={id} />
        <Warning texts={(draft?.items ?? []).flatMap((i) => [i.name, i.notes, i.dose, i.frequency])} />
        <h2 className={h2}>{draft ? `Resep (draf versi ${draft.version})` : base ? `Versi baru dari resep versi ${base.version}` : "Resep baru"}</h2>
        <p className="text-base text-body">Resep hanya dibuat oleh profesional. Resep yang sudah diterbitkan tidak dapat diubah; perubahan membuat versi baru.</p>
        {rows.map((r, i) => (
          <fieldset key={i} className="rounded-md border border-line p-4">
            <legend className="px-2 text-[13px] font-medium text-body">Item {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map(([k, l]) => (
                <div key={k} className={k === "name" || k === "notes" ? "sm:col-span-3" : ""}>
                  <label htmlFor={`i${i}-${k}`} className={lab}>{l}</label>
                  <input id={`i${i}-${k}`} name={`i${i}-${k}`} defaultValue={r[k]} maxLength={k === "notes" ? 300 : 120} className={input} />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="submit" className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">Simpan draf resep</button>
      </form>

      {draft && (
        <form action={issueRxAction} className={card}>
          <input type="hidden" name="consultation_id" value={id} />
          <input type="hidden" name="rx_id" value={draft.id} />
          <h2 className={h2}>Terbitkan resep</h2>
          <p className="mt-1 text-base text-body">Setelah diterbitkan, pasien dapat melihat resep ini (hanya baca) dan isinya terkunci.</p>
          <button type="submit" className="mt-3 rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white">Terbitkan resep</button>
        </form>
      )}

      <section aria-labelledby="rxv" className={card}>
        <h2 id="rxv" className={h2}>Riwayat versi</h2>
        {list.length === 0 ? <p className="mt-2 text-base text-body">Belum ada resep.</p> : (
          <ol className="mt-3 space-y-4">
            {list.map((r) => (
              <li key={r.id} className="border-b border-line pb-4 last:border-0">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-navy">Versi {r.version} <Status s={r.status} /></p>
                <p className="text-[13px] font-medium text-body">{r.issued_at ? `Diterbitkan ${fmtDate(r.issued_at)} oleh ${r.issued_by_name}` : `Diperbarui ${fmtDate(r.updated_at)}`}</p>
                <ul className="mt-2 list-inside list-disc text-base text-navy">
                  {r.items.map((i, n) => <li key={n}>{i.name}{[i.strength, i.dose, i.frequency, i.route, i.duration].filter(Boolean).length ? ` — ${[i.strength, i.dose, i.frequency, i.route, i.duration].filter(Boolean).join(", ")}` : ""}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export async function PlanTab({ id }: { id: string }) {
  const res = await staffFetch(`/v1/staff/consultations/${id}/care-plans`);
  const list: PlanView[] = res.ok ? planListSchema.parse(await res.json()).plans : [];
  const draft = list.find((p) => p.status === "draft");
  const base = draft ?? list.find((p) => p.status === "signed");
  const c = base?.content;
  const metrics = [...(c?.monitor ?? [])];
  while (metrics.length < Math.max(3, metrics.length + 1) && metrics.length < 5) metrics.push({ metric_key: "", label: "", unit: "", baseline: null, target: null, direction: "up" });

  return (
    <div className="mt-6 space-y-6">
      <form action={savePlanAction} className={`space-y-5 ${card}`}>
        <input type="hidden" name="consultation_id" value={id} />
        <Warning texts={draft ? [draft.summary.discussed, ...draft.summary.priorities, ...draft.content.focus, ...draft.content.next_steps, ...draft.content.monitor.map((m) => m.label)] : []} />
        <h2 className={h2}>{draft ? `Rencana personal (draf versi ${draft.version})` : base ? `Versi baru dari rencana versi ${base.version}` : "Rencana personal baru"}</h2>
        <p className="text-base text-body">Rencana yang sudah ditandatangani terkunci. Mengubahnya membuat versi baru yang perlu ditandatangani lagi.</p>
        <div>
          <label htmlFor="discussed" className={lab}>{SUMMARY_HEADINGS.discussed} (ringkasan konsultasi)</label>
          <textarea id="discussed" name="discussed" rows={3} maxLength={2000} defaultValue={base?.summary.discussed} className={input} />
        </div>
        <div>
          <label htmlFor="priorities" className={lab}>{SUMMARY_HEADINGS.priorities} (satu per baris)</label>
          <textarea id="priorities" name="priorities" rows={3} defaultValue={base?.summary.priorities.join("\n")} className={input} />
        </div>
        <div>
          <label htmlFor="focus" className={lab}>{PLAN_HEADINGS.focus} (satu per baris)</label>
          <textarea id="focus" name="focus" rows={3} defaultValue={c?.focus.join("\n")} className={input} />
        </div>
        <div>
          <label htmlFor="next_steps" className={lab}>{PLAN_HEADINGS.next} (satu per baris)</label>
          <textarea id="next_steps" name="next_steps" rows={4} defaultValue={c?.next_steps.join("\n")} className={input} />
        </div>
        <fieldset>
          <legend className={lab}>{PLAN_HEADINGS.monitor} (metrik dan target)</legend>
          <div className="mt-2 space-y-3">
            {metrics.map((m, i) => (
              <div key={i} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-5">
                <div className="sm:col-span-2"><label htmlFor={`m${i}-label`} className={lab}>Metrik {i + 1}</label><input id={`m${i}-label`} name={`m${i}-label`} defaultValue={m.label} maxLength={80} className={input} /></div>
                <div><label htmlFor={`m${i}-unit`} className={lab}>Satuan</label><input id={`m${i}-unit`} name={`m${i}-unit`} defaultValue={m.unit} maxLength={20} className={input} /></div>
                <div><label htmlFor={`m${i}-baseline`} className={lab}>Saat ini</label><input id={`m${i}-baseline`} name={`m${i}-baseline`} inputMode="decimal" defaultValue={m.baseline ?? ""} className={input} /></div>
                <div><label htmlFor={`m${i}-target`} className={lab}>Target</label><input id={`m${i}-target`} name={`m${i}-target`} inputMode="decimal" defaultValue={m.target ?? ""} className={input} /></div>
                <div className="sm:col-span-2">
                  <label htmlFor={`m${i}-direction`} className={lab}>Arah yang diharapkan</label>
                  <select id={`m${i}-direction`} name={`m${i}-direction`} defaultValue={m.direction} className={input}><option value="up">Naik</option><option value="down">Turun</option></select>
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="review_at" className={lab}>{PLAN_HEADINGS.review}</label>
          <input id="review_at" name="review_at" type="date" defaultValue={c?.review_at ?? ""} className={input} />
        </div>
        <button type="submit" className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">Simpan draf rencana</button>
      </form>

      {draft && (
        <form action={signPlanAction} className={card}>
          <input type="hidden" name="consultation_id" value={id} />
          <input type="hidden" name="plan_id" value={draft.id} />
          <h2 className={h2}>Tanda tangan rencana</h2>
          <p className="mt-1 text-base text-body">Setelah ditandatangani, pasien melihat rencana ini dan versi sebelumnya digantikan. Simpan draf terlebih dulu bila ada perubahan.</p>
          <label className="mt-3 flex items-start gap-3 text-base text-navy">
            <input type="checkbox" name="confirm" className="mt-1 h-5 w-5 accent-[var(--brand-primary)]" />
            Saya telah meninjau seluruh isi rencana ini dan bertanggung jawab secara profesional atasnya.
          </label>
          <button type="submit" className="mt-4 rounded-pill bg-copper px-7 py-3 text-lg font-semibold text-white">Tandatangani rencana</button>
        </form>
      )}

      <section aria-labelledby="plv" className={card}>
        <h2 id="plv" className={h2}>Riwayat versi</h2>
        {list.length === 0 ? <p className="mt-2 text-base text-body">Belum ada rencana.</p> : (
          <ol className="mt-3 space-y-4">
            {list.map((p) => (
              <li key={p.id} className="border-b border-line pb-4 last:border-0">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-navy">Versi {p.version} <Status s={p.status} /></p>
                <p className="text-[13px] font-medium text-body">{p.signed_at ? `Ditandatangani ${fmtDate(p.signed_at)} oleh ${p.signed_by_name}` : `Diperbarui ${fmtDate(p.updated_at)}`}</p>
                <p className="mt-1 text-base text-navy">Fokus: {p.content.focus.join("; ") || "-"}</p>
                {p.content.review_at && <p className="text-base text-body">Tinjau kembali: {formatDateId(p.content.review_at)}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
