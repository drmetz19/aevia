"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { API_URL } from "@/lib/api";
import { STAFF_COOKIE } from "@/lib/cookie";

export interface SettingsState {
  ok?: string;
  error?: string;
  problems?: string[];
}
const GENERIC = "Terjadi kendala di sisi kami. Silakan coba lagi sebentar lagi.";

async function call(method: string, path: string, body?: unknown, raw?: { data: ArrayBuffer; type: string }) {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) redirect("/masuk?sesi=berakhir");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, ...(raw ? { "content-type": raw.type } : body !== undefined ? { "content-type": "application/json" } : {}) },
      body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false as const, error: GENERIC, problems: undefined };
  }
  if (res.status === 401) redirect("/masuk?sesi=berakhir");
  if (res.ok) return { ok: true as const, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  const b = (await res.json().catch(() => ({}))) as { message?: string; details?: { problems?: string[] } };
  return { ok: false as const, error: b.message ?? GENERIC, problems: b.details?.problems };
}

function done(r: Awaited<ReturnType<typeof call>>, ok: string, path: string): SettingsState {
  if (!r.ok) return { error: r.error, problems: r.problems };
  revalidatePath(path);
  return { ok };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveBrand(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const domain = str(fd, "custom_domain");
  const r = await call("PUT", "/v1/staff/brand", {
    brand_mode: str(fd, "brand_mode"),
    colors: { primary: str(fd, "primary"), accent: str(fd, "accent"), background: str(fd, "background"), surface: str(fd, "surface") },
    font: str(fd, "font") || null,
    custom_domain: domain || null,
  });
  return done(r, "Pengaturan merek tersimpan.", "/pengaturan/brand");
}

async function fileOf(fd: FormData, k: string) {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) return null;
  return { data: await f.arrayBuffer(), type: f.type || "application/octet-stream" };
}

export async function uploadLogo(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const f = await fileOf(fd, "file");
  if (!f) return { error: "Pilih berkas logo terlebih dahulu." };
  return done(await call("POST", "/v1/staff/brand/logo", undefined, f), "Logo tersimpan.", "/pengaturan/brand");
}
export async function removeLogo(): Promise<SettingsState> {
  return done(await call("DELETE", "/v1/staff/brand/logo"), "Logo dihapus.", "/pengaturan/brand");
}
export async function proposeAssistant(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const name = str(fd, "name");
  const f = await fileOf(fd, "file");
  if (!name && !f) return { error: "Isi nama asisten atau pilih gambar avatar." };
  if (name) {
    const r = await call("PUT", "/v1/staff/brand/assistant", { name });
    if (!r.ok) return { error: r.error };
  }
  if (f) {
    const r = await call("POST", "/v1/staff/brand/assistant-avatar", undefined, f);
    if (!r.ok) return { error: r.error };
  }
  revalidatePath("/pengaturan/brand");
  return { ok: "Usulan terkirim. Tim AEVIA akan meninjaunya; nama dan avatar baru tampil setelah disetujui." };
}
export async function setLlm(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  return done(await call("PUT", "/v1/staff/brand/llm", { enabled: str(fd, "enabled") === "true" }), "Pengaturan asisten diperbarui.", "/pengaturan/brand");
}

function programBody(fd: FormData) {
  const num = (k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
  return {
    name: str(fd, "name"),
    summary: str(fd, "summary"),
    duration_weeks: num("duration_weeks"),
    price_idr: num("price_idr"),
    includes: str(fd, "includes").split("\n").map((l) => l.trim()).filter(Boolean),
    active: str(fd, "active") === "on",
  };
}
export async function saveProgram(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const id = str(fd, "id");
  const r = id ? await call("PUT", `/v1/staff/programs/${id}`, programBody(fd)) : await call("POST", "/v1/staff/programs", programBody(fd));
  return done(r, id ? "Program diperbarui." : "Program ditambahkan.", "/pengaturan/program");
}
export async function deleteProgram(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  return done(await call("DELETE", `/v1/staff/programs/${str(fd, "id")}`), "Program dihapus.", "/pengaturan/program");
}

export async function inviteStaff(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const r = await call("POST", "/v1/staff/team", { email: str(fd, "email"), name: str(fd, "name"), role: str(fd, "role") });
  return done(r, "Undangan dibuat. Staf dapat masuk dengan kode yang dikirim ke emailnya.", "/pengaturan/staf");
}
export async function setStaffActive(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const active = str(fd, "active") === "true";
  return done(await call("PUT", `/v1/staff/team/${str(fd, "id")}/active`, { active }), active ? "Akses staf diaktifkan." : "Akses staf dinonaktifkan.", "/pengaturan/staf");
}

export async function createClinic(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const r = await call("POST", "/v1/admin/clinics", {
    slug: str(fd, "slug"),
    name: str(fd, "name"),
    brand_mode: str(fd, "brand_mode"),
    admin_email: str(fd, "admin_email"),
    ...(str(fd, "admin_name") ? { admin_name: str(fd, "admin_name") } : {}),
  });
  return done(r, `Klinik dibuat. Halaman klinik dapat dibuka di /c/${str(fd, "slug").toLowerCase()}.`, "/admin/klinik");
}
export async function verifyDomain(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const v = str(fd, "verified") === "true";
  return done(await call("PUT", `/v1/admin/clinics/${str(fd, "id")}/domain`, { verified: v }), v ? "Domain diverifikasi." : "Verifikasi domain dicabut.", "/admin/klinik");
}
export async function reviewAssistant(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const r = await call("POST", `/v1/admin/assistants/${str(fd, "id")}/review`, { decision: str(fd, "decision"), note: str(fd, "note") });
  return done(r, str(fd, "decision") === "approve" ? "Usulan disetujui." : "Usulan ditolak.", "/admin/asisten");
}
