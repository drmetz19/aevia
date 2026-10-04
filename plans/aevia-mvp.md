# Plan: AEVIA MVP

> Source PRD: plans/prd-aevia-mvp.md · Desain: plans/desain-terkunci.md · Keputusan: plans/keputusan.md

## Architectural decisions
- **Apps/paket**: api (Fastify, port 4000) · web pasien (Next.js, 3000) · console (Next.js, 3001) · mcp · core · db · ui.
- **Routes API**: publik `/v1/*`; tenant di path `/v1/clinics/:slug/...` untuk pasien; staf & integrasi diturunkan dari token. `/v1/openapi.json`, `/health`.
- **Routes web**: `/c/:slug` (landing), `/c/:slug/masuk`, `/c/:slug/assessment`, `/c/:slug/program`, `/c/:slug/konsultasi/:id`, `/c/:slug/rencana`, `/c/:slug/checkin`, `/c/:slug/progres`. Custom domain → middleware memetakan host ke slug.
- **Routes console**: `/masuk`, `/antrean`, `/pasien/:id`, `/konsultasi/:id` (tab SOAP · Skin · Resep · Rencana · Audit), `/pengaturan/brand`, `/pengaturan/program`, `/pengaturan/integrasi`, `/admin/klinik`, `/admin/asisten`.
- **Schema**: semua tabel klinis ber-`clinic_id` + RLS FORCE; role DB `aevia_app`; konteks via `set_config('app.clinic_id', …, true)` per transaksi.
- **Auth**: OTP email → JWT {sub, clinic_id, role: patient|professional|clinic_admin|aevia_admin}; integrasi: API key scoped / OAuth client-credentials.
- **Sovia**: SoviaEngine(script|llm) + Guardrail di core; keluaran ke dokter = draft.
- **Seed dev**: klinik `drmetz` (cobrand), klinik `demo-partner` (whitelabel) untuk uji isolasi; profesional, admin, pasien demo; OTP tampil di log API (adapter console).

---

## Phase 1: Fondasi monorepo + tenant + landing klinik
**Jenis**: campuran
**User stories**: 1, 35

### What to build
Monorepo berjalan; DB (PGlite dev/test, pg prod) dengan migrasi `clinics` + RLS + role `aevia_app`; seed 2 klinik; API `GET /health`, `GET /v1/clinics/:slug/public` (brand publik); web `/c/:slug` landing klinik dengan header cobrand/whitelabel sesuai data, token AEVIA, copy Verbal Identity, CTA "Mulai assessment"; console placeholder `/masuk`.

### Acceptance criteria
- [x] `pnpm install && pnpm typecheck && pnpm test` hijau dari root
- [x] `GET /v1/clinics/drmetz/public` → 200 berisi brand_mode cobrand; slug tak dikenal → 404 dengan pesan manusiawi
- [x] `/c/drmetz` menampilkan nama DrMetz + "powered by AEVIA"; `/c/demo-partner` tidak menampilkan kata AEVIA
- [x] Test DB membuktikan role `aevia_app` dengan `app.clinic_id`=A tidak bisa membaca baris klinik B

---

## Phase 2: Akun pasien per klinik + OTP + consent
**Jenis**: campuran
**User stories**: 2, 3, 34, 35

### What to build
`patients` unik (clinic_id,email), `otp_codes`, `consents`, `staff`, `platform_admins`; `POST /v1/clinics/:slug/auth/otp` & `/verify` → JWT; staf login sama via `/v1/staff/auth/*`; `GET/PUT /v1/me/consents`. Web: halaman masuk (email → kode) + layar consent; console: masuk staf.

### Acceptance criteria
- [ ] Email sama bisa punya akun terpisah di drmetz dan demo-partner (2 id berbeda)
- [ ] OTP salah 5× → dikunci; kedaluwarsa 10 menit; pesan error manusiawi
- [ ] Token pasien klinik A ditolak (403) di endpoint klinik B
- [ ] Consent bisa diberi & dicabut; status tersimpan dengan timestamp
- [ ] Web: alur masuk → consent → beranda pasien berjalan (Playwright)

---

## Phase 3: Assessment Sovia (mode skrip) + guardrail
**Jenis**: campuran
**User stories**: 4, 5, 12, 13, 36

### What to build
Bank pertanyaan v0 (JSON di core), SoviaEngine mode script, Guardrail (kata terlarang, larangan diagnosis, deteksi darurat). `POST /v1/assessments` · `POST /v1/assessments/:id/answers` · `POST /v1/assessments/:id/complete` → hasil per area (skor + label tenang) + disclaimer. Web: layar chat Sovia satu pertanyaan per langkah, progress bar, layar hasil.

### Acceptance criteria
- [ ] Assessment selesai menghasilkan skor per area & teks "Hasil assessment bukan diagnosis."
- [ ] Teks bebas berisi kata darurat (mis. "nyeri dada", "sesak napas") → respon rujukan ke layanan medis, assessment ditandai `flagged`
- [ ] Unit test guardrail: kalimat dengan "wajib/gagal/permanen/diagnosis Anda" diganti kalimat aman
- [ ] Label "Sovia adalah AI" tampil di layar chat
- [ ] Event internal `assessment.completed` tercatat (outbox)

---

## Phase 4: Katalog program + permintaan & prep konsultasi + antrean dokter
**Jenis**: campuran
**User stories**: 6, 7, 14

### What to build
`programs` (per klinik, harga, durasi, deskripsi), `consultation_requests`, `consultations`. Pasien pilih program/konsultasi → Sovia membuat draft prep (tujuan, keluhan, pertanyaan untuk dokter dari assessment) → pasien edit & kirim. Console: antrean permintaan, detail pasien (assessment + prep hanya bila consent assessment aktif), terima → jadwal + link Meet/Zoom.

### Acceptance criteria
- [ ] Katalog web menampilkan program milik klinik itu saja dengan harga dari DB
- [ ] Draft prep terisi otomatis dari assessment & bisa diedit sebelum dikirim
- [ ] Profesional melihat permintaan di antrean; tanpa consent assessment → isi assessment tersembunyi + keterangan
- [ ] Terima permintaan membuat `consultation` berjadwal dengan link meeting; pasien melihat status di stepper

---

## Phase 5: Console SOAP + skin analysis + audit log
**Jenis**: campuran
**User stories**: 15, 16, 20

### What to build
`soap_notes`, `skin_analyses`, `skin_photos`, `audit_logs`; StorageProvider (local/supabase). Console tab SOAP (S/O/A/P) dan Skin (skor per parameter default klinik, upload foto, anotasi titik/area di atas foto, heatmap overlay sederhana), tab Audit. Semua tulis via service yang mencatat audit (before/after).

### Acceptance criteria
- [ ] Profesional menyimpan SOAP; edit kedua tercatat di audit dengan before/after
- [ ] Upload foto (jpg/png ≤10MB) tersimpan & tampil via URL bertanda tangan; consent foto dicabut → foto tidak bisa diakses
- [ ] Anotasi tersimpan & tampil kembali di posisi yang sama
- [ ] Pasien (token patient) ditolak mengakses endpoint SOAP/skin

---

## Phase 6: Resep + rencana personal bertanda tangan → tampil ke pasien
**Jenis**: campuran
**User stories**: 8, 11, 17, 18, 37

### What to build
`prescriptions` + items, `care_plans` berversi (draft→signed). Console: tab Resep & tab Rencana (Fokus saat ini · Langkah berikutnya · Yang dipantau · Kapan ditinjau + target metrik) → tombol tanda tangan. Web: halaman ringkasan konsultasi + rencana ("Rencana Anda telah diperbarui oleh tim <klinik>"), Sovia menjelaskan rencana (mode skrip: templat), empty state sebelum signed.

### Acceptance criteria
- [ ] Hanya role professional bisa membuat resep/menandatangani rencana (Sovia/MCP/pasien ditolak)
- [ ] Rencana signed tidak bisa diedit; edit membuat versi baru status draft
- [ ] Pasien hanya melihat versi signed terbaru; sebelum ada → empty state "Rencana akan tersedia setelah konsultasi selesai ditinjau profesional."
- [ ] Event `plan.approved` tercatat di outbox

---

## Phase 7: Check-in + progres + pengingat
**Jenis**: campuran
**User stories**: 9, 10, 11, 19

### What to build
`checkins`, `progress_metrics` (dari rencana: area + target), `reminders`. Web: check-in (skala 1–5 per area yang dipantau + catatan), halaman progres (kartu per metrik: current/previous/target/trend + sparkline + delta %), empty state. Console: tab progres pasien. Pengingat check-in terjadwal tersimpan & tampil sebagai notifikasi in-app.

### Acceptance criteria
- [ ] Check-in kedua menghitung delta % vs sebelumnya ("Naik 8% sejak check-in terakhir")
- [ ] Belum ada check-in → "Belum ada data progres. Setelah check-in pertama, perkembangan Anda akan mulai terlihat di sini."
- [ ] Profesional melihat grafik progres pasien yang sama
- [ ] Event `checkin.submitted` & `progress.updated` tercatat

---

## Phase 8: Pengaturan klinik (brand mode, asisten, program, LLM) + admin AEVIA
**Jenis**: campuran
**User stories**: 21, 22, 23, 24, 25, 27, 28

### What to build
Console pengaturan: brand mode cobrand/whitelabel, logo, warna (validasi kontras AA), font (pilihan terbatas), nama/avatar asisten (status pending → approved/rejected), custom domain, toggle LLM (disabled bila platform tanpa API key), CRUD program & staf. Admin AEVIA: buat klinik + admin pertama, antrean persetujuan nama asisten. Web membaca tema klinik (CSS variables) & nama asisten approved.

### Acceptance criteria
- [ ] Warna kontras < 4.5:1 ditolak dengan pesan yang menjelaskan
- [ ] Nama asisten baru tidak tampil di web sampai disetujui admin AEVIA
- [ ] Ganti ke whitelabel → web klinik itu tidak menampilkan "AEVIA" di UI (kecuali halaman syarat & ketentuan)
- [ ] Toggle LLM tidak bisa dinyalakan tanpa `ANTHROPIC_API_KEY` platform
- [ ] Admin AEVIA membuat klinik baru → slug baru langsung bisa dibuka

---

## Phase 9: API publik integrasi (API key, OAuth, webhook HMAC, OpenAPI)
**Jenis**: backend
**User stories**: 26, 29, 30

### What to build
`api_keys` (hash, scopes), `oauth_clients`, `/v1/oauth/token` client-credentials, `webhook_endpoints`, `webhook_deliveries` + dispatcher outbox (HMAC sha256, retry 3× eksponensial), `/v1/openapi.json` dari Zod. Console tab Integrasi: buat/cabut key & client (secret tampil sekali), daftar webhook + log pengiriman.

### Acceptance criteria
- [ ] Key dengan scope `read:patients` bisa GET ringkasan pasien, ditolak untuk scope lain (403)
- [ ] Client-credentials mengembalikan token berumur pendek berscope
- [ ] Webhook terkirim dengan `X-Aevia-Signature` yang terverifikasi; endpoint gagal → retry tercatat 3×
- [ ] `/v1/openapi.json` valid OpenAPI 3.1 dan memuat semua route /v1

---

## Phase 10: MCP server
**Jenis**: backend
**User stories**: 31

### What to build
`apps/mcp` dengan @modelcontextprotocol/sdk: transport stdio + Streamable HTTP; auth API key klinik; tools: `get_patient_summary`, `list_checkins`, `get_progress`, `get_care_plan` (read), `send_checkin_reminder`, `create_consultation_request` (write terbatas). Setiap panggilan diaudit. Contoh konfigurasi klien MCP di README.

### Acceptance criteria
- [ ] Klien MCP test mendaftar tools persis 6 di atas (tidak ada tool resep/rencana/SOAP)
- [ ] Panggilan dengan key klinik A tidak bisa membaca pasien klinik B
- [ ] Setiap panggilan tool menghasilkan baris audit_logs actor=mcp:<key>

---

## Phase 11: Konektor KlinikSistem + BeautyCode
**Jenis**: backend
**User stories**: 32, 33

### What to build
Kontrak di `docs/integrasi/` (KlinikSistem, BeautyCode). KlinikSistem: permintaan konsultasi diterima → push booking ke URL KlinikSistem klinik (adapter HTTP); inbound `POST /v1/integrations/kliniksistem/visits` (status Scheduled/Completed/No-show/Cancelled) → update konsultasi. BeautyCode: inbound `POST /v1/integrations/beautycode/tracker` (skor kulit, tidur, diet trigger) → `external_context` pasien bila consent; tampil di console & draft prep. Mock server untuk test.

### Acceptance criteria
- [ ] Konsultasi diterima → mock KlinikSistem menerima booking dengan payload sesuai kontrak
- [ ] Status "Completed" dari KlinikSistem mengubah status konsultasi AEVIA
- [ ] Data BeautyCode tanpa consent ditolak (403); dengan consent tampil di detail pasien console
- [ ] Inbound wajib auth API key scope `integrations:write` (key klinik lain ditolak)

---

## Phase 12: Sovia mode LLM (Claude) di balik toggle
**Jenis**: backend
**User stories**: 25, 36

### What to build
`LLMProvider` + `ClaudeProvider` (SDK Anthropic, model dari env), dipakai untuk ringkasan prep & penjelasan rencana bila `ANTHROPIC_API_KEY` + `llm_enabled`; fallback otomatis ke skrip bila error/timeout; keluaran tetap lewat Guardrail; prompt sistem berisi Verbal Identity + batas klinis. Test memakai provider palsu.

### Acceptance criteria
- [ ] Tanpa API key → mode skrip dipakai walau toggle on
- [ ] Provider palsu yang mengembalikan "Anda wajib…/diagnosis…" → keluaran disaring guardrail
- [ ] Provider error/timeout → fallback skrip, tidak ada error ke pasien
- [ ] Tidak ada jalur LLM yang bisa menulis SOAP/resep/rencana

---
