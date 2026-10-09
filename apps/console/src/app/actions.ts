"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
import { STAFF_COOKIE } from "@/lib/cookie";
import { PASSWORD_MIN } from "@aevia/core";
const GENERIC = "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.";

export interface AcceptState {
  error?: string;
}

export interface FormState {
  email?: string;
  error?: string;
}

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

export async function requestStaffCode(_p: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Ada satu bagian yang belum terisi." };
  const r = await post("/v1/staff/auth/otp", { email });
  return r.ok ? { email } : { error: String(r.data.message ?? GENERIC) };
}

export async function verifyStaffCode(_p: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  if (!code) return { email, error: "Ada satu bagian yang belum terisi." };
  const r = await post("/v1/staff/auth/verify", { email, code });
  if (!r.ok) return { email, error: String(r.data.message ?? GENERIC) };
  await setSession(r.data);
  redirect("/beranda");
}

async function setSession(data: Record<string, unknown>) {
  (await cookies()).set(STAFF_COOKIE, String(data.token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(data.expires_in ?? 43200),
  });
}

export interface PasswordState {
  email?: string;
  error?: string;
  sent?: string;
}

const firstIssue = (d: Record<string, unknown>) => {
  const issues = (d as { details?: { message?: string }[] }).details;
  return Array.isArray(issues) && issues[0]?.message ? issues[0].message : undefined;
};

export async function passwordLogin(_p: PasswordState, fd: FormData): Promise<PasswordState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { email, error: "Ada satu bagian yang belum terisi." };
  const r = await post("/v1/staff/auth/login", { email, password });
  if (!r.ok) return { email, error: String(r.data.message ?? GENERIC) };
  await setSession(r.data);
  redirect("/beranda");
}

export async function requestPasswordLinkAction(_p: PasswordState, fd: FormData): Promise<PasswordState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Ada satu bagian yang belum terisi." };
  const r = await post("/v1/staff/auth/password/request", { email });
  return r.ok ? { email, sent: String(r.data.message) } : { email, error: String(r.data.message ?? GENERIC) };
}

export async function setPasswordAction(_p: PasswordState, fd: FormData): Promise<PasswordState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (!password || !confirm) return { error: "Ada satu bagian yang belum terisi." };
  if (password.length < PASSWORD_MIN) return { error: `Password minimal ${PASSWORD_MIN} karakter.` };
  if (password !== confirm) return { error: "Kedua password belum sama. Ketik ulang ya." };
  const r = await post("/v1/staff/auth/password/set", { token, password });
  if (!r.ok) return { error: firstIssue(r.data) ?? String(r.data.message ?? GENERIC) };
  await setSession(r.data);
  redirect("/beranda");
}

export async function staffLogout() {
  (await cookies()).delete(STAFF_COOKIE);
  redirect("/masuk");
}

export async function acceptRequestAction(_p: AcceptState, fd: FormData): Promise<AcceptState> {
  const id = String(fd.get("request_id") ?? "");
  const patientId = String(fd.get("patient_id") ?? "");
  const local = String(fd.get("scheduled_local") ?? "");
  const url = String(fd.get("meeting_url") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(patientId)) return { error: GENERIC };
  if (!local || !url) return { error: "Ada satu bagian yang belum terisi." };
  const when = new Date(`${local}:00+07:00`); // input datetime-local ditafsirkan sebagai WIB
  if (Number.isNaN(when.getTime())) return { error: "Tanggal dan jam konsultasi belum sesuai." };
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) redirect("/masuk?sesi=berakhir");
  const res = await fetch(`${API_URL}/v1/staff/consultation-requests/${id}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ scheduled_at: when.toISOString(), meeting_url: url }),
    cache: "no-store",
  });
  if (res.status === 401) redirect("/masuk?sesi=berakhir");
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { message?: string };
    return { error: b.message ?? GENERIC };
  }
  redirect(`/pasien/${patientId}?info=diterima`);
}
