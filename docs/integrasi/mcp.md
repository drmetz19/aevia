# Server MCP AEVIA

Server [Model Context Protocol](https://modelcontextprotocol.io) (`apps/mcp`) agar asisten AI (Claude Desktop, Claude Code, Cursor, atau klien MCP lain) dapat membaca ringkasan pendampingan pasien dan melakukan dua aksi terbatas untuk **satu klinik**: klinik pemilik kunci API.

Ringkas:

- **6 tool**: 4 baca (ringkasan, check-in, progres, rencana bertanda tangan) dan 2 tulis terbatas (pengingat check-in, permintaan konsultasi).
- **Tidak ada** tool untuk SOAP, resep, atau membuat/menandatangani rencana. Itu hanya dapat dilakukan profesional klinik di konsol.
- **Tanpa akses database.** Server hanya memanggil REST integrasi (`/v1/integrations/*`) dengan kunci API klinik, jadi semua aturan [API integrasi](README.md) berlaku apa adanya: cakupan (scope), persetujuan pasien, isolasi klinik, batas permintaan, dan audit.
- **Dua transport**: stdio (lokal, satu kunci per proses) dan Streamable HTTP (`POST /mcp`, tanpa sesi, kunci dikirim di setiap permintaan).

## Mulai cepat (3 langkah)

1. **Buat kunci API** di konsol: **Pengaturan → Integrasi → Kunci API**. Centang cakupan yang dibutuhkan (lihat [tabel](#menyiapkan-kunci-api)), salin `aev_live_…` ke [lembar kredensial](mcp-kredensial.md).
2. **Hubungkan asisten** ke server MCP klinik:

   ```bash
   claude mcp add --transport http aevia https://mcp.contoh-klinik.id/mcp \
     --header "Authorization: Bearer aev_live_…"
   ```

   Klien lain: [`.mcp.json`](#klien-lain-mcpjson) · Claude Desktop/lokal: [stdio](#transport-1-stdio-lokal).
3. **Coba**: minta asisten, mis. *"Ringkas progres pasien 9a2e… dan kirim pengingat check-in besok jam 9 pagi."* ID pasien ada di URL detail pasien di konsol (`/pasien/<id>`).

## Arsitektur

```
Klien MCP (Claude, dll.)
   │  stdio  ──atau──  POST /mcp + Authorization: Bearer aev_live_…
   ▼
aevia-mcp (apps/mcp)          tidak menyimpan kunci, tidak menyentuh DB
   │  HTTP + Authorization: Bearer aev_live_…  + X-Aevia-Actor: mcp
   ▼
API AEVIA /v1/integrations/*  scope · consent · isolasi klinik (RLS) · rate limit · audit
```

Header `X-Aevia-Actor: mcp` hanya **label audit**, bukan hak akses tambahan: API mencatat panggilan sebagai `actor_type=mcp` dengan penanda `mcp:<prefix kunci>` (panggilan REST biasa tercatat `actor_type=api`).

## Menyiapkan kunci API

1. Konsol AEVIA → **Pengaturan → Integrasi → Kunci API** (admin klinik).
2. Beri nama yang jelas, mis. `MCP Claude – dr. Metz`, dan centang **hanya cakupan yang dibutuhkan**:

   | Ingin memakai | Cakupan |
   | --- | --- |
   | `get_patient_summary` | `read:patients` |
   | `list_checkins`, `get_progress` | `read:progress` |
   | `get_care_plan` | `read:plans` |
   | `send_checkin_reminder` | `write:reminders` |
   | `create_consultation_request` | `write:consultation_requests` |

   Untuk asisten yang hanya membaca, cukup tiga cakupan `read:*`.
3. Salin rahasia `aev_live_…`. Rahasia hanya tampil **sekali**; yang tersimpan di server hanya hash-nya. Catat di [lembar kredensial](mcp-kredensial.md), terpisah dari dokumen ini.

Tool tetap terdaftar walau cakupannya tidak ada; pemanggilannya saja yang ditolak dengan pesan yang menyebut cakupan yang kurang (lihat [Galat](#galat)).

> Token OAuth client-credentials (lihat [README integrasi](README.md#2-oauth-client-credentials)) juga diterima karena diteruskan apa adanya ke API, tetapi berumur 15 menit. Untuk MCP, pakai kunci API.

## Transport 1: stdio (lokal)

Variabel lingkungan:

| Variabel | Wajib | Default | Keterangan |
| --- | --- | --- | --- |
| `AEVIA_API_KEY` | ✔ | | Kunci API klinik (`aev_live_…`). Tanpa ini proses berhenti dengan pesan di stderr. |
| `AEVIA_API_URL` | | `http://localhost:4000` | Alamat API AEVIA. |

Dari root repo:

```bash
AEVIA_API_URL=https://api.contoh-klinik.id AEVIA_API_KEY=aev_live_… pnpm --filter @aevia/mcp start
```

stdout dipakai protokol MCP; log hanya ke stderr (`aevia-mcp (stdio) siap → <url>`).

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "aevia": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/ke/aevia", "--filter", "@aevia/mcp", "start"],
      "env": {
        "AEVIA_API_URL": "https://api.contoh-klinik.id",
        "AEVIA_API_KEY": "aev_live_…"
      }
    }
  }
}
```

`--silent` penting: tanpa itu pnpm menulis ke stdout dan merusak protokol.

### Claude Code

```bash
claude mcp add aevia \
  --env AEVIA_API_URL=https://api.contoh-klinik.id \
  --env AEVIA_API_KEY=aev_live_… \
  -- pnpm --silent --dir /path/ke/aevia --filter @aevia/mcp start
```

## Transport 2: Streamable HTTP

Endpoint tunggal `POST /mcp`, **tanpa sesi** (tidak ada `Mcp-Session-Id`; cocok untuk serverless). Setiap permintaan membuat server MCP baru dengan kunci dari header `Authorization: Bearer …`, meneruskannya ke API, lalu menutupnya. Kunci tidak disimpan di server MCP.

| Kondisi | Respons |
| --- | --- |
| `AEVIA_API_URL` belum diatur di server | `500` |
| Tanpa `Authorization: Bearer …` | `401` + `WWW-Authenticate: Bearer realm="aevia-mcp"` |
| Metode selain `POST` | `405` + `Allow: POST` |
| `Accept` tidak memuat `application/json` **dan** `text/event-stream` | `406` |
| Selain itu | `200` dengan badan JSON-RPC (bukan SSE) |

Kunci yang salah atau dicabut **tidak** menghasilkan `401` di level HTTP: koneksi MCP tetap berjalan, dan setiap pemanggilan tool mengembalikan `isError` dengan pesan dari API.

### Menjalankan

- **Lokal**: `AEVIA_API_URL=http://localhost:4000 pnpm --filter @aevia/mcp start:http` → `http://localhost:4100/mcp` (ubah port dengan `MCP_PORT`).
- **Vercel**: project `aevia-mcp`, Root Directory `apps/mcp`. `api/mcp.ts` adalah Function dan `vercel.json` memetakan `/mcp` ke sana. Set env `AEVIA_API_URL` ke URL `aevia-api`. Lihat [deploy.md](../deploy.md).

### Claude Code (HTTP)

```bash
claude mcp add --transport http aevia https://mcp.contoh-klinik.id/mcp \
  --header "Authorization: Bearer aev_live_…"
```

### Klien lain (`.mcp.json`)

```json
{
  "mcpServers": {
    "aevia": {
      "type": "http",
      "url": "https://mcp.contoh-klinik.id/mcp",
      "headers": { "Authorization": "Bearer aev_live_…" }
    }
  }
}
```

### Uji cepat dengan curl

Karena tanpa sesi, `tools/list` dan `tools/call` dapat dipanggil langsung tanpa `initialize`.

```bash
MCP=https://mcp.contoh-klinik.id/mcp
KEY=aev_live_…

# Daftar tool (harus 6)
curl -s $MCP -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Panggil satu tool
curl -s $MCP -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_patient_summary","arguments":{"patient_id":"9a2e…"}}}'
```

## Tool

Semua tool menerima `patient_id` (UUID pasien di klinik pemilik kunci; terlihat di URL detail pasien di konsol, `/pasien/<id>`) dan dicek oleh skema Zod sebelum API dipanggil. Setiap hasil berisi:

- `content`: teks ringkas berbahasa Indonesia untuk dibaca asisten;
- `structuredContent`: data JSON yang sama dengan respons API, sesuai `outputSchema` tool.

Respons tidak pernah memuat nama atau email pasien. Deskripsi tool ditulis dwibahasa (Indonesia / Inggris).

| Tool | Jenis | Cakupan | Butuh consent rekam medis | Endpoint API |
| --- | --- | --- | --- | --- |
| `get_patient_summary` | baca | `read:patients` | hanya bagian klinis | `GET /v1/integrations/patients/:id/summary` |
| `list_checkins` | baca | `read:progress` | ya | `GET /v1/integrations/patients/:id/checkins` |
| `get_progress` | baca | `read:progress` | ya | `GET /v1/integrations/patients/:id/progress` |
| `get_care_plan` | baca | `read:plans` | ya | `GET /v1/integrations/patients/:id/care-plan` |
| `send_checkin_reminder` | tulis | `write:reminders` | tidak | `POST /v1/integrations/reminders` |
| `create_consultation_request` | tulis | `write:consultation_requests` | tidak | `POST /v1/integrations/consultation-requests` |

Anotasi: keempat tool baca bertanda `readOnlyHint: true`, `idempotentHint: true`; kedua tool tulis `readOnlyHint: false`, `idempotentHint: false`. Tidak ada yang `destructiveHint`.

### `get_patient_summary`

Input: `patient_id`.

Selalu tersedia: daftar persetujuan (`consents`) dan jumlah permintaan konsultasi per status. Bagian `clinical` (assessment terakhir, versi rencana bertanda tangan, jumlah dan waktu check-in terakhir) hanya terisi bila pasien menyetujui akses rekam medis; bila tidak, `clinical_visible=false`, `clinical=null`, dan `hidden_reason` menjelaskan alasannya.

```json
{
  "patient": { "id": "9a2e…", "created_at": "2026-10-01T03:00:00.000Z" },
  "consents": [{ "scope": "medical_record", "granted": true }],
  "consultation_requests": { "submitted": 1, "accepted": 0, "declined": 0 },
  "clinical_visible": true,
  "hidden_reason": null,
  "clinical": { "last_assessment_completed_at": "2026-10-02T08:00:00.000Z", "signed_plan_version": 1, "checkin_count": 3, "last_checkin_at": "2026-10-09T01:00:00.000Z" }
}
```

### `list_checkins`

Input: `patient_id`, `limit` (1–200, default **20**).

Check-in terbaru: `id`, `created_at`, `values` (nilai per metrik) dan `mood` (1–5 atau `null`). Catatan bebas pasien tidak disertakan. Tanpa check-in: `{ "checkins": [] }` dengan teks `Belum ada check-in.`

### `get_progress`

Input: `patient_id`.

Progres yang dihitung API dari check-in dan rencana: `checkin_count`, `last_checkin_at`, dan per metrik `current`, `previous`, `target`, `change_pct`, `status` (`first`/`positive`/`stable`/`slow`), `status_text`, serta `history`. Teks ringkas contohnya: `Kualitas tidur: 6 (target 8), perubahan +20%`.

### `get_care_plan`

Input: `patient_id`.

Rencana pendampingan terbaru yang **sudah ditandatangani** profesional (draf tidak pernah terlihat): versi, penanda tangan, `content` (fokus, langkah berikutnya, metrik yang dipantau, tanggal tinjauan), ringkasan konsultasi, penjelasan, dan resep terbit bila ada. Hanya baca. Tanpa rencana: `{ "plan": null }`.

### `send_checkin_reminder`

Input: `patient_id`, `due_at` (opsional, ISO 8601 mis. `2026-10-20T02:00:00Z`; kosong = sekarang).

Membuat pengingat jenis `checkin` dengan teks baku **"Waktunya check-in singkat."** yang tampil di beranda pasien pada waktu `due_at`. Tidak ada pesan bebas. Setiap panggilan membuat pengingat baru (tidak idempoten).

```json
{ "id": "…", "patient_id": "9a2e…", "kind": "checkin", "due_at": "2026-10-20T02:00:00.000Z" }
```

### `create_consultation_request`

Input:

| Field | Aturan |
| --- | --- |
| `patient_id` | Wajib, UUID |
| `program_id` | Wajib, UUID program **aktif** di klinik |
| `tujuan` | Opsional, maks. 600 karakter |
| `keluhan` | Opsional, maks. 1200 karakter |
| `pertanyaan` | Opsional, maks. 8 teks (masing-masing 1–300 karakter) |

Mengajukan permintaan konsultasi atas nama pasien; tim klinik tetap meninjau dan menjadwalkan seperti permintaan dari pasien (ini bukan pemesanan). Hasil berstatus `submitted`. Selama masih ada permintaan berstatus `submitted` untuk pasien dan program yang sama, ulangan ditolak `request_exists`. Memicu webhook `consultation.requested`.

```json
{ "id": "…", "patient_id": "9a2e…", "program_id": "…", "status": "submitted", "created_at": "2026-10-17T03:00:00.000Z" }
```

## Galat

Galat API tidak memutus koneksi MCP. Tool mengembalikan hasil `isError: true` dengan pesan yang dapat diteruskan ke pengguna:

| Asal | Kode API | Pesan yang diterima asisten |
| --- | --- | --- |
| Input tidak sesuai skema (mis. `patient_id` bukan UUID) | | Galat validasi dari SDK MCP; API tidak dipanggil |
| Kunci salah / dicabut / token kedaluwarsa | `401 invalid_credentials` | Kredensial tidak valid atau sudah dicabut. Periksa kembali kunci API atau token Anda. |
| Cakupan kurang | `403 insufficient_scope` | Kredensial ini belum memiliki cakupan akses yang dibutuhkan: `<scope>`. Minta admin klinik menambahkan cakupan tersebut pada kunci API. |
| Belum ada consent rekam medis | `403 consent_required` | Pasien belum memberi persetujuan akses rekam medis, jadi data ini tidak dapat dibaca. |
| Pasien tidak ada / milik klinik lain | `404 patient_not_found` | Pasien ini belum ditemukan di klinik Anda. |
| Program tidak ada | `404 program_not_found` | Program yang Anda pilih belum ditemukan di klinik ini. |
| Permintaan ganda | `409 request_exists` | Permintaan untuk program ini sudah kami terima dan sedang ditinjau tim klinik. |
| Batas permintaan | `429 rate_limited` | Terlalu banyak permintaan. Coba lagi dalam N detik. |
| API tidak terjangkau / > 15 detik | | API AEVIA tidak dapat dihubungi. Periksa AEVIA_API_URL dan koneksi Anda, lalu coba lagi. |

Pasien klinik lain sengaja dijawab sama dengan pasien yang tidak ada (`patient_not_found`), sehingga keberadaannya tidak bocor.

## Audit

Setiap pemanggilan tool, termasuk yang ditolak karena cakupan, tercatat di `audit_logs` klinik:

| Kolom | Isi |
| --- | --- |
| `actor_type` | `mcp` |
| `actor_id` | id kunci API |
| `after.via` | `mcp:<prefix kunci>`, mis. `mcp:aev_live_AbCd1234` |
| `action` | `integration.read.summary`, `integration.read.checkins`, `integration.read.progress`, `integration.read.care_plan`, `integration.reminder.create`, `integration.consultation_request.create`, atau `integration.denied` (cakupan kurang, dengan `missing_scopes`) |

Keterangan *terakhir dipakai* pada kunci di konsol juga diperbarui setiap kali kunci dipakai.

## Keamanan

- Buat **kunci khusus MCP** per asisten/orang, dengan cakupan minimal. Jangan memakai ulang kunci integrasi KlinikSistem/BeautyCode.
- Mencabut kunci di konsol berlaku seketika untuk kedua transport.
- Kunci adalah rahasia klinik: jangan menaruhnya di repo, `.mcp.json` yang di-commit, atau tangkapan layar. Simpan di variabel lingkungan dan rujuk dengan `${AEVIA_API_KEY}`; caranya ada di [lembar kredensial](mcp-kredensial.md).
- Data klinis hanya terbaca selama pasien menyetujui akses rekam medis; pencabutan berlaku seketika.
- Batas permintaan per kunci: 120, terisi ulang 2 per detik (sama dengan API).
- Hasil tool masuk ke konteks model AI yang Anda pakai. Pastikan penyedia/asisten tersebut sesuai kebijakan privasi klinik Anda.

## Pengembangan dan pengujian

| Berkas | Isi |
| --- | --- |
| `src/tools.ts` | Definisi 6 tool (`TOOL_NAMES`), skema input/output, teks ringkas |
| `src/client.ts` | Klien HTTP tipis ke `/v1/integrations/*` (timeout 15 detik, header `X-Aevia-Actor: mcp`) |
| `src/stdio.ts` | Entry transport stdio |
| `src/handler.ts` | Handler Streamable HTTP tanpa sesi (Web `Request` → `Response`) |
| `src/http.ts` | Server Node lokal untuk handler di atas (`MCP_PORT`, default 4100) |
| `api/mcp.ts` | Vercel Function untuk handler yang sama |

```bash
pnpm --filter @aevia/mcp test        # klien MCP in-memory + Streamable HTTP terhadap API sungguhan (PGlite)
pnpm --filter @aevia/mcp typecheck
```

Test memastikan: tepat 6 tool dan tidak ada tool SOAP/resep/rencana-tulis, isolasi klinik, consent, cakupan terbatas, kunci dicabut, audit `actor_type=mcp`, serta `401`/`405` pada HTTP.

Menambah tool: tambahkan route di API integrasi lebih dulu (cakupan + audit di sana), lalu daftarkan tool di `src/tools.ts`, perbarui `TOOL_NAMES`, test jumlah tool, dan dokumen ini. Jangan pernah menambah tool yang menulis SOAP, resep, atau rencana.
