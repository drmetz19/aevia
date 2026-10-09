import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { clinicConnectors, clinics, consents, externalContext, inboundEvents, patients, writeAudit, type Db, type Tx } from "@aevia/db";
import { AuthError } from "../auth/otp";
import { decryptSecret } from "../integrations/crypto";

/**
 * Sinkron TARIK dari Beauty Code: AEVIA meminta ringkasan tracker harian untuk pasiennya sendiri yang
 * (1) menyetujui konteks eksternal di AEVIA dan (2) terhubung ke klinik di Beauty Code.
 * Hanya email pasien yang setuju yang dikirim; foto tidak pernah ditarik.
 */
export type BcConfig = {
  enabled?: boolean;
  pull_base_url?: string;
  pull_clinic_id?: string;
  api_key?: string; // terenkripsi
  last_pull?: LastPull;
};
export type LastPull = { at: string; ok: boolean; message: string; patients: number; days: number };

type ExportDay = {
  date: string;
  sleepHours: number | null;
  sleepQuality: string | null;
  skinCondition: string | null;
  wrinkleLevel: number | null;
  eyebagLevel: number | null;
  darkCircleLevel: number | null;
  skinComplaints: string[];
  energy: number | null;
  stress: number | null;
  mood: number | null;
  waterLiters: number | null;
  activityMinutes: number | null;
  activityType: string | null;
};
type ExportPatient = { email: string; days: ExportDay[] };

export const PULL_INTERVAL_MINUTES = 60;
export const PULL_LOOKBACK_DAYS = 14;
const BATCH = 100;

export const pullConfigured = (c: BcConfig) => Boolean(c.pull_base_url && c.pull_clinic_id && c.api_key);

/** Simpan per hari: angka di level atas (dibaca kartu snapshot & Sovia), detail lain di raw. */
export function dayToContext(d: ExportDay): Record<string, unknown> {
  const pick = (v: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const data: Record<string, unknown> = {
    sleep_hours: pick(d.sleepHours),
    skin_condition: d.skinCondition ?? undefined,
    energy: pick(d.energy),
    stress: pick(d.stress),
    mood: pick(d.mood),
    water_liters: pick(d.waterLiters),
    activity_minutes: pick(d.activityMinutes),
    raw: {
      source: "beautycode.pull",
      date: d.date,
      sleep_quality: d.sleepQuality,
      wrinkle_level: d.wrinkleLevel,
      eyebag_level: d.eyebagLevel,
      dark_circle_level: d.darkCircleLevel,
      skin_complaints: d.skinComplaints.slice(0, 20),
      activity_type: d.activityType,
    },
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return data;
}

/** Tanggal lokal Beauty Code (WIB) → titik tengah hari WIB, agar urutan "terbaru" stabil. */
export const recordedAtFor = (date: string) => new Date(`${date}T12:00:00+07:00`);

async function consentingPatients(tx: Tx) {
  return tx
    .select({ id: patients.id, email: patients.email })
    .from(patients)
    .innerJoin(consents, and(eq(consents.patientId, patients.id), eq(consents.scope, "external_context")))
    .where(and(isNotNull(consents.grantedAt), isNull(consents.revokedAt)));
}

function friendlyError(status: number): string {
  if (status === 401) return "Kunci API Beauty Code tidak valid atau sudah dicabut.";
  if (status === 403) return "Kunci API Beauty Code belum punya izin tracker:read, atau ID klinik tidak cocok dengan kunci.";
  if (status === 429) return "Beauty Code sedang membatasi permintaan. Sinkron akan dicoba lagi otomatis.";
  if (status === 404) return "Alamat Beauty Code belum mendukung sinkron tracker. Pastikan versi terbaru sudah dirilis.";
  return `Beauty Code membalas HTTP ${status}.`;
}

type PullCtx = { db: Db; clinicId: string; now: Date; encryptionKey: Uint8Array; fetchFn?: typeof fetch; actor?: { type: "staff" | "system"; id: string | null } };

export async function pullBeautycode(c: PullCtx): Promise<LastPull> {
  const row = await c.db.withTenant(c.clinicId, async (tx) => (await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, "beautycode")))[0]);
  const cfg = (row?.config ?? {}) as BcConfig;
  if (!row || !pullConfigured(cfg)) throw new AuthError(409, "connector_not_configured", "Sinkron Beauty Code belum diatur. Isi alamat, ID klinik, dan kunci API Beauty Code lalu simpan.");
  if (cfg.enabled === false) throw new AuthError(409, "connector_disabled", "Konektor Beauty Code sedang dinonaktifkan.");

  const people = await c.db.withTenant(c.clinicId, consentingPatients);
  let result: LastPull;
  if (people.length === 0) {
    result = { at: c.now.toISOString(), ok: true, message: "Belum ada pasien yang menyetujui berbagi data dari aplikasi lain.", patients: 0, days: 0 };
  } else {
    const since = new Date(c.now.getTime() - PULL_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const key = decryptSecret(cfg.api_key!, c.encryptionKey);
    const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.id]));
    const fetched: ExportPatient[] = [];
    let failure: string | null = null;
    for (let i = 0; i < people.length && !failure; i += BATCH) {
      const emails = people.slice(i, i + BATCH).map((p) => p.email.toLowerCase());
      try {
        const res = await (c.fetchFn ?? fetch)(`${cfg.pull_base_url}/api/v1/clinics/${cfg.pull_clinic_id}/tracker/export`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
          headers: {
            authorization: `Bearer ${key}`,
            "x-clinic-timestamp": String(Math.floor(c.now.getTime() / 1000)),
            "content-type": "application/json",
            "user-agent": "AEVIA-Connector/1.0",
          },
          body: JSON.stringify({ emails, since }),
        });
        if (!res.ok) {
          failure = friendlyError(res.status);
          break;
        }
        const body = (await res.json().catch(() => null)) as { data?: ExportPatient[] } | null;
        if (!body || !Array.isArray(body.data)) {
          failure = "Jawaban Beauty Code tidak terbaca.";
          break;
        }
        fetched.push(...body.data);
      } catch (e) {
        failure = (e as Error)?.name === "TimeoutError" ? "Beauty Code tidak membalas tepat waktu." : "Beauty Code tidak dapat dihubungi. Periksa alamatnya.";
      }
    }

    let matched = 0;
    let days = 0;
    if (!failure) {
      await c.db.withTenant(c.clinicId, async (tx) => {
        for (const p of fetched) {
          const patientId = byEmail.get(String(p.email).toLowerCase());
          if (!patientId || !Array.isArray(p.days)) continue; // hanya email yang kita minta
          matched++;
          for (const d of p.days) {
            if (typeof d?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
            const data = dayToContext(d);
            // external_context append-only: versi baru hanya bila isi hari itu berubah (idempoten bila sama)
            const eventId = `${patientId}:${d.date}:${createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16)}`;
            const [seen] = await tx.select({ id: inboundEvents.id }).from(inboundEvents).where(and(eq(inboundEvents.source, "beautycode.pull"), eq(inboundEvents.eventId, eventId)));
            if (seen) continue;
            const [ins] = await tx.insert(externalContext).values({ clinicId: c.clinicId, patientId, source: "beautycode", data, recordedAt: recordedAtFor(d.date), createdAt: c.now }).returning({ id: externalContext.id });
            await tx.insert(inboundEvents).values({ clinicId: c.clinicId, source: "beautycode.pull", eventId, result: { id: ins!.id }, createdAt: c.now });
            days++;
          }
        }
      });
    }
    result = failure
      ? { at: c.now.toISOString(), ok: false, message: failure, patients: 0, days: 0 }
      : {
          at: c.now.toISOString(),
          ok: true,
          message: matched === 0 ? `Tersinkron. Dari ${people.length} pasien yang setuju, belum ada yang terhubung ke klinik di Beauty Code.` : `Tersinkron: ${matched} pasien, ${days} catatan harian baru atau diperbarui.`,
          patients: matched,
          days,
        };
  }

  await c.db.withTenant(c.clinicId, async (tx) => {
    await tx
      .update(clinicConnectors)
      .set({ config: { ...cfg, last_pull: result }, ...(result.ok ? { lastSyncAt: c.now } : {}) })
      .where(eq(clinicConnectors.id, row.id));
    await writeAudit(tx, { clinicId: c.clinicId, actorType: c.actor?.type ?? "system", actorId: c.actor?.id ?? null, entity: "connector", entityId: row.id, action: "connector.beautycode.pull", before: null, after: { ok: result.ok, patients: result.patients, days: result.days }, at: c.now });
  });
  return result;
}

/** Dipanggil cron: tarik untuk klinik yang sinkronnya aktif dan sudah ≥ 60 menit sejak tarikan terakhir. */
export async function pullBeautycodeDue(d: { db: Db; now: () => Date; encryptionKey: Uint8Array; fetchFn?: typeof fetch }): Promise<number> {
  let pulled = 0;
  const all = await d.db.db.select({ id: clinics.id }).from(clinics);
  for (const { id } of all) {
    const row = await d.db.withTenant(id, async (tx) => (await tx.select().from(clinicConnectors).where(eq(clinicConnectors.kind, "beautycode")))[0]);
    const cfg = (row?.config ?? {}) as BcConfig;
    if (!row || cfg.enabled === false || !pullConfigured(cfg)) continue;
    const last = cfg.last_pull?.at ? new Date(cfg.last_pull.at).getTime() : 0;
    if (d.now().getTime() - last < PULL_INTERVAL_MINUTES * 60_000) continue;
    try {
      await pullBeautycode({ db: d.db, clinicId: id, now: d.now(), encryptionKey: d.encryptionKey, fetchFn: d.fetchFn });
      pulled++;
    } catch (e) {
      console.warn(`[beautycode] tarik klinik ${id} gagal: ${(e as Error).message}`);
    }
  }
  return pulled;
}
