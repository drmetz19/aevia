"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { SEVERITY_INITIAL, SEVERITY_LABEL, type Annotation } from "@aevia/core";
import { saveAnnotationsAction } from "./actions";

type Sev = Annotation["severity"];
const SEV_COLOR: Record<Sev, string> = { low: "var(--status-success)", medium: "color-mix(in srgb, var(--status-warning) 90%, black)", high: "var(--status-critical)" };
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => Math.round(n * 1000) / 10;

interface Draft {
  type: "point" | "area";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  severity: Sev;
}

export function AnnotationEditor({ photoId, src, angle, initial }: { photoId: string; src: string; angle: string; initial: Annotation[] }) {
  const [items, setItems] = useState<Annotation[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [drawMode, setDrawMode] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Fokus: ke formulir anotasi baru saat dibuka, kembali ke tombol pembuka saat selesai/batal.
  useEffect(() => {
    if (draft) labelRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      openBtn.current?.focus();
    }
  }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const origin = useRef<{ x: number; y: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = surface.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && !drawMode) return; // sentuhan hanya menggambar bila Mode gambar aktif; selain itu halaman tetap bisa di-scroll
    surface.current?.setPointerCapture(e.pointerId);
    origin.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const p = pos(e);
    const o = origin.current;
    const w = Math.abs(p.x - o.x);
    const h = Math.abs(p.y - o.y);
    if (w > 0.015 || h > 0.015) setDraft((d) => ({ type: "area", x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w, h, label: d?.label ?? "", severity: d?.severity ?? "medium" }));
  };
  const up = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const o = origin.current;
    origin.current = null;
    if (!draft || draft.type === "point") setDraft((d) => ({ type: "point", x: o.x, y: o.y, w: 0.1, h: 0.1, label: d?.label ?? "", severity: d?.severity ?? "medium" }));
    surface.current?.releasePointerCapture(e.pointerId);
  };

  const setNum = (k: "x" | "y" | "w" | "h", v: string) => setDraft((d) => (d ? { ...d, [k]: clamp(Number(v) / 100 || 0) } : d));
  const add = () => {
    if (!draft) return;
    const base = { label: draft.label.trim() || (draft.type === "point" ? "Titik" : "Area"), severity: draft.severity, x: draft.x, y: draft.y };
    const a: Annotation =
      draft.type === "point"
        ? { type: "point", ...base }
        : { type: "area", ...base, w: Math.min(draft.w, 1 - draft.x) || 0.05, h: Math.min(draft.h, 1 - draft.y) || 0.05 };
    setItems((l) => [...l, a]);
    returnFocus.current = true;
    setDraft(null);
    setDirty(true);
    setStatus(null);
  };
  const remove = (i: number) => {
    setItems((l) => l.filter((_, j) => j !== i));
    setDirty(true);
    setStatus(null);
  };
  const save = () => start(async () => {
    const r = await saveAnnotationsAction(photoId, items);
    setStatus(r);
    if (r.ok) setDirty(false);
  });

  const shapes = (blur: boolean) =>
    items.map((a, i) =>
      a.type === "area" ? (
        <div
          key={i}
          aria-hidden="true"
          className="absolute"
          style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${(a.w ?? 0) * 100}%`, height: `${(a.h ?? 0) * 100}%`, background: SEV_COLOR[a.severity], opacity: blur ? 0.55 : 0.35, filter: blur ? "blur(10px)" : undefined, border: blur ? undefined : `2px solid ${SEV_COLOR[a.severity]}`, borderRadius: 8 }}
        />
      ) : blur ? null : (
        <span
          key={i}
          aria-hidden="true"
          className="absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-pill border-2 border-white px-1 text-[13px] font-semibold text-white"
          style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, background: SEV_COLOR[a.severity] }}
        >
          {i + 1}{SEVERITY_INITIAL[a.severity]}
        </span>
      ),
    );

  const field = "mt-1 w-full rounded-md border border-line bg-ivory px-3 py-2 text-base text-navy";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
        <figure>
          <div ref={surface} onPointerDown={down} onPointerMove={move} onPointerUp={up} className={`relative cursor-crosshair select-none overflow-hidden rounded-lg bg-sand ${drawMode ? "touch-none" : "[@media(pointer:fine)]:touch-none"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Foto klinis, sudut ${angle}`} draggable={false} className="block w-full" />
            {overlay && shapes(false)}
            {draft && (
              <div
                aria-hidden="true"
                className="absolute border-2 border-dashed border-white bg-white/30"
                style={draft.type === "area" ? { left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` } : { left: `calc(${draft.x * 100}% - 10px)`, top: `calc(${draft.y * 100}% - 10px)`, width: 20, height: 20, borderRadius: 999 }}
              />
            )}
          </div>
          <figcaption className="mt-2 text-[13px] font-medium text-body">Klik foto untuk menambah titik, seret untuk menambah area. Foto klinis; overlay digambar manual oleh profesional.</figcaption>
        </figure>
        <figure>
          <div className="relative overflow-hidden rounded-lg bg-sand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" aria-hidden="true" className="block w-full grayscale" />
            {shapes(true)}
          </div>
          <figcaption className="mt-2 text-[13px] font-medium text-body">Overlay area (digambar manual)</figcaption>
        </figure>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" aria-pressed={drawMode} onClick={() => setDrawMode((v) => !v)} className={`rounded-pill border border-navy px-5 py-2 text-base font-semibold ${drawMode ? "bg-navy text-white" : "text-navy"}`}>
          Mode gambar (layar sentuh): {drawMode ? "aktif" : "nonaktif"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-base text-navy">
        <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
        Tampilkan anotasi pada foto
      </label>

      <div className="rounded-lg border border-line bg-white p-4">
        {draft ? (
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="space-y-3" aria-label="Anotasi baru">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="col-span-2 text-[13px] font-medium text-navy sm:col-span-1">
                Jenis
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })} className={field}>
                  <option value="point">Titik</option>
                  <option value="area">Area</option>
                </select>
              </label>
              {(["x", "y", ...(draft.type === "area" ? (["w", "h"] as const) : [])] as ("x" | "y" | "w" | "h")[]).map((k) => (
                <label key={k} className="text-[13px] font-medium text-navy">
                  {{ x: "Posisi kiri (%)", y: "Posisi atas (%)", w: "Lebar (%)", h: "Tinggi (%)" }[k]}
                  <input type="number" min={0} max={100} step={0.5} value={pct(draft[k])} onChange={(e) => setNum(k, e.target.value)} className={field} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[13px] font-medium text-navy">
                Label
                <input ref={labelRef} value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={field} />
              </label>
              <label className="text-[13px] font-medium text-navy">
                Tingkat
                <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as Sev })} className={field}>
                  {(Object.keys(SEVERITY_LABEL) as Sev[]).map((s) => (
                    <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="rounded-pill bg-navy px-5 py-2 text-base font-semibold text-white">Tambahkan</button>
              <button type="button" onClick={() => { returnFocus.current = true; setDraft(null); }} className="rounded-pill border border-navy px-5 py-2 text-base font-semibold text-navy">Batal</button>
            </div>
          </form>
        ) : (
          <button ref={openBtn} type="button" onClick={() => setDraft({ type: "point", x: 0.5, y: 0.5, w: 0.1, h: 0.1, label: "", severity: "medium" })} className="rounded-pill border border-navy px-5 py-2 text-base font-semibold text-navy">
            Tambah anotasi lewat formulir
          </button>
        )}
      </div>

      <section aria-label="Daftar anotasi">
        <h4 className="text-base font-semibold text-navy">Anotasi ({items.length})</h4>
        {items.length === 0 ? (
          <p className="mt-1 text-base text-body">Belum ada anotasi pada foto ini.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {items.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-base text-navy">
                <span>
                  <strong className="font-semibold">{i + 1}. {a.label}</strong> · {a.type === "point" ? "Titik" : "Area"} ·{" "}
                  <span className="inline-flex items-center gap-1 rounded-pill px-2 text-[13px] font-semibold text-white" style={{ background: SEV_COLOR[a.severity] }}><span aria-hidden="true">{SEVERITY_INITIAL[a.severity]}</span>{SEVERITY_LABEL[a.severity]}</span>
                  <span className="block text-[13px] font-medium text-body">
                    kiri {pct(a.x)}%, atas {pct(a.y)}%{a.type === "area" ? `, lebar ${pct(a.w ?? 0)}%, tinggi ${pct(a.h ?? 0)}%` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => remove(i)} aria-label={`Hapus anotasi ${i + 1}: ${a.label}`} className="rounded-md p-2 text-navy hover:bg-sand">
                  <Trash2 aria-hidden="true" size={18} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
          Simpan anotasi
        </button>
        <p role="status" className={`text-base ${status && !status.ok ? "text-critical" : "text-navy"}`}>{status?.message}</p>
      </div>
    </div>
  );
}
