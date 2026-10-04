# Integrasi AEVIA

Panduan untuk menghubungkan sistem Anda ke klinik di AEVIA: autentikasi, cakupan akses (scope), webhook bertanda tangan, dan katalog kejadian.

- Spesifikasi OpenAPI 3.1: `GET /v1/openapi.json`
- Dokumentasi interaktif (aset dihosting sendiri, tanpa CDN): `/docs`
- Kunci dan klien dibuat oleh admin klinik di konsol: **Pengaturan → Integrasi**.

## Autentikasi

Ada dua cara. Keduanya memakai header `Authorization: Bearer …` dan menentukan klinik (tenant) dari kredensial itu sendiri. Tidak ada parameter klinik di URL, dan data klinik lain tidak pernah terjangkau.

### 1. Kunci API

Format `aev_live_<32 karakter>` atau `aev_test_<32 karakter>`. Rahasia hanya tampil **sekali** saat dibuat; yang tersimpan di server hanya hash sha256. Kunci yang dicabut langsung berhenti berlaku. Jenis `test` memakai data klinik yang sama; bedanya hanya penanda pada prefix agar mudah dikenali di log (belum ada sandbox terpisah).

```bash
curl https://<host-api>/v1/integrations/me -H "Authorization: Bearer aev_live_…"
```

### 2. OAuth client-credentials

```bash
curl -X POST https://<host-api>/v1/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=aev_cid_… -d client_secret=aev_cs_… \
  -d scope="read:patients read:progress"      # opsional; default = semua cakupan klien
```

Boleh juga `Content-Type: application/json` atau `Authorization: Basic base64(client_id:client_secret)`. Respons:

```json
{ "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 900, "scope": "read:patients read:progress" }
```

Token berumur **15 menit** (`aud=aevia-api`, klaim `scope`). Minta token baru saat kedaluwarsa. Mencabut klien langsung mematikan token yang sedang berjalan.

## Cakupan akses (scope)

| Scope | Boleh |
| --- | --- |
| `read:patients` | `GET /v1/integrations/patients/:id/summary` |
| `read:progress` | `GET /v1/integrations/patients/:id/checkins`, `/progress` |
| `read:plans` | `GET /v1/integrations/patients/:id/care-plan` (rencana yang sudah ditandatangani) |
| `write:reminders` | `POST /v1/integrations/reminders` |
| `write:consultation_requests` | `POST /v1/integrations/consultation-requests` |
| `webhooks:manage` | `GET/POST/DELETE /v1/integrations/webhooks` |
| `integrations:write` | Dicadangkan. Belum ada route di MVP. |

Tanpa cakupan yang sesuai: `403 insufficient_scope`. **Tidak ada** route integrasi untuk menulis SOAP, resep, atau rencana pendampingan; semuanya hanya dapat dibuat dan ditandatangani profesional klinik.

### Aturan data

- Respons tidak memuat nama atau email pasien, hanya `id` pasien.
- Data klinis (check-in, progres, rencana, bagian klinis ringkasan) hanya tersedia bila pasien menyetujui akses rekam medis; selain itu `403 consent_required`. Pencabutan persetujuan berlaku seketika.
- Pengingat memakai teks baku; Anda hanya memilih `kind` (`checkin` atau `review`) dan `due_at`.
- Setiap panggilan, termasuk yang ditolak karena cakupan, tercatat di audit klinik sebagai `actor_type=api` dengan penanda `api:<prefix kunci>`.

### Batas permintaan

Per kredensial: kapasitas 120 permintaan, terisi ulang 2 per detik. Melebihinya → `429 rate_limited` dengan header `Retry-After` (detik). *Catatan operasional:* implementasi MVP berupa token bucket di memori proses; pada hosting serverless batasnya per instance. Untuk batas yang akurat di produksi, ganti dengan penyimpanan bersama (mis. Redis) di balik antarmuka `TokenBucketLimiter`.

## Webhook

Daftarkan endpoint **https** di konsol (atau lewat API dengan `webhooks:manage`). Alamat internal (localhost, jaringan privat) ditolak. Pada pembuatan Anda menerima `secret` (`whsec_…`) satu kali.

Setiap pengiriman adalah `POST` JSON:

```json
{
  "id": "<id kejadian>",
  "type": "plan.approved",
  "created_at": "2026-10-04T10:00:00.000Z",
  "clinic_id": "<id klinik>",
  "data": { "plan_id": "…", "patient_id": "…", "consultation_id": "…", "version": 1 }
}
```

`data` minimal: hanya id (dan `version` / `flagged`), tanpa nama, email, jawaban, atau nilai klinis. Ambil detailnya lewat route integrasi di atas bila cakupan Anda mengizinkan.

Header:

| Header | Isi |
| --- | --- |
| `X-Aevia-Signature` | `t=<unix detik>,v1=<hex hmac_sha256(secret, "<t>.<body mentah>")>` |
| `X-Aevia-Event` | jenis kejadian |
| `X-Aevia-Delivery` | id pengiriman (sama di setiap percobaan ulang; pakai untuk idempoten) |

### Verifikasi tanda tangan (Node)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// `rawBody` harus string/Buffer mentah, sebelum di-parse JSON.
export function verifyAevia(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false; // cegah replay
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Balas `2xx` dalam 10 detik. Pengalihan (3xx) dianggap belum berhasil.

### Percobaan ulang

Maksimal **3 percobaan**: percobaan 1 segera, ke-2 setelah 1 menit, ke-3 setelah 5 menit. Setelah itu status `failed` (terlihat di log pengiriman konsol). Tombol **Kirim tes** mengirim kejadian `webhook.test` satu kali.

### Katalog kejadian

| Jenis | Terjadi saat | Isi `data` |
| --- | --- | --- |
| `assessment.completed` | Pasien menyelesaikan assessment | `assessment_id`, `patient_id`, `flagged` |
| `consultation.requested` | Permintaan konsultasi diajukan (pasien atau API) | `request_id`, `patient_id`, `program_id` |
| `consultation.accepted` | Klinik menerima dan menjadwalkan | `request_id`, `consultation_id`, `patient_id` |
| `plan.approved` | Profesional menandatangani rencana | `plan_id`, `patient_id`, `consultation_id`, `version` |
| `checkin.submitted` | Pasien mengirim check-in | `checkin_id`, `patient_id`, `care_plan_id` |
| `progress.updated` | Progres terhitung ulang setelah check-in | `patient_id`, `checkin_id` |
| `webhook.test` | Tombol "Kirim tes" | `endpoint_id` |

Langganan `*` menerima semua jenis di atas.

## Menjalankan dispatcher

Kejadian ditulis ke tabel outbox `events`; dispatcher menyebarkannya ke endpoint dan mengirim yang jatuh tempo (aman dijalankan paralel).

- Lokal / server sendiri: `pnpm --filter @aevia/api dispatch` (satu putaran) atau `… dispatch -- --watch` (tiap 5 detik).
- Vercel Cron: panggil `/v1/internal/dispatch` dengan `Authorization: Bearer $CRON_SECRET` (Vercel Cron mengirim `GET`; `POST` juga diterima). Contoh `vercel.json`:

```json
{ "crons": [{ "path": "/v1/internal/dispatch", "schedule": "* * * * *" }] }
```

Tanpa `CRON_SECRET` rute ini menjawab `503`.

## Kode kesalahan umum

| HTTP | `error` | Arti |
| --- | --- | --- |
| 401 | `invalid_credentials` | Kunci/token tidak valid, dicabut, atau kedaluwarsa |
| 403 | `insufficient_scope` | Cakupan belum cukup |
| 403 | `consent_required` | Pasien belum menyetujui akses rekam medis |
| 404 | `patient_not_found` | Pasien tidak ada di klinik kredensial ini |
| 429 | `rate_limited` | Terlalu banyak permintaan; lihat `Retry-After` |
