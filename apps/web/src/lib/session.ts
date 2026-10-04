import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consentListSchema, patientMeSchema, type ConsentStatus } from "@aevia/core";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const SLUG_RE = /^[a-z0-9-]{1,64}$/;
export const cookieName = (slug: string) => `aevia_session_${slug}`;

export async function getToken(slug: string): Promise<string | undefined> {
  return (await cookies()).get(cookieName(slug))?.value;
}

/** Panggil API dengan bearer dari cookie httpOnly (token tidak pernah sampai ke JS browser). */
export async function apiAuthed(slug: string, path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await getToken(slug);
  if (!token) return null;
  return fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}

export const sessionEndedUrl = (slug: string) => `/c/${slug}/masuk?sesi=berakhir`;

export async function requirePatient(slug: string) {
  if (!(await getToken(slug))) redirect(`/c/${slug}/masuk`);
  const res = await apiAuthed(slug, `/v1/clinics/${slug}/me`);
  if (!res || !res.ok) redirect(sessionEndedUrl(slug));
  return patientMeSchema.parse(await res.json());
}

export async function getConsents(slug: string): Promise<ConsentStatus[]> {
  const res = await apiAuthed(slug, "/v1/me/consents");
  if (!res || !res.ok) redirect(sessionEndedUrl(slug));
  return consentListSchema.parse(await res.json()).consents;
}

import { assessmentStateSchema, type AssessmentState } from "@aevia/core";

/** null bila belum ada assessment. Sesi berakhir → ke halaman masuk. */
export async function getLatestAssessment(slug: string, completedOnly = false): Promise<AssessmentState | null> {
  const res = await apiAuthed(slug, `/v1/assessments/latest${completedOnly ? "?status=completed" : ""}`);
  if (!res || res.status === 401 || res.status === 403) redirect(sessionEndedUrl(slug));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API assessment gagal (${res.status})`);
  return assessmentStateSchema.parse(await res.json());
}

import { myRequestsSchema, programListSchema, draftSchema, type ConsultationRequestView, type Program } from "@aevia/core";

export async function fetchPrograms(slug: string): Promise<Program[]> {
  const res = await fetch(`${API_URL}/v1/clinics/${encodeURIComponent(slug)}/programs`, { cache: "no-store" });
  if (!res.ok) return [];
  return programListSchema.parse(await res.json()).programs;
}

export async function getMyRequests(slug: string): Promise<ConsultationRequestView[]> {
  const res = await apiAuthed(slug, "/v1/consultation-requests/mine");
  if (!res || res.status === 401 || res.status === 403) redirect(sessionEndedUrl(slug));
  if (!res.ok) return [];
  return myRequestsSchema.parse(await res.json()).requests;
}

export async function getDraft(slug: string) {
  const res = await apiAuthed(slug, "/v1/consultation-requests/draft", { method: "POST", body: "{}" });
  if (!res || res.status === 401 || res.status === 403) redirect(sessionEndedUrl(slug));
  if (!res.ok) throw new Error(`API draf gagal (${res.status})`);
  return draftSchema.parse(await res.json());
}

export const rupiah = (n: number | null) =>
  n === null ? "Hubungi klinik untuk biaya" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

import { patientPlanSchema, type PatientPlan } from "@aevia/core";

export async function getCurrentPlan(slug: string): Promise<PatientPlan | null> {
  const res = await apiAuthed(slug, "/v1/care-plans/current");
  if (!res || res.status === 401 || res.status === 403) redirect(sessionEndedUrl(slug));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API rencana gagal (${res.status})`);
  return patientPlanSchema.parse(await res.json());
}
