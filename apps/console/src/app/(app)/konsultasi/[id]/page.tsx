import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EyeOff, Video } from "lucide-react";
import { auditListSchema, consultationDetailSchema, photoUrlSchema, skinSchema } from "@aevia/core";
import { fmtDate, publicFileUrl, requireStaff, staffFetch } from "@/lib/api";
import { AnnotationEditor } from "./AnnotationEditor";
import { PlanTab, RxTab } from "./PlanTabs";
import { saveSkinAction, saveSoapAction, uploadPhotoAction } from "./actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; info?: string; pesan?: string }> };
const TABS = [
  { key: "soap", label: "SOAP" },
  { key: "skin", label: "Skin" },
  { key: "resep", label: "Resep" },
  { key: "rencana", label: "Rencana" },
  { key: "audit", label: "Audit" },
] as const;
const area = "mt-1 w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy";
const ACTION: Record<string, string> = {
  "soap.create": "SOAP dibuat",
  "soap.update": "SOAP diubah",
  "skin.create": "Analisis kulit dibuat",
  "skin.update": "Analisis kulit diubah",
  "photo.upload": "Foto diunggah",
  "photo.annotations": "Anotasi foto diubah",
  "rx.create": "Draf resep dibuat",
  "rx.update": "Draf resep diubah",
  "rx.issue": "Resep diterbitkan",
  "rx.supersede": "Resep digantikan versi baru",
  "plan.create": "Draf rencana dibuat",
  "plan.new_version": "Versi baru rencana dibuat",
  "plan.update": "Draf rencana diubah",
  "plan.sign": "Rencana ditandatangani",
  "plan.supersede": "Rencana digantikan versi baru",
};
const FIELD: Record<string, string> = {
  subjective: "Subjective (S)",
  objective: "Objective (O)",
  assessment: "Assessment (A)",
  plan: "Plan (P)",
  scores: "Skor kulit",
  notes: "Catatan",
  annotations: "Anotasi",
  items: "Item resep",
  content: "Isi rencana",
  summary: "Ringkasan",
  status: "Status",
  version: "Versi",
  by_version: "Digantikan oleh versi",
  from_version: "Dari versi",
  signature_hash: "Kode tanda tangan",
  angle: "Sudut foto",
  content_type: "Jenis berkas",
  bytes: "Ukuran (byte)",
  consultation_id: "Konsultasi",
};
const humanKey = (k: string) => FIELD[k] ?? k.replace(/_/g, " ");

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(kosong)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "(kosong)";
    return v.map((x) => (typeof x === "object" && x !== null ? ((x as { label?: string; name?: string }).label ?? (x as { name?: string }).name ?? show(x)) : String(x))).join(", ");
  }
  const o = v as Record<string, unknown>;
  return Object.entries(o).map(([k, x]) => `${humanKey(k)}: ${show(x)}`).join("; ");
}

function changed(before: unknown, after: unknown): { key: string; from: string; to: string }[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: humanKey(k), from: show(b[k]), to: show(a[k]) }));
}

export default async function Konsultasi({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab = "soap", info, pesan } = await searchParams;
  const me = await requireStaff();
  if (me.role !== "professional") redirect("/beranda");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const res = await staffFetch(`/v1/staff/consultations/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API konsultasi gagal (${res.status})`);
  const k = consultationDetailSchema.parse(await res.json());
  const active = TABS.some((t) => t.key === tab) ? tab : "soap";

  const skinRes = active === "skin" || k.photos_consent ? await staffFetch(`/v1/staff/consultations/${id}/skin`) : null;
  const skin = skinRes?.ok ? skinSchema.parse(await skinRes.json()) : null;
  const thumbs = skin
    ? await Promise.all(
        skin.photos.map(async (p) => {
          const r = await staffFetch(`/v1/staff/photos/${p.id}/url`);
          return r.ok ? publicFileUrl(photoUrlSchema.parse(await r.json()).url) : null;
        }),
      )
    : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <Link href={`/pasien/${k.patient.id}`} className="text-base font-semibold text-navy underline underline-offset-4">← {k.patient.email}</Link>
      <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Konsultasi</p>
      <h1 className="mt-1 font-serif text-4xl text-navy">{k.program_name}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside aria-label="Ringkasan pasien" className="space-y-4">
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Pasien</p>
            <p className="mt-1 text-base font-semibold text-navy">{k.patient.email}</p>
            <p className="mt-2 text-base text-body">{fmtDate(k.scheduled_at)}</p>
            <a href={k.meeting_url} rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-navy underline underline-offset-4">
              <Video aria-hidden="true" size={18} strokeWidth={1.5} /> Buka ruang konsultasi
            </a>
          </section>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Foto klinis</p>
            {!k.photos_consent ? (
              <p className="mt-2 flex gap-2 text-base text-body"><EyeOff aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />Pasien belum memberi persetujuan foto, atau sudah mencabutnya. Foto disembunyikan.</p>
            ) : skin && skin.photos.length ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {skin.photos.map((p, i) =>
                  thumbs[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.id} src={thumbs[i]!} alt={`Foto klinis, sudut ${p.angle}`} className="aspect-square w-full rounded-md object-cover" />
                  ) : null,
                )}
              </div>
            ) : (
              <p className="mt-2 text-base text-body">Belum ada foto.</p>
            )}
          </section>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-copper-ink">Assessment</p>
            <p className="mt-2 text-base text-body">{k.assessment_visible ? "Dibagikan pasien." : "Tidak dibagikan oleh pasien."}</p>
            <Link href={`/pasien/${k.patient.id}`} className="mt-2 inline-block text-base font-semibold text-navy underline underline-offset-4">Lihat di profil pasien</Link>
          </section>
        </aside>

        <section aria-label="Catatan konsultasi">
          <nav aria-label="Bagian konsultasi" className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/konsultasi/${id}?tab=${t.key}`}
                aria-current={active === t.key ? "page" : undefined}
                className={`rounded-pill px-5 py-2 text-base font-semibold ${active === t.key ? "bg-navy text-white" : "border border-line bg-white text-navy"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {info && <p role="status" className="mt-4 rounded-md bg-sand px-4 py-3 text-base text-navy">{info === "foto" ? "Selesai. Foto tersimpan." : info === "terbit" ? "Selesai. Resep diterbitkan." : info === "ditandatangani" ? "Selesai. Rencana ditandatangani dan kini terlihat oleh pasien." : "Selesai. Perubahan tersimpan."}</p>}
          {pesan && <p role="alert" className="mt-4 text-base text-critical">{pesan}</p>}

          {active === "soap" && (
            <form action={saveSoapAction} className="mt-6 space-y-5 rounded-lg border border-line bg-white p-6 shadow-soft">
              <input type="hidden" name="consultation_id" value={id} />
              <h2 className="text-xl font-semibold leading-7 text-navy">Catatan SOAP</h2>
              {([["subjective", "S — Subjective (keluhan dan riwayat dari pasien)"], ["objective", "O — Objective (temuan pemeriksaan)"], ["assessment", "A — Assessment (penilaian profesional)"], ["plan", "P — Plan (rencana tindakan dan tindak lanjut)"]] as const).map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={name} className="block text-[13px] font-medium text-navy">{label}</label>
                  <textarea id={name} name={name} rows={4} maxLength={5000} defaultValue={k.soap[name]} className={area} />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">Simpan SOAP</button>
                {k.soap.updated_at && <p className="text-[13px] font-medium text-body">Terakhir disimpan {fmtDate(k.soap.updated_at)}</p>}
              </div>
            </form>
          )}

          {active === "skin" && skin && (
            <div className="mt-6 space-y-6">
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Ringkasan skor kulit">
                {skin.parameters.map((p) => {
                  const v = skin.scores[p.key];
                  return (
                    <li key={p.key} className="rounded-lg border border-line bg-white p-4 shadow-soft">
                      <p className="text-[13px] font-medium text-body">{p.label}</p>
                      <p className="mt-1 font-serif text-4xl text-navy">{v ?? "–"}</p>
                      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-pill bg-sand"><div className="h-full bg-copper" style={{ width: `${v ?? 0}%` }} /></div>
                    </li>
                  );
                })}
              </ul>

              <form action={saveSkinAction} className="space-y-4 rounded-lg border border-line bg-white p-6 shadow-soft">
                <input type="hidden" name="consultation_id" value={id} />
                <h2 className="text-xl font-semibold leading-7 text-navy">Skor per parameter (0–100)</h2>
                <p className="text-base text-body">Skor diisi manual oleh profesional berdasarkan pemeriksaan.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {skin.parameters.map((p) => (
                    <div key={p.key}>
                      <label htmlFor={`s-${p.key}`} className="block text-[13px] font-medium text-navy">{p.label}</label>
                      <input id={`s-${p.key}`} name={`score:${p.key}`} type="number" inputMode="numeric" min={0} max={100} step={1} defaultValue={skin.scores[p.key]} className={area} />
                    </div>
                  ))}
                </div>
                <div>
                  <label htmlFor="notes" className="block text-[13px] font-medium text-navy">Catatan analisis</label>
                  <textarea id="notes" name="notes" rows={3} maxLength={3000} defaultValue={skin.notes} className={area} />
                </div>
                <button type="submit" className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">Simpan analisis</button>
              </form>

              <section aria-labelledby="foto" className="space-y-4 rounded-lg border border-line bg-white p-6 shadow-soft">
                <h2 id="foto" className="text-xl font-semibold leading-7 text-navy">Foto klinis dan anotasi</h2>
                {!skin.photos_consent ? (
                  <p className="flex gap-2 text-base text-body"><EyeOff aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />Pasien belum memberi persetujuan foto, atau sudah mencabutnya. Foto tidak dapat diunggah atau dilihat.</p>
                ) : (
                  <>
                    <form action={uploadPhotoAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="consultation_id" value={id} />
                      <div>
                        <label htmlFor="photo" className="block text-[13px] font-medium text-navy">Foto (JPG, PNG, atau WebP, maks. 10 MB)</label>
                        <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 text-base text-navy" />
                      </div>
                      <div>
                        <label htmlFor="angle" className="block text-[13px] font-medium text-navy">Sudut</label>
                        <select id="angle" name="angle" className="mt-1 rounded-md border border-line bg-ivory px-3 py-2 text-base text-navy">
                          <option value="front">Depan</option><option value="left">Kiri</option><option value="right">Kanan</option><option value="other">Lainnya</option>
                        </select>
                      </div>
                      <button type="submit" className="rounded-pill border border-navy px-6 py-2 text-base font-semibold text-navy">Unggah foto</button>
                    </form>
                    {skin.photos.length === 0 && <p className="text-base text-body">Belum ada foto untuk konsultasi ini.</p>}
                    {skin.photos.map((p, i) =>
                      thumbs[i] ? (
                        <div key={p.id} className="border-t border-line pt-4">
                          <h3 className="mb-3 text-base font-semibold text-navy">Sudut {p.angle} · {fmtDate(p.taken_at)}</h3>
                          <AnnotationEditor photoId={p.id} src={thumbs[i]!} angle={p.angle} initial={p.annotations} />
                        </div>
                      ) : null,
                    )}
                  </>
                )}
              </section>
            </div>
          )}

          {active === "resep" && <RxTab id={id} />}
          {active === "rencana" && <PlanTab id={id} />}

          {active === "audit" && <AuditTab id={id} />}
        </section>
      </div>
    </main>
  );
}

async function AuditTab({ id }: { id: string }) {
  const res = await staffFetch(`/v1/staff/consultations/${id}/audit`);
  const { entries } = res.ok ? auditListSchema.parse(await res.json()) : { entries: [] };
  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
      <h2 className="text-xl font-semibold leading-7 text-navy">Riwayat perubahan</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-base text-body">Belum ada perubahan tercatat.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {entries.map((e) => (
            <li key={e.id} className="border-b border-line pb-4 last:border-0">
              <p className="text-base font-semibold text-navy">{ACTION[e.action] ?? e.action}</p>
              <p className="text-[13px] font-medium text-body">{fmtDate(e.at)} · {e.actor_name ?? e.actor_type}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-base font-semibold text-navy underline underline-offset-4">Sebelum dan sesudah</summary>
                <dl className="mt-2 space-y-2 text-base text-navy">
                  {changed(e.before, e.after).map((c) => (
                    <div key={c.key}>
                      <dt className="text-[13px] font-medium text-body">{c.key}</dt>
                      <dd className="break-words">{c.from} → {c.to}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
