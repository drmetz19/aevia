# Konektor BeautyCode

BeautyCode adalah tracker web statis (skor kulit, tidur, pemicu makanan) yang di-host di Firebase/Netlify. Aplikasi ini tidak punya backend, jadi **AEVIA mendefinisikan kontrak inbound** dan mendokumentasikan pola relay agar kunci API tidak pernah ada di kode browser.

## Aturan penting

- Data hanya diterima untuk pasien yang menyetujui **konteks eksternal** (consent `external_context`). Tanpa persetujuan: `403 consent_required`, tidak ada yang disimpan. Pencabutan persetujuan menyembunyikan data seketika di konsol dan draf persiapan.
- Pengirim wajib kunci API dengan cakupan **`integrations:write`** milik klinik yang sama dengan pasien (pasien klinik lain: `404`).
- **Jangan menaruh kunci API di JavaScript browser.** Siapa pun dapat membacanya dan memakainya mengirim data atas nama klinik. Gunakan relay serverless (di bawah) yang menyimpan kunci sebagai variabel lingkungan.
- Admin klinik dapat mematikan penerimaan di Pengaturan → Integrasi → Konektor → Beauty Code (`409 connector_disabled`).

## Endpoint: `POST /v1/integrations/beautycode/tracker`

Header: `Authorization: Bearer <kunci API>`, `Content-Type: application/json`, dan disarankan `X-Event-Id: <id unik catatan>` (idempoten; ulangan dibalas `200` dengan `X-Idempotent-Replay: true`).

```json
{
  "aevia_patient_id": "9a2e…",
  "email": "siti@contoh.id",
  "recorded_at": "2026-10-03T22:00:00Z",
  "skin_barrier": 62,
  "sleep_hours": 5.5,
  "diet_triggers": ["gula", "susu"],
  "raw": { "versi_app": "2.1" }
}
```

| Field | Aturan |
| --- | --- |
| `aevia_patient_id` atau `email` | Salah satu wajib (email dicocokkan di dalam klinik kunci; tidak peka huruf besar) |
| `recorded_at` | Wajib, ISO 8601 |
| `skin_barrier` | Opsional, 0–100 |
| `sleep_hours` | Opsional, 0–24 |
| `diet_triggers` | Opsional, maks. 20 teks (maks. 60 karakter) |
| `raw` | Opsional, objek bebas, maks. 4 KB |

Setidaknya satu data (`skin_barrier`, `sleep_hours`, `diet_triggers`, atau `raw`) wajib ada.

Respons `201`: `{ "id": "…", "patient_id": "9a2e…", "recorded_at": "2026-10-03T22:00:00.000Z" }` (tanpa email).

| HTTP | `error` | Arti |
| --- | --- | --- |
| 400 | `bad_request` | Badan tidak sesuai |
| 401 / 403 | `invalid_credentials` / `insufficient_scope` | Kunci tidak valid / belum punya `integrations:write` |
| 403 | `consent_required` | Pasien belum menyetujui konteks eksternal |
| 404 | `patient_not_found` | Pasien tidak ada di klinik kunci ini |
| 409 | `connector_disabled` | Dimatikan admin klinik |

Catatan terbaru (menurut `recorded_at`) tampil sebagai kartu **Beauty Code snapshot** di detail pasien di konsol, dan ringkasannya masuk ke konteks draf persiapan konsultasi Sovia.

## Pola relay (disarankan)

```
Browser BeautyCode  ──(POST tanpa kunci, token sesi pasien Anda)──▶  Relay serverless  ──(Bearer aev_live_…)──▶  AEVIA
```

Relay memeriksa bahwa pemanggil adalah pengguna BeautyCode yang sah (mis. token Firebase Auth), menentukan pasien AEVIA, lalu meneruskan dengan kunci yang disimpan di lingkungan server.

### Relay: Netlify Function (`netlify/functions/aevia-tracker.mjs`)

Variabel lingkungan: `AEVIA_API_URL`, `AEVIA_API_KEY` (cakupan `integrations:write`).

```js
// Verifikasi pemanggil sesuai sistem login BeautyCode Anda (mis. Firebase Admin: verifyIdToken)
// lalu petakan ke pasien AEVIA. Contoh di bawah memakai email dari token terverifikasi.
export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const user = await verifyCaller(req); // ← implementasikan: lempar/return null bila tidak sah
  if (!user?.email) return new Response("Unauthorized", { status: 401 });

  const entry = await req.json(); // { recorded_at, skin_barrier, sleep_hours, diet_triggers }
  const res = await fetch(`${process.env.AEVIA_API_URL}/v1/integrations/beautycode/tracker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.AEVIA_API_KEY}`,
      "content-type": "application/json",
      "x-event-id": `bc-${user.uid}-${entry.recorded_at}`, // idempoten: kirim ulang aman
    },
    body: JSON.stringify({
      email: user.email, // dari token terverifikasi, BUKAN dari badan permintaan browser
      recorded_at: entry.recorded_at,
      skin_barrier: entry.skin_barrier,
      sleep_hours: entry.sleep_hours,
      diet_triggers: entry.diet_triggers,
    }),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
};
```

Untuk Vercel/Cloud Functions, bentuknya sama: ganti pembungkus handler, simpan kunci sebagai secret/env, dan jangan pernah mengembalikan kunci ke klien.

### Potongan siap tempel untuk aplikasi BeautyCode (browser)

Hanya memanggil **relay Anda sendiri** (bukan AEVIA langsung); tidak ada kunci di sini.

```js
// Tempel di aplikasi BeautyCode. RELAY_URL = alamat function di atas.
const RELAY_URL = "/.netlify/functions/aevia-tracker";

export async function kirimKeAevia(entry, idToken) {
  const res = await fetch(RELAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` }, // token login BeautyCode
    body: JSON.stringify({
      recorded_at: new Date(entry.date).toISOString(),
      skin_barrier: entry.skinBarrier,        // 0-100
      sleep_hours: entry.sleepHours,          // 0-24
      diet_triggers: entry.dietTriggers || [], // ["gula", "susu"]
    }),
  });
  if (res.status === 403) return { ok: false, pesan: "Aktifkan berbagi konteks di AEVIA agar klinik dapat melihat catatan ini." };
  if (!res.ok) return { ok: false, pesan: "Catatan belum terkirim. Coba lagi sebentar lagi." };
  return { ok: true };
}
```

Pasien mengaktifkan berbagi konteks di halaman beranda klinik (pengaturan persetujuan "konteks dari aplikasi lain").

## Uji cepat dengan curl

```bash
curl -X POST https://<host-api>/v1/integrations/beautycode/tracker \
  -H "Authorization: Bearer aev_live_…" \
  -H "Content-Type: application/json" \
  -H "X-Event-Id: bc-uji-001" \
  -d '{"email":"siti@contoh.id","recorded_at":"2026-10-03T22:00:00Z","skin_barrier":62,"sleep_hours":5.5,"diet_triggers":["gula","susu"]}'
```
