# PRD — AEVIA MVP (platform healthy aging lintas klinik)

## Problem Statement
Pasien healthy aging punya terlalu banyak informasi tapi tidak punya gambaran kondisi yang terstruktur, rencana personal, tindak lanjut, dan cara melihat progres. Konsultasi berhenti di ruang praktik. Klinik (DrMetz pertama) belum punya sistem pendampingan yang konsisten dan bisa dipakai klinik lain dengan brand mereka sendiri.

## Solution
Platform multi-tenant: pasien melakukan assessment dengan Sovia (AI guide), memilih program/konsultasi di klinik, profesional meninjau, menulis SOAP + skin analysis + resep + rencana personal yang ditandatangani, lalu pasien menjalankan check-in dan melihat progres. Klinik tampil co-brand ("powered by AEVIA") atau white-label penuh. Ekosistem lain (KlinikSistem, BeautyCode) tersambung lewat REST API, webhook, dan MCP.

## User Stories
### Pasien
1. As a pasien, I want membuka halaman klinik (brand klinik) sehingga saya tahu di mana saya dilayani.
2. As a pasien, I want daftar/masuk dengan email + OTP di klinik tertentu, sehingga akun saya terpisah per klinik.
3. As a pasien, I want memberi/mencabut consent per cakupan (assessment, rekam medis, foto), sehingga data saya terkendali.
4. As a pasien, I want menjawab assessment terpandu Sovia satu pertanyaan per langkah, sehingga kondisi saya terpetakan.
5. As a pasien, I want melihat gambaran awal per area (tidur, energi, aktivitas, stres, kulit) dengan label "Hasil assessment bukan diagnosis".
6. As a pasien, I want melihat katalog program/konsultasi klinik (harga diatur klinik) dan mengajukan permintaan konsultasi.
7. As a pasien, I want Sovia menyiapkan ringkasan prep konsultasi (tujuan, keluhan, pertanyaan untuk dokter) yang bisa saya edit.
8. As a pasien, I want melihat ringkasan konsultasi + rencana personal (Fokus saat ini, Langkah berikutnya, Yang dipantau, Kapan ditinjau) setelah disetujui profesional.
9. As a pasien, I want check-in berkala (skala 1–5 per area + catatan), sehingga progres tercatat.
10. As a pasien, I want melihat progres (Current/Previous/Target/Trend, "Naik 8% sejak check-in terakhir").
11. As a pasien, I want melihat empty state yang menenangkan saat belum ada rencana/progres.
12. As a pasien, I want Sovia mengarahkan saya ke layanan medis langsung bila saya menulis tanda darurat.
13. As a pasien, I want selalu tahu bahwa Sovia adalah AI.
### Profesional
14. As a profesional, I want melihat antrean permintaan konsultasi klinik saya beserta assessment + prep pasien (hanya bila consent).
15. As a profesional, I want menulis catatan SOAP terstruktur per konsultasi.
16. As a profesional, I want mengisi skin analysis (skor manual per parameter, upload foto, anotasi titik/area sederhana, heatmap overlay).
17. As a profesional, I want menulis resep (nama, dosis, aturan pakai, durasi) — hanya profesional yang bisa.
18. As a profesional, I want menyusun rencana personal dan menandatanganinya (approve) sehingga baru tampil ke pasien.
19. As a profesional, I want melihat check-in dan progres pasien saya.
20. As a profesional, I want setiap perubahan SOAP/resep/rencana tercatat di audit log (siapa, apa, kapan, sebelum/sesudah).
### Admin klinik
21. As a admin klinik, I want mengelola profesional & staf klinik.
22. As a admin klinik, I want mengatur brand mode `cobrand`/`whitelabel` (logo, warna, font, nama/avatar asisten, domain) dengan cek kontras WCAG AA.
23. As a admin klinik, I want mengajukan nama asisten kustom yang aktif setelah disetujui admin AEVIA.
24. As a admin klinik, I want mengelola katalog program + harga.
25. As a admin klinik, I want menyalakan mode LLM Sovia (hanya bila API key platform tersedia).
26. As a admin klinik, I want membuat API key & OAuth client, serta webhook endpoint klinik.
### Admin AEVIA
27. As a admin AEVIA, I want membuat klinik (tenant) baru dan admin pertamanya.
28. As a admin AEVIA, I want menyetujui/menolak nama asisten kustom.
### Sistem/Integrasi
29. As a aplikasi ekosistem, I want REST API v1 terdokumentasi OpenAPI dengan auth API key / client-credentials berscope.
30. As a aplikasi ekosistem, I want menerima webhook bertanda tangan HMAC (assessment.completed, consultation.requested, plan.approved, checkin.submitted, progress.updated) dengan retry.
31. As a agen AI (MCP client), I want tools read (ringkasan pasien, check-in, progres, rencana) dan write terbatas (kirim pengingat, buat permintaan konsultasi) — tidak ada tool resep/rencana/SOAP.
32. As a KlinikSistem, I want menerima permintaan konsultasi AEVIA sebagai booking dan mengirim status kunjungan (Scheduled/Completed/No-show/Cancelled) kembali.
33. As a BeautyCode, I want mengirim data tracker (skor kulit, tidur, diet trigger) ke akun pasien AEVIA sebagai konteks (dengan consent).
### Edge & error
34. As a pasien, I want pesan error yang manusiawi ("Ada satu bagian yang belum terisi.", "Sepertinya sesi Anda sudah berakhir.").
35. As a sistem, I want menolak akses lintas klinik (data klinik A tidak pernah terbaca dari konteks klinik B), dibuktikan di level DB.
36. As a sistem, I want menolak keluaran Sovia yang mengandung kata terlarang/diagnosis dan menggantinya dengan kalimat aman.
37. As a profesional, I want rencana yang sudah ditandatangani terkunci; perubahan membuat versi baru yang perlu tanda tangan lagi.

## Implementation Decisions
- Monorepo pnpm + Turborepo: `api` (Fastify + TS), `web` (pasien, Next.js), `console` (klinik/profesional/admin, Next.js), `mcp` (MCP server), paket `core` (domain, schema Zod, guardrail Sovia, kontrak), paket `ui` (token AEVIA + komponen), paket `db` (Drizzle schema + migrasi + RLS).
- DB Postgres (Supabase di produksi). Semua tabel klinis punya `clinic_id`; RLS aktif + FORCE, policy `clinic_id = current_setting('app.clinic_id')`; API menjalankan query per-request di transaksi dengan role non-superuser `aevia_app` + `set_config`. Dev/test memakai PGlite (Postgres WASM) dengan migrasi yang sama.
- Akun pasien: tabel `patients` unik (clinic_id, email); `global_subject_id` nullable tanpa fitur. Staf: `staff` (clinic_id, role professional|clinic_admin) dan `platform_admins`.
- Auth: OTP email 6 digit (hash, kedaluwarsa 10 menit, maks 5 percobaan) → JWT akses (jose) berisi sub, clinic_id, role. Pengirim OTP lewat adapter (`console` di dev; email provider di produksi).
- Consent: tabel `consents` (patient_id, scope, granted_at, revoked_at); akses profesional ke assessment/foto/rekam medis dicek consent.
- Sovia: `SoviaEngine` dengan mode `script` (default, deterministik dari bank pertanyaan JSON) dan `llm` (via `LLMProvider`, implementasi Claude) aktif hanya bila `ANTHROPIC_API_KEY` ada + `clinics.llm_enabled`. Semua keluaran melewati guardrail: filter kata terlarang (Verbal Identity §14), larangan diagnosis/resep, deteksi kata darurat → pesan rujukan, label AI. Keluaran Sovia ke dokter selalu status `draft`.
- Domain klinis: `assessments`, `assessment_answers`, `consultation_requests`, `consultations`, `soap_notes`, `skin_analyses` (+ `skin_photos`, `annotations` JSON), `prescriptions` (+ items), `care_plans` (versi, status draft|signed, signed_by, signed_at, content JSON 4 bagian), `checkins`, `progress_metrics` (current/previous/target), `audit_logs` (actor, entity, action, before, after).
- Brand: `clinics` (slug, name, brand_mode cobrand|whitelabel, logo_url, colors JSON, font, assistant_name, assistant_name_status pending|approved|rejected, avatar_url, custom_domain, llm_enabled). Warna kustom divalidasi kontras AA terhadap latar; resolusi tenant via slug path atau custom domain.
- Storage foto: adapter (`local` di dev, Supabase Storage di produksi), URL bertanda tangan.
- API publik `/v1/*` (OpenAPI dari Zod, `/v1/openapi.json`). Auth integrasi: API key (`aev_` + hash, scopes) dan OAuth2 client-credentials (`/v1/oauth/token`). Webhook: `webhook_endpoints` + `webhook_deliveries`, header `X-Aevia-Signature: sha256=` HMAC, retry eksponensial 3×.
- MCP: server stdio + Streamable HTTP, auth API key klinik, tools memanggil service yang sama dengan API, setiap panggilan diaudit.
- Konektor: `KlinikSistemConnector` (push permintaan konsultasi sebagai booking; terima status kunjungan via endpoint inbound) dan `BeautyCodeConnector` (endpoint inbound data tracker → `external_context` pasien, butuh consent). Kontrak didefinisikan AEVIA.
- Copy UI mengikuti Verbal Identity 3.0 (CTA sentence case, tanpa "wajib/gagal/permanen/garansi").
- Deploy: konfigurasi Vercel (web, console, api sebagai Functions) + Supabase siap pakai; tidak dideploy otomatis.

## Out of Scope
Pembayaran/checkout, video call bawaan (cukup link Meet/Zoom per konsultasi), analisis foto otomatis AI/multi-spectral, modul Body Type, aplikasi native (PWA saja), penautan akun lintas klinik, Konektor.id, DrMetz Ecosystem, deploy ke produksi.

## Further Notes
- Asumsi (diambil tanpa ditanya, user minta jalan sampai selesai):
  - Auth dibangun di API, bukan Supabase Auth — Supabase Auth membuat email unik global, bertentangan dengan keputusan akun terpisah per klinik. Supabase tetap untuk Postgres + Storage.
  - Dev/test memakai PGlite agar test RLS nyata tanpa Docker/Supabase.
  - KlinikSistem & BeautyCode belum punya API publik yang diketahui → AEVIA mendefinisikan kontrak (inbound endpoint + webhook) dan menyediakan klien adapter + mock; tinggal dipasang di kedua app.
  - Bank pertanyaan assessment v0 disusun dari area di desain (tidur, energi, aktivitas, stres, kulit, tujuan) — isi klinis final ditinjau dr. Metz.
  - Parameter skin analysis mengikuti screenshot (Melasma & hiperpigmentasi, Eritema vaskular, Komedo & porfirin, TEWL & dehidrasi, Overall skin score) sebagai default per klinik.
  - Hex resmi = PDF v1.0. Tagline "Guidance for Better Aging.".
- Pertanyaan terbuka (Master Blueprint §7): kriteria verifikasi profesional, paket & harga awal DrMetz, standar minimum lintas klinik, model afiliasi.

## Changelog
- 2026-10-04 · Phase 1 · Smoke UI memakai skrip fetch HTML (Playwright spec tetap ada) — alasan: unduhan Chromium diblokir kebijakan egress sandbox. `clinics` tanpa RLS (direktori brand publik, read-only untuk aevia_app); RLS di tabel klinis.
- 2026-10-04 · Phase 1–3 · Font self-hosted @fontsource (Google Fonts diblokir egress & lebih andal untuk white-label); token `body` #3A4A5E & `copper-ink` ditambah demi WCAG AA — alasan: slate/copper di ivory < 4.5:1. Skor hasil assessment ditampilkan sebagai level, bukan angka /100 (Progress, Not Perfection).
- 2026-10-04 · Phase 7 · progress_metrics tidak disimpan; progres dihitung dari checkins + monitor[] rencana. Semua skala check-in 1–5 = paling baik (stres → "Ketenangan"). Smoke memakai build produksi + port acak + data sementara — alasan: smoke flaky dengan next dev.
- 2026-10-04 · Phase 12 · Suite diuji juga di Postgres 16 sungguhan (owner non-superuser): perbaikan FORCE RLS untuk seed/createClinic/lookup staf (`ownerTx`, staff tanpa FORCE), hak anon/authenticated Supabase dicabut. Rahasia webhook & konektor terenkripsi AES-256-GCM. OTP produksi via Resend.
