# Sisa pekerjaan — AEVIA (per 2026-10-23)

Status: MVP 12/12 fase selesai; produksi berdiri (Supabase "Aevia konsult" + Vercel aevia-web/api/console), belum ada pasien sungguhan.

## A. Sudah dicek & beres (2026-10-23)

- [x] typecheck 7/7 · test 248 lulus (mode paralel, berulang) · smoke produksi 150 cek
- [x] Suite paralel stabil (hookTimeout 60 dtk) dan runner migrasi toleran nama tanpa `.sql`
- [x] `aevia_app` bukan superuser, tanpa BYPASSRLS
- [x] `anon`/`authenticated` tanpa hak di tabel public
- [x] Semua tabel klinis ber-RLS (hanya `clinics` tanpa RLS — disengaja, direktori brand publik)
- [x] Bucket `skin-photos` privat
- [x] Tidak ada data seed demo di produksi (tak ada email `.test`, hanya klinik `drmetz`)
- [x] Kode: produksi menolak start tanpa pengirim email OTP, `JWT_SECRET` < 32 karakter, atau `ENCRYPTION_KEY` kosong → kode OTP tidak pernah masuk log produksi
- [x] Migrasi 0016 dibuat (temuan Supabase advisor): `search_path` tetap untuk fungsi guard + kebijakan RLS dihitung sekali per query

## B. Vercel (dicek via MCP 2026-10-23)

- [x] Production ketiga project **READY** dari `main` (8a3f5ed, 9 Okt); tanpa error runtime 7 hari terakhir
- [x] `aevia-api.vercel.app/health` → `{"status":"ok"}`; `/v1/clinics/drmetz/public` → data klinik (API ↔ database tersambung)
- [x] Web pasien `aevia-web-theta.vercel.app/c/drmetz` tampil; console `aevia-console.vercel.app/masuk` tampil
- [x] Env aevia-api lengkap (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET, Mailketing + OTP_FROM_EMAIL, Supabase storage, ANTHROPIC_API_KEY); web `API_URL`, console `API_URL` + `API_PUBLIC_URL` → `https://aevia-api.vercel.app`
- [ ] Tandai `MAILKETING_API_TOKEN` & `ANTHROPIC_API_KEY` sebagai Sensitive (label "Needs Attention"; tidak mendesak)
- [ ] Alamat web pasien `aevia-web-theta.vercel.app` kurang rapi untuk dibagikan — pertimbangkan domain sendiri (mis. `app.drmetz.id`) + `PLATFORM_HOSTS`
- [ ] Project `aevia-mcp` belum ada — hanya perlu bila MCP lewat HTTP dipakai (Claude Desktop/Code)

## B2. Branch yang belum digabung ke `main`

- [ ] `claude/tender-keller-k5vr8h` — CRM: API kontak + fase lead (migrasi `0015_crm_contacts`). Gabungkan **sebelum** branch ini agar migrasi 0016 ikut merapikan kebijakan RLS tabel CRM
- [ ] `claude/hopeful-shannon-g57fxf` — dokumentasi MCP (docs/integrasi/mcp.md, versi Word, lembar kredensial)
- [ ] `claude/busy-ramanujan-xbdou2` — perbaikan tes, runner migrasi, migrasi 0016, daftar ini
- `claude/ecstatic-tesla-d8c6g4` sudah tercakup di `main` (tidak ada commit baru) — boleh dihapus

## C. Teknis — butuh izin terapkan ke database produksi

- [ ] Terapkan migrasi 0016 (`pnpm db:migrate` dengan `DATABASE_URL` produksi, atau lewat Supabase)

## D. Keputusan dr. Metz / bisnis (menyusul)

- [ ] **Harga & isi paket DrMetz** — produksi masih memakai angka contoh seed: Konsultasi Healthy Aging Rp450.000 · Pendampingan Kulit 8 Minggu Rp1.850.000 · Komposisi Tubuh 12 Minggu Rp2.950.000 (ubah di console → Pengaturan → Program)
- [ ] Tinjauan klinis bank pertanyaan assessment v0 (tidur, energi, aktivitas, stres, kulit, tujuan)
- [ ] Parameter default analisis kulit (Melasma & hiperpigmentasi, Eritema vaskular, Komedo & porfirin, TEWL & dehidrasi, Overall skin score)
- [ ] Kriteria verifikasi profesional
- [ ] Standar minimum lintas klinik (sebelum klinik partner ke-2)
- [ ] Model afiliasi
- [ ] Nama asisten klinik (default "Sovia"; nama baru perlu persetujuan admin AEVIA)

## E. Integrasi pihak ketiga

- [ ] KlinikSistem: pasang kontrak AEVIA (inbound + webhook) di aplikasi KlinikSistem — docs/integrasi/kliniksistem.md
- [ ] Beauty Code: isi alamat, ID klinik, dan kunci API `tracker:read` di console → Pengaturan → Integrasi — docs/integrasi/beautycode.md

## F. Uji coba sebelum buka ke pasien

- [ ] Satu alur penuh di produksi: pasien masuk → consent → assessment → konsultasi → SOAP/resep → rencana bertanda tangan → check-in. Pakai email khusus uji; audit log append-only, jadi jejak uji tidak bisa dihapus bersih
- [ ] Email OTP benar-benar sampai (bukan spam) dari domain klinik

## G. Opsional — performa saat data membesar (Supabase advisor, level INFO)

- [ ] 33 foreign key tanpa indeks penutup (mayoritas `clinic_id`) — tambahkan bila query/hapus mulai lambat
- [ ] 13 indeks "belum terpakai" — wajar karena belum ada trafik; tinjau ulang setelah 1–2 bulan pemakaian

## H. Di luar cakupan MVP (roadmap)

Pembayaran/checkout · video call bawaan · analisis foto otomatis AI · modul Body Type · aplikasi native · penautan akun lintas klinik · Konektor.id · DrMetz Ecosystem
