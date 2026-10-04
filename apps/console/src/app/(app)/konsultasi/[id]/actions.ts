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
