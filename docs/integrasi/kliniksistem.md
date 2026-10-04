# Konektor KlinikSistem

KlinikSistem adalah aplikasi manajemen klinik DrMetz (peran Admin/Dokter/Staf, booking dengan deteksi bentrok jadwal dokter, status kunjungan, pembayaran, CRM). Aplikasi ini tidak punya API publik yang dikenal, jadi **AEVIA mendefinisikan kontraknya** di dokumen ini. KlinikSistem (atau lapisan tipis di depannya) menerapkan dua sisi:

1. **Outbound** (AEVIA → KlinikSistem): AEVIA mendorong booking saat konsultasi diterima.
2. **Inbound** (KlinikSistem → AEVIA): KlinikSistem melaporkan status kunjungan dan pembayaran.

Peran `Admin/Dokter/Staf` di KlinikSistem tidak dipetakan ke AEVIA; yang dipetakan hanya booking dan status kunjungan.

## Mengatur konektor

Konsol AEVIA → **Pengaturan → Integrasi → Konektor → KlinikSistem**:

- **Alamat dasar**: URL **https** publik KlinikSistem (tanpa garis miring akhir), mis. `https://kliniksistem.klinikanda.id`. Alamat internal (localhost, jaringan privat) ditolak.
- **Rahasia penandatangan** (`kssec_…`): dibuat saat pertama kali menyimpan, tampil **sekali**, disimpan terenkripsi (AES-256-GCM). Pasang di KlinikSistem untuk memverifikasi tanda tangan. Centang "Putar rahasia" untuk menggantinya (yang lama langsung tidak berlaku).
- **Kirim juga saat permintaan masuk**: bila aktif, booking juga dikirim saat pasien mengajukan konsultasi (`consultation.requested`), sebelum dijadwalkan.
- **Uji koneksi**: mengirim `aevia.ping` bertanda tangan ke `{base_url}/aevia/ping`; sukses bila KlinikSistem membalas 2xx.

Untuk inbound, buat **kunci API dengan cakupan `integrations:write`** (Pengaturan → Integrasi → Kunci API) dan simpan di server KlinikSistem.

## Outbound: `POST {base_url}/aevia/bookings`

Dikirim oleh dispatcher AEVIA (`pnpm --filter @aevia/api dispatch` atau Vercel Cron `/v1/internal/dispatch`) untuk `consultation.accepted` (selalu) dan `consultation.requested` (opsional).

Header:

| Header | Isi |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Aevia-Signature` | `t=<unix detik>,v1=<hex hmac_sha256(secret, "<t>.<body mentah>")>` (skema sama dengan webhook) |
| `X-Aevia-Event` | `consultation.accepted` atau `consultation.requested` |
| `X-Aevia-Delivery` | id pengiriman; **sama pada setiap percobaan ulang** (jadikan kunci idempoten) |

Body:

```json
{
  "event": "consultation.accepted",
  "clinic": "drmetz",
  "booking_id": null,
  "aevia_request_id": "6f0c0c3e-…",
  "aevia_consultation_id": "b1c4…",
  "patient": { "aevia_patient_id": "9a2e…", "name": "Siti Rahma", "email": "siti@contoh.id" },
  "program": { "id": "…", "name": "Program Pendampingan Kulit 8 Minggu" },
  "scheduled_at": "2026-10-10T03:00:00.000Z",
  "professional": { "id": "…", "name": "dr. Metz" },
  "meeting_url": "https://meet.google.com/abc-defg-hij"
}
```

- `name` dapat `null` (pasien belum mengisi nama). Telepon belum dikumpulkan AEVIA, jadi tidak dikirim.
- Untuk `consultation.requested`: `aevia_consultation_id`, `scheduled_at`, `professional`, `meeting_url` bernilai `null`.
- `booking_id` terisi bila booking sudah pernah dibuat untuk permintaan yang sama (mis. dari `requested` sebelumnya): **perbarui** booking itu, jangan membuat duplikat.
- Data kontak pasien dikirim hanya ke sistem milik klinik itu sendiri, di alamat yang dikonfigurasi admin klinik.

Respons yang diharapkan: `2xx` dengan JSON `{ "booking_id": "KS-1001" }`. AEVIA menyimpan `booking_id` sebagai `external_ref` konsultasi (dipakai untuk inbound) dan mencatat waktu sinkron terakhir.

Percobaan ulang: maksimal 3 percobaan (segera, +1 menit, +5 menit). Status selain 2xx, timeout 10 detik, atau pengalihan 3xx dianggap belum berhasil. Setelah itu status `failed` dan terlihat di log pengiriman konsol.

### Verifikasi tanda tangan (Node)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyAevia(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false; // cegah replay
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(expected, given);
}
```

`rawBody` harus string mentah **sebelum** di-parse. Tolak dengan `401` bila tidak cocok.

### Mock untuk pengembangan

`pnpm --filter @aevia/api mock:kliniksistem` menyalakan KlinikSistem tiruan di `http://127.0.0.1:4200` (`MOCK_KS_SECRET` = rahasia konektor). Kode dan contoh implementasi penerima ada di `apps/api/src/testing/mock-kliniksistem.ts`.

## Inbound: `POST /v1/integrations/kliniksistem/visits`

Auth: `Authorization: Bearer <kunci API>` dengan cakupan **`integrations:write`**. Klinik ditentukan oleh kunci; konsultasi klinik lain tidak terjangkau (404).

Header opsional namun disarankan: `X-Event-Id: <id unik kejadian di KlinikSistem>`. Kejadian dengan id yang sama tidak diproses ulang; respons pertama diputar ulang dengan header `X-Idempotent-Replay: true`.

Body:

```json
{
  "booking_id": "KS-1001",
  "aevia_consultation_id": "b1c4…",
  "status": "Completed",
  "payment_status": "Paid",
  "occurred_at": "2026-10-10T04:00:00+07:00"
}
```

| Field | Aturan |
| --- | --- |
| `booking_id` atau `aevia_consultation_id` | Salah satu wajib. `booking_id` dicocokkan dengan `external_ref`; bila keduanya dikirim dan konsultasi belum tertaut, booking ditautkan. `booking_id` berbeda dari yang tertaut → `409 booking_mismatch`. |
| `status` | `Scheduled`, `Completed`, `No-show`, `Cancelled` |
| `payment_status` | Opsional: `Paid` atau `Unpaid` |
| `occurred_at` | Waktu perubahan terjadi di KlinikSistem (ISO 8601). Bukan jadwal kunjungan. |

Pemetaan status: `Scheduled → scheduled`, `Completed → completed`, `No-show → no_show`, `Cancelled → cancelled`.

Aturan:

- `Scheduled` setelah status akhir (completed/no_show/cancelled) → `409 invalid_transition`. Koreksi dari satu status akhir ke status akhir lain diizinkan.
- Kejadian dengan `occurred_at` lebih lama dari pembaruan terakhir dianggap usang: diabaikan (`changed: false`), tetap `200`.
- Setiap panggilan tercatat di audit klinik (`actor_type=api`), dan perubahan status memicu event `consultation.status_changed` (bisa dilanggan lewat webhook).

Respons `200`:

```json
{ "consultation_id": "b1c4…", "status": "completed", "payment_status": "paid", "changed": true }
```

Contoh:

```bash
curl -X POST https://<host-api>/v1/integrations/kliniksistem/visits \
  -H "Authorization: Bearer aev_live_…" \
  -H "Content-Type: application/json" \
  -H "X-Event-Id: ks-evt-20261010-0042" \
  -d '{"booking_id":"KS-1001","status":"Completed","payment_status":"Paid","occurred_at":"2026-10-10T04:00:00+07:00"}'
```

| HTTP | `error` | Arti |
| --- | --- | --- |
| 401 | `invalid_credentials` | Kunci tidak valid atau dicabut |
| 403 | `insufficient_scope` | Kunci belum punya `integrations:write` |
| 404 | `consultation_not_found` | Booking/konsultasi tidak ada di klinik kunci ini |
| 409 | `invalid_transition` / `booking_mismatch` | Lihat aturan di atas |
