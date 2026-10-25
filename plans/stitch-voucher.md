# Plan: Redesain Aevia Konsult (Stitch) + akses program via voucher

> Source PRD: plans/prd-stitch-voucher.md · Desain: plans/desain-terkunci.md · Brief: plans/brief-stitch-voucher.md

## Architectural decisions
- **Tema**: token tetap di `@aevia/ui` (CSS var `--brand-*` + util Tailwind lama); nilai diganti ke Stitch. Whitelabel (`clinic_settings` colors) tetap menimpa `--brand-*`.
- **Schema**: migrasi 0017 → `programs.price_mode` (`amount`|`coming_soon`, default `amount`), `programs.access` (`open`|`voucher`, default `open`). Migrasi 0018 → `vouchers` (id, clinic_id, code UPPER unik per klinik, program_id null = semua, max_uses null = tak terbatas, expires_at null, active, used_count, created_at) + `voucher_redemptions` (id, clinic_id, voucher_id, patient_id, request_id, at; unik voucher_id+patient_id). RLS tenant_isolation bentuk `(SELECT …)` seperti 0016; grant aevia_app; revoke anon/authenticated.
- **Routes**: publik program list mengembalikan `price_mode`, `access` (price_idr null bila coming_soon). Staf: `GET/POST /v1/staff/vouchers`, `PATCH /v1/staff/vouchers/:id` (aktif/nonaktif) — clinic_admin. Pasien: body permintaan konsultasi + `voucher_code?`. Antrean/detail permintaan + `voucher_code`.
- **Penukaran**: satu transaksi dengan pembuatan permintaan; `SELECT … FOR UPDATE` voucher; galat `voucher_required|voucher_invalid|voucher_expired|voucher_exhausted|voucher_not_for_program|voucher_already_used` (HTTP 400/409, pesan Indonesia).
- **Produksi**: migrasi 0017–0018 dipasang terpisah (SQL Editor) setelah merge — tidak otomatis.

---

## Phase 1: Fondasi desain Aevia Konsult
**Jenis**: ui
**User stories**: 1, 2, 3, 9, 16

### What to build
Ganti nilai token, font, radius, dan gaya kartu/tombol bersama ke Stitch; tambah komponen logo Aevia Konsult (mark + lengkap) di web & console; badge "powered by Aevia Konsult" pada header pasien cobrand; heading tidak lagi serif; tombol radius 8 (bukan pill) di komponen bersama; shell console (sidebar putih, item aktif cyan, kanvas slate).

### Acceptance criteria
- [x] `/c/drmetz` memuat teks "Aevia Konsult" dan mark logo SVG; `/c/demo-partner` tanpa kata "Aevia" (teks, title, alt)
- [x] Token default: `--brand-accent` #0E7490, latar #F8FAFC, teks #0F172A; heading memakai Plus Jakarta Sans (tidak ada `DM Serif` di CSS yang dimuat)
- [x] Whitelabel demo-partner tetap menimpa `--brand-primary` (#1F4D3F) seperti sebelumnya
- [x] Console `/masuk` & halaman staf memakai logo Aevia Konsult di sidebar/header
- [x] typecheck, test, smoke lulus (pemeriksaan smoke lama yang memeriksa copy lama disesuaikan)

---

## Phase 2: Tampilan harga "Segera hadir" + akses program
**Jenis**: campuran
**User stories**: 4, 5, 10

### What to build
Migrasi 0017; admin klinik mengatur tampilan harga & akses per program di Pengaturan → Program; API publik mengembalikan field baru dan menyembunyikan harga bila coming_soon; halaman program pasien memakai kartu harga Stitch ("Segera hadir" / angka, badge "Perlu kode voucher" bila access=voucher). Seed demo: program DrMetz coming_soon + voucher.

### Acceptance criteria
- [x] Admin klinik menyimpan program dengan price_mode=coming_soon & access=voucher; GET staf mengembalikan nilainya
- [x] API publik program: price_idr null + price_mode coming_soon untuk program tsb
- [x] Halaman program pasien menampilkan "Segera hadir" (bukan angka) dan penanda voucher; program amount tetap menampilkan Rupiah
- [x] Profesional (bukan admin) ditolak mengubah program (403)

---

## Phase 3: Kelola voucher di console
**Jenis**: campuran
**User stories**: 11, 12, 17

### What to build
Migrasi 0018 (vouchers + redemptions + RLS); endpoint staf daftar/buat/nonaktifkan; menu Pengaturan → Voucher (form kode, program/semua, kuota, kedaluwarsa; tabel kode · program · terpakai/kuota · kedaluwarsa · status; tombol nonaktifkan). Kode dinormalisasi huruf besar, unik per klinik; audit `voucher.create`/`voucher.deactivate`.

### Acceptance criteria
- [ ] Admin membuat voucher "UJI2026" (semua program, kuota 5) → muncul di daftar dengan terpakai 0/5
- [ ] Kode duplikat (beda huruf besar/kecil) di klinik sama ditolak 409; klinik lain boleh memakai kode sama
- [ ] Voucher klinik A tidak terlihat oleh staf klinik B (RLS)
- [ ] Nonaktifkan → status Nonaktif; tercatat di audit

---

## Phase 4: Intake konsultasi 2 kolom + tukar voucher
**Jenis**: campuran
**User stories**: 6, 7, 8, 13, 17

### What to build
Halaman konsultasi pasien menjadi intake 2 kolom ala Stitch (stepper Assessment → Program → Kirim; kiri isian + kolom kode voucher; kanan ringkasan program & klinik); kolom voucher wajib bila access=voucher. Penukaran atomik saat kirim permintaan; 6 pesan galat; antrean & detail permintaan console menampilkan kode voucher.

### Acceptance criteria
- [ ] Program access=voucher tanpa kode → pesan voucher_required; dengan kode valid → permintaan terkirim, used_count +1, redemption tercatat
- [ ] Kode salah / kedaluwarsa / kuota habis / bukan untuk program / sudah dipakai pasien sama → masing-masing pesan sesuai, permintaan tidak dibuat
- [ ] Dua penukaran bersamaan pada sisa kuota 1 → hanya satu berhasil
- [ ] Antrean console menampilkan kode voucher pada permintaan tersebut
- [ ] Program access=open tetap bisa dikirim tanpa kode

---

## Phase 5: Landing & halaman pasien ala Stitch
**Jenis**: ui
**User stories**: 1, 4, 9

### What to build
Landing klinik mengikuti `landing.png` (hero + CTA, 3 langkah, kartu program dari data, FAQ statis yang aman Verbal Identity, footer); masuk, consent, assessment, beranda, rencana, check-in, progres memakai kartu/badge/tombol/stepper Stitch; tanpa data mockup palsu.

### Acceptance criteria
- [ ] `/c/drmetz` memuat hero, "3 langkah", kartu program dari DB (harga/"Segera hadir"), FAQ; lolos smoke lama (stepper, CTA assessment, "Sovia adalah AI", "bukan diagnosis")
- [ ] Tidak ada nama dokter/angka contoh dari mockup di HTML
- [ ] Lebar 390 tanpa elemen melebar keluar layar (audit Playwright)

---

## Phase 6: Workspace dokter ala Stitch
**Jenis**: ui
**User stories**: 13, 14, 15, 16

### What to build
Console antrean (kartu/tabel Stitch, badge status, kode voucher) dan detail pasien 2 kolom: kiri ringkasan (identitas, consent, assessment, riwayat konsultasi, foto bila consent); kanan blok SOAP S/O/A/P berhuruf + resep + rencana; catatan SOAP ditandai "Hanya tim klinis" (indigo), rencana bertanda tangan ditandai "Terlihat pasien" (border cyan + ikon mata).

### Acceptance criteria
- [ ] Detail pasien menampilkan blok S, O, A, P berlabel dan penanda "Hanya tim klinis" pada SOAP
- [ ] Rencana bertanda tangan bertanda "Terlihat pasien"
- [ ] Alur lama (simpan SOAP, terbitkan resep, tandatangani rencana) tetap lulus test + smoke
- [ ] Lebar 1280 2 kolom; 390 satu kolom tanpa overflow
