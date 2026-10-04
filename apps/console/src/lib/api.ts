import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { staffMeSchema, type Role } from "@aevia/core";
import { STAFF_COOKIE } from "./cookie";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function staffFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) redirect("/masuk?sesi=berakhir");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (res.status === 401) redirect("/masuk?sesi=berakhir");
  return res;
}

export async function requireStaff(allowed?: Role[]) {
  const res = await staffFetch("/v1/staff/me");
  if (!res.ok) redirect("/masuk?sesi=berakhir");
  const me = staffMeSchema.parse(await res.json());
  if (allowed && !allowed.includes(me.role)) redirect("/beranda");
  return me;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) + " WIB";
