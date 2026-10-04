"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consentScopes } from "@aevia/core";
import { API_URL, SLUG_RE, apiAuthed, cookieName } from "@/lib/session";

export interface FormState {
  email?: string;
  error?: string;
  info?: string;
}

const GENERIC = "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.";

async function post(path: string, body: unknown) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return { ok: res.ok, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { message: GENERIC } };
  }
}

export async function requestCode(_prev: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("slug") ?? "");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { error: GENERIC };
  if (!email) return { error: "Ada satu bagian yang belum terisi." };
  const r = await post(`/v1/clinics/${slug}/auth/otp`, { email });
  if (!r.ok) return { error: String(r.data.message ?? GENERIC) };
  return { email, info: String(r.data.message ?? "") };
}

export async function verifyCode(prev: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("slug") ?? "");
  const email = String(fd.get("email") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  if (!SLUG_RE.test(slug)) return { error: GENERIC };
  if (!code) return { email, error: "Ada satu bagian yang belum terisi." };
  const r = await post(`/v1/clinics/${slug}/auth/verify`, { email, code });
  if (!r.ok) return { email, error: String(r.data.message ?? GENERIC) };
  (await cookies()).set(cookieName(slug), String(r.data.token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(r.data.expires_in ?? 43200),
  });
  redirect(`/c/${slug}/beranda`);
}

export async function logout(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  if (SLUG_RE.test(slug)) (await cookies()).delete(cookieName(slug));
  redirect(`/c/${slug}`);
}

export async function saveConsents(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  if (!SLUG_RE.test(slug)) redirect("/");
  for (const scope of consentScopes) {
    const res = await apiAuthed(slug, "/v1/me/consents", {
      method: "PUT",
      body: JSON.stringify({ scope, granted: fd.get(scope) === "on" }),
    });
    if (!res || !res.ok) redirect(`/c/${slug}/masuk?sesi=berakhir`);
  }
  redirect(fd.get("dari") === "assessment" ? `/c/${slug}/assessment` : `/c/${slug}/beranda`);
}

const sessionEnded = (slug: string) => `/c/${slug}/masuk?sesi=berakhir`;

export async function startAssessmentAction(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  if (!SLUG_RE.test(slug)) redirect("/");
  const res = await apiAuthed(slug, "/v1/assessments", { method: "POST" });
  if (!res || !res.ok) redirect(sessionEnded(slug));
  redirect(`/c/${slug}/assessment`);
}

export async function answerAction(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  const id = String(fd.get("assessment_id") ?? "");
  const questionId = String(fd.get("question_id") ?? "");
  if (!SLUG_RE.test(slug) || !/^[0-9a-f-]{36}$/.test(id)) redirect("/");
  const skipped = fd.get("skip") !== null;
  const raw = fd.get("value");
  const body: { question_id: string; value?: number; text?: string } = { question_id: questionId };
  if (raw !== null && String(raw) !== "") body.value = Number(raw);
  if (fd.get("text") !== null && !skipped) body.text = String(fd.get("text")).slice(0, 500);
  const res = await apiAuthed(slug, `/v1/assessments/${id}/answers`, { method: "POST", body: JSON.stringify(body) });
  if (!res) redirect(sessionEnded(slug));
  if (res.status === 401 || res.status === 403) redirect(sessionEnded(slug));
  if (res.status === 400) redirect(`/c/${slug}/assessment?pesan=${encodeURIComponent("Ada satu bagian yang belum terisi. Silakan pilih salah satu jawaban.")}`);
  redirect(`/c/${slug}/assessment`);
}

export async function completeAction(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  const id = String(fd.get("assessment_id") ?? "");
  if (!SLUG_RE.test(slug) || !/^[0-9a-f-]{36}$/.test(id)) redirect("/");
  const res = await apiAuthed(slug, `/v1/assessments/${id}/complete`, { method: "POST" });
  if (!res) redirect(sessionEnded(slug));
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "consent_required") redirect(`/c/${slug}/consent?dari=assessment`);
    redirect(sessionEnded(slug));
  }
  if (res.status === 401) redirect(sessionEnded(slug));
  if (!res.ok) redirect(`/c/${slug}/assessment?pesan=${encodeURIComponent("Ada beberapa pertanyaan yang belum terisi. Silakan lengkapi dulu ya.")}`);
  redirect(`/c/${slug}/assessment/hasil`);
}

export async function submitRequestAction(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  const programId = String(fd.get("program_id") ?? "");
  if (!SLUG_RE.test(slug) || !/^[0-9a-f-]{36}$/.test(programId)) redirect("/");
  const lines = String(fd.get("pertanyaan") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => l.slice(0, 300));
  const prep = {
    tujuan: String(fd.get("tujuan") ?? "").trim().slice(0, 600),
    keluhan: String(fd.get("keluhan") ?? "").trim().slice(0, 1200),
    pertanyaan: lines,
    konteks_assessment: String(fd.get("konteks_assessment") ?? "").trim().slice(0, 1200),
  };
  if (!prep.tujuan) {
    redirect(`/c/${slug}/konsultasi?program=${programId}&pesan=${encodeURIComponent("Ada satu bagian yang belum terisi. Mohon tuliskan tujuan Anda.")}`);
  }
  const res = await apiAuthed(slug, "/v1/consultation-requests", { method: "POST", body: JSON.stringify({ program_id: programId, prep }) });
  if (!res || res.status === 401 || res.status === 403) redirect(sessionEnded(slug));
  if (res.status === 409) redirect(`/c/${slug}/beranda?info=ada`);
  if (!res.ok) {
    redirect(`/c/${slug}/konsultasi?program=${programId}&pesan=${encodeURIComponent("Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.")}`);
  }
  redirect(`/c/${slug}/beranda?info=terkirim`);
}
