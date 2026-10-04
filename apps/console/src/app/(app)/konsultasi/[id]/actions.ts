"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { annotationSchema, angleSchema, MAX_PHOTO_BYTES, type Annotation } from "@aevia/core";
import { STAFF_COOKIE } from "@/lib/cookie";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const GENERIC = "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.";
const ID = /^[0-9a-f-]{36}$/;

async function api(path: string, init: RequestInit) {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) redirect("/masuk?sesi=berakhir");
  const res = await fetch(`${API_URL}${path}`, { ...init, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (res.status === 401) redirect("/masuk?sesi=berakhir");
  return res;
}
const msg = async (res: Response) => ((await res.json().catch(() => ({}))) as { message?: string }).message ?? GENERIC;
const back = (id: string, tab: string, q: string) => `/konsultasi/${id}?tab=${tab}&${q}`;

export async function saveSoapAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  if (!ID.test(id)) redirect("/antrean");
  const body = Object.fromEntries(["subjective", "objective", "assessment", "plan"].map((k) => [k, String(fd.get(k) ?? "").slice(0, 5000)]));
  const res = await api(`/v1/staff/consultations/${id}/soap`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  redirect(res.ok ? back(id, "soap", "info=tersimpan") : back(id, "soap", `pesan=${encodeURIComponent(await msg(res))}`));
}

export async function saveSkinAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  if (!ID.test(id)) redirect("/antrean");
  const scores: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("score:") || String(v).trim() === "") continue;
    scores[k.slice(6)] = Number(v);
  }
  const res = await api(`/v1/staff/consultations/${id}/skin`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scores, notes: String(fd.get("notes") ?? "").slice(0, 3000) }),
  });
  redirect(res.ok ? back(id, "skin", "info=tersimpan") : back(id, "skin", `pesan=${encodeURIComponent(res.status === 400 ? "Skor berada di antara 0 dan 100 (bilangan bulat)." : await msg(res))}`));
}

export async function uploadPhotoAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  if (!ID.test(id)) redirect("/antrean");
  const file = fd.get("photo");
  const angle = angleSchema.catch("front").parse(fd.get("angle"));
  if (!(file instanceof File) || file.size === 0) redirect(back(id, "skin", `pesan=${encodeURIComponent("Ada satu bagian yang belum terisi. Silakan pilih foto.")}`));
  if (file.size > MAX_PHOTO_BYTES) redirect(back(id, "skin", `pesan=${encodeURIComponent("Ukuran foto melebihi 10 MB. Silakan pilih foto yang lebih kecil.")}`));
  const res = await api(`/v1/staff/consultations/${id}/photos?angle=${angle}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  redirect(res.ok ? back(id, "skin", "info=foto") : back(id, "skin", `pesan=${encodeURIComponent(await msg(res))}`));
}

export async function saveAnnotationsAction(photoId: string, annotations: Annotation[]): Promise<{ ok: boolean; message: string }> {
  if (!ID.test(photoId)) return { ok: false, message: GENERIC };
  const parsed = annotationSchema.array().max(50).safeParse(annotations);
  if (!parsed.success) return { ok: false, message: "Ada anotasi yang belum sesuai. Periksa posisi dan ukurannya." };
  const res = await api(`/v1/staff/photos/${photoId}/annotations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ annotations: parsed.data }),
  });
  return res.ok ? { ok: true, message: "Selesai. Anotasi tersimpan." } : { ok: false, message: await msg(res) };
}

// ---------- Resep & Rencana ----------
const lines = (v: FormDataEntryValue | null, max = 300) =>
  String(v ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10).map((l) => l.slice(0, max));
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "metrik";
const num = (v: FormDataEntryValue | null) => (String(v ?? "").trim() === "" ? null : Number(String(v).replace(",", ".")));
const json = { "content-type": "application/json" };

export async function saveRxAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  if (!ID.test(id)) redirect("/antrean");
  const items = [];
  for (let i = 0; i < 20; i++) {
    const name = String(fd.get(`i${i}-name`) ?? "").trim();
    if (!name) continue;
    items.push(Object.fromEntries(["name", "strength", "dose", "frequency", "route", "duration", "notes"].map((k) => [k, String(fd.get(`i${i}-${k}`) ?? "").trim()])));
  }
  if (!items.length) redirect(back(id, "resep", `pesan=${encodeURIComponent("Ada satu bagian yang belum terisi. Tambahkan minimal satu item resep.")}`));
  const res = await api(`/v1/staff/consultations/${id}/prescriptions`, { method: "PUT", headers: json, body: JSON.stringify({ items }) });
  redirect(res.ok ? back(id, "resep", "info=tersimpan") : back(id, "resep", `pesan=${encodeURIComponent(await msg(res))}`));
}

export async function issueRxAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  const rx = String(fd.get("rx_id") ?? "");
  if (!ID.test(id) || !ID.test(rx)) redirect("/antrean");
  const res = await api(`/v1/staff/prescriptions/${rx}/issue`, { method: "POST" });
  redirect(res.ok ? back(id, "resep", "info=terbit") : back(id, "resep", `pesan=${encodeURIComponent(await msg(res))}`));
}

export async function savePlanAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  if (!ID.test(id)) redirect("/antrean");
  const monitor = [];
  for (let i = 0; i < 5; i++) {
    const label = String(fd.get(`m${i}-label`) ?? "").trim();
    if (!label) continue;
    monitor.push({
      metric_key: slug(label),
      label,
      unit: String(fd.get(`m${i}-unit`) ?? "").trim(),
      baseline: num(fd.get(`m${i}-baseline`)),
      target: num(fd.get(`m${i}-target`)),
      direction: fd.get(`m${i}-direction`) === "down" ? "down" : "up",
    });
  }
  const review = String(fd.get("review_at") ?? "").trim();
  const body = {
    content: { focus: lines(fd.get("focus")), next_steps: lines(fd.get("next_steps")), monitor, review_at: review || null },
    summary: { discussed: String(fd.get("discussed") ?? "").trim().slice(0, 2000), priorities: lines(fd.get("priorities")) },
  };
  const res = await api(`/v1/staff/consultations/${id}/care-plans`, { method: "PUT", headers: json, body: JSON.stringify(body) });
  redirect(res.ok ? back(id, "rencana", "info=tersimpan") : back(id, "rencana", `pesan=${encodeURIComponent(await msg(res))}`));
}

export async function signPlanAction(fd: FormData) {
  const id = String(fd.get("consultation_id") ?? "");
  const plan = String(fd.get("plan_id") ?? "");
  if (!ID.test(id) || !ID.test(plan)) redirect("/antrean");
  if (fd.get("confirm") !== "on") redirect(back(id, "rencana", `pesan=${encodeURIComponent("Mohon centang konfirmasi sebelum menandatangani.")}`));
  const res = await api(`/v1/staff/care-plans/${plan}/sign`, { method: "POST", headers: json, body: JSON.stringify({ confirm: true }) });
  redirect(res.ok ? back(id, "rencana", "info=ditandatangani") : back(id, "rencana", `pesan=${encodeURIComponent(await msg(res))}`));
}
