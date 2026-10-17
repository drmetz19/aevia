# Integrasi CRM: data kontak & fase lead

API ini menghubungkan CRM klinik (Konektor.id, HubSpot, Qontak, Google Sheets via automasi, dll.) dengan AEVIA. Fokusnya dua hal:

1. **Data kontak**: nama, email, telepon/WhatsApp, sumber lead, UTM, tag, catatan, penanggung jawab, nilai transaksi, dan ID kontak di CRM Anda.
2. **Fase lead** yang selaras dengan fase penjualan, dan **maju otomatis** mengikuti perjalanan pasien di AEVIA (daftar → assessment → minta konsultasi → dijadwalkan → konsultasi → rencana ditandatangani).

Autentikasi, rate limit, dan format webhook sama dengan [API integrasi](README.md). Kunci dibuat admin klinik di **Pengaturan → Integrasi** dengan cakupan:

| Scope | Boleh |
| --- | --- |
| `read:contacts` | `GET /v1/integrations/contacts`, `/contacts/:id`, `/contacts/:id/stages`, `/funnel` |
| `write:contacts` | `POST /v1/integrations/contacts` (upsert), `PATCH`/`DELETE /contacts/:id`, `POST /contacts/:id/stage` |

`GET /v1/integrations/lead-stages` (katalog fase) bisa dibaca kredensial apa pun.

> **Catatan data pribadi.** Berbeda dengan route integrasi lain, respons kontak **memuat nama, email, dan telepon**, karena itulah kebutuhan CRM. Berikan cakupan `read:contacts` hanya pada sistem milik klinik sendiri. Data klinis (jawaban assessment, SOAP, resep, isi rencana, check-in) **tidak pernah** ada di API ini; fase lead hanya menyatakan *tahap* perjalanan, bukan isinya. Payload webhook tetap minimal (id + fase, tanpa nama/email/telepon).

## Fase lead ↔ fase penjualan

| Fase (`stage`) | Label | Fase penjualan (`sales_phase`) | Cara berpindah |
| --- | --- | --- | --- |
| `new` | Lead baru | lead | Kontak dibuat dari CRM |
| `contacted` | Sudah dihubungi | contacted | Manual oleh sales (`POST /contacts/:id/stage`) |
| `registered` | Terdaftar | engaged | **Otomatis**: kontak masuk ke halaman klinik (akun pasien dibuat) |
| `assessed` | Assessment selesai | qualified (MQL) | **Otomatis**: `assessment.completed` |
| `consultation_requested` | Minta konsultasi | opportunity (SQL) | **Otomatis**: `consultation.requested` |
| `consultation_scheduled` | Konsultasi dijadwalkan | appointment | **Otomatis**: `consultation.accepted` |
| `consulted` | Sudah konsultasi | proposal | **Otomatis**: `consultation.status_changed` dengan status `completed` (mis. dari KlinikSistem) |
| `won` | Program berjalan | closed_won | **Otomatis**: `plan.approved` (rencana ditandatangani profesional) |
| `lost` | Tidak lanjut | closed_lost | Manual, **wajib** `lost_reason` |

Aturan:

- **Otomatis hanya maju**, tidak pernah memundurkan. Lead boleh melompati fase (mis. pasien langsung minta konsultasi tanpa assessment).
- **Manual bebas**: sales boleh maju, mundur (koreksi), atau menandai `lost`. Semua perpindahan tercatat di riwayat (`/contacts/:id/stages`) dengan `mode` `auto`/`manual`.
- Lead `lost` yang **beraktivitas lagi** (mis. menyelesaikan assessment) dibuka kembali otomatis ke fase tertinggi yang dibuktikan datanya; `lost_reason` dikosongkan.
- No-show / batal **tidak** mengubah fase; CRM menerima `consultation.status_changed` untuk tindak lanjut.
- Perpindahan otomatis terjadi di database (trigger) dalam transaksi yang sama dengan kejadiannya, jadi tidak ada fase yang tertinggal.

## Penautan kontak ↔ pasien

- Pasien yang mendaftar di halaman klinik **selalu** punya kontak. Bila CRM sudah lebih dulu membuat kontak dengan **email yang sama**, kontak itu ditautkan (`patient_id` terisi) dan fasenya naik ke `registered`. Bila belum ada, kontak baru dibuat dengan `source = "aevia"`.
- Pasien yang sudah ada sebelum fitur ini dibuatkan kontak saat migrasi (fase dihitung dari datanya), tanpa memicu webhook.
- Kontak yang sudah tertaut tidak bisa dihapus (`409 contact_linked`); tandai `lost` bila tidak lanjut.

## Endpoint

### Buat / perbarui kontak (upsert)

```bash
curl -X POST https://<host-api>/v1/integrations/contacts \
  -H "Authorization: Bearer aev_live_…" -H "Content-Type: application/json" \
  -d '{
    "name": "Rina",
    "phone": "0812-1111-2222",
    "email": "rina@contoh.id",
    "source": "ads",
    "source_detail": "Form Meta Lead Ads Okt",
    "utm": { "source": "meta", "medium": "paid", "campaign": "anti-aging-okt" },
    "tags": ["vip"],
    "external_source": "konektor",
    "external_ref": "L-001"
  }'
```

- Pencocokan berurutan: `external_source` + `external_ref` → `email` → `phone`. Ketemu → diperbarui (**200**, `created: false`); tidak ketemu → dibuat (**201**, `created: true`). Aman diulang (idempoten) untuk sinkron.
- Wajib salah satu: `email` atau `phone`. Telepon dinormalisasi ke format WhatsApp `62…` (`0812…`, `+62 812…`, `812…` → `62812…`).
- `stage` hanya berlaku untuk kontak **baru** (`new` default, atau `contacted`). Fase kontak yang sudah ada diubah lewat endpoint fase.
- `source`: `website`, `whatsapp`, `phone`, `email`, `referral`, `social`, `ads`, `event`, `walk_in`, `aevia`, `other`.
- Email/telepon unik per klinik. Bentrok dengan kontak lain → `409 contact_conflict` dengan `details.contact_id` agar CRM bisa menggabungkan.

Respons:

```json
{
  "created": true,
  "contact": {
    "id": "…", "patient_id": null,
    "name": "Rina", "email": "rina@contoh.id", "phone": "6281211112222",
    "source": "ads", "source_detail": "Form Meta Lead Ads Okt",
    "utm": { "source": "meta", "medium": "paid", "campaign": "anti-aging-okt" },
    "tags": ["vip"], "notes": null, "owner_staff_id": null, "value_idr": null,
    "external_source": "konektor", "external_ref": "L-001",
    "stage": "new", "stage_label": "Lead baru", "sales_phase": "lead",
    "stage_changed_at": "2026-10-17T03:00:00.000Z", "lost_reason": null,
    "created_at": "…", "updated_at": "…"
  }
}
```

### Ubah kontak

`PATCH /v1/integrations/contacts/:id` — hanya kolom yang dikirim yang berubah. `null` mengosongkan `email`, `phone`, `owner_staff_id`, atau `value_idr`. `owner_staff_id` harus staf aktif di klinik ini.

### Pindah fase (manual)

```bash
curl -X POST https://<host-api>/v1/integrations/contacts/<id>/stage \
  -H "Authorization: Bearer aev_live_…" -H "Content-Type: application/json" \
  -d '{ "stage": "contacted", "reason": "Dihubungi via WhatsApp" }'

# tidak lanjut
-d '{ "stage": "lost", "lost_reason": "Belum ada anggaran" }'
```

### Riwayat fase

`GET /v1/integrations/contacts/:id/stages` → `{ history: [{ from_stage, to_stage, mode, trigger, reason, at }] }`. `trigger` berisi kejadian pemicu (mis. `plan.approved`) untuk perpindahan otomatis, atau penanda kredensial (`api:aev_live_…`) untuk manual.

### Daftar & sinkron inkremental

`GET /v1/integrations/contacts?stage=new,contacted&source=ads&tag=vip&owner_staff_id=…&q=rina&updated_since=…&limit=50&cursor=…`

Urut `updated_at` naik. Pola sinkron yang disarankan:

1. Simpan `updated_at` kontak terakhir yang Anda proses.
2. Panggil berkala dengan `updated_since=<nilai itu>`; ikuti `next_cursor` sampai `null`.
3. Perubahan fase otomatis ikut memperbarui `updated_at`, jadi tertangkap pada putaran berikutnya. Untuk waktu nyata, pakai webhook di bawah.

### Funnel

`GET /v1/integrations/funnel?from=2026-10-01T00:00:00Z&to=2026-10-31T23:59:59Z` (kohort berdasarkan tanggal kontak dibuat):

```json
{
  "total": 120, "lost": 18,
  "stages": [
    { "stage": "new", "label": "Lead baru", "sales_phase": "lead", "current": 30, "reached": 120, "conversion_pct": null },
    { "stage": "contacted", "label": "Sudah dihubungi", "sales_phase": "contacted", "current": 12, "reached": 82, "conversion_pct": 68.3 }
  ]
}
```

`current` = kontak yang sekarang di fase itu; `reached` = kontak yang pernah mencapai fase itu atau lebih jauh (termasuk yang kemudian `lost`); `conversion_pct` = `reached` fase ini ÷ `reached` fase sebelumnya.

### Hapus

`DELETE /v1/integrations/contacts/:id` — hanya untuk lead yang belum punya akun pasien.

## Webhook kontak

Daftarkan endpoint dengan kejadian berikut (atau `*`):

| Jenis | Terjadi saat | Isi `data` |
| --- | --- | --- |
| `contact.created` | Kontak dibuat (CRM atau pasien mendaftar sendiri) | `contact_id`, `patient_id` (bila ada), `stage` |
| `contact.updated` | Data kontak diubah lewat API | `contact_id`, `patient_id` (bila ada) |
| `contact.stage_changed` | Fase berpindah (otomatis atau manual) | `contact_id`, `patient_id` (bila ada), `stage`, `previous_stage`, `mode` |

Ambil detail kontak dengan `GET /v1/integrations/contacts/:id` setelah menerima webhook.

## Kode kesalahan

| HTTP | `error` | Arti |
| --- | --- | --- |
| 400 | `bad_request` | Isian belum sesuai (mis. tanpa email & telepon, telepon tidak valid, `lost` tanpa `lost_reason`) |
| 400 | `owner_not_found` | `owner_staff_id` bukan staf aktif klinik ini |
| 400 | `bad_cursor` | Cursor halaman rusak; mulai lagi tanpa cursor |
| 404 | `contact_not_found` | Kontak tidak ada di klinik kredensial ini |
| 409 | `contact_conflict` | Email/telepon sudah dipakai kontak lain (`details.contact_id`) |
| 409 | `contact_linked` | Kontak tertaut pasien tidak dapat dihapus |
