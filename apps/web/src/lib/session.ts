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
  const res = await apiAuthed(slug, `/v1/clinics/${slug}/me`);
  if (!res || !res.ok) redirect(sessionEndedUrl(slug));
  return patientMeSchema.parse(await res.json());
}

export async function getConsents(slug: string): Promise<ConsentStatus[]> {
  const res = await apiAuthed(slug, "/v1/me/consents");
  if (!res || !res.ok) redirect(sessionEndedUrl(slug));
  return consentListSchema.parse(await res.json()).consents;
}
