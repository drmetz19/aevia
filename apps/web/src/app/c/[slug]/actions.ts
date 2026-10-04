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
  redirect(`/c/${slug}/beranda`);
}
