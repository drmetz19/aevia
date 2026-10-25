# PRD — Redesain "Aevia Konsult" (Stitch) + akses program via voucher

## Problem Statement
Tampilan web pasien dan console belum mengikuti desain Stitch yang sudah disetujui ("Aevia Konsult · Clinical Sanctuary"): warna, tipografi, logo, dan tata letak intake/konsultasi/workspace dokter berbeda. Klinik juga belum punya cara mengatur harga program saat tarif belum final, dan belum ada mekanisme pengganti pembayaran untuk uji coba.

## Solution
Seluruh tampilan memakai sistem desain Stitch (token, komponen, logo Aevia Konsult) dengan layout acuan untuk landing, program, intake konsultasi, dan workspace dokter. Klinik dapat menampilkan harga program sebagai "Segera hadir" dan mewajibkan kode voucher untuk mengakses program; admin klinik membuat dan mengelola voucher di console.

## User Stories
1. As a pasien, I want halaman klinik bergaya Aevia Konsult (teal klinis, kartu bersih, logo baru), so that layanan terasa profesional dan konsisten.
2. As a pasien, I want melihat badge "powered by Aevia Konsult" pada klinik cobrand, so that saya tahu platform di baliknya.
3. As a pasien klinik whitelabel, I want tidak melihat nama Aevia di UI (kecuali syarat & ketentuan), so that merek klinik tetap utuh.
4. As a pasien, I want katalog program berbentuk kartu harga ala Stitch, so that saya mudah membandingkan program.
5. As a pasien, I want melihat "Segera hadir" alih-alih angka bila klinik belum menetapkan harga, so that saya tidak salah paham soal tarif.
6. As a pasien, I want memasukkan kode voucher saat mengajukan konsultasi untuk program yang memerlukannya, so that saya bisa ikut program tanpa pembayaran.
7. As a pasien, I want pesan yang jelas bila kode salah, kedaluwarsa, habis kuota, bukan untuk program ini, atau sudah saya pakai, so that saya tahu langkah berikutnya.
8. As a pasien, I want form konsultasi berbentuk intake 2 kolom (stepper langkah, isian di kiri, ringkasan program & klinik di kanan), so that prosesnya jelas.
9. As a pasien, I want beranda, consent, assessment, rencana, check-in, dan progres memakai komponen yang sama (kartu, badge status, tombol 8px), so that pengalaman konsisten di HP.
10. As a admin klinik, I want mengatur per program: tampilan harga (angka / Segera hadir) dan akses (terbuka / perlu voucher), so that saya bisa uji coba sebelum tarif final.
11. As a admin klinik, I want membuat voucher (kode, program tertentu atau semua, kuota opsional, kedaluwarsa opsional, aktif/nonaktif), so that saya mengendalikan siapa yang ikut.
12. As a admin klinik, I want melihat jumlah pemakaian tiap voucher dan menonaktifkannya, so that saya bisa menghentikan kode yang bocor.
13. As a profesional, I want antrean & detail permintaan menampilkan kode voucher yang dipakai, so that saya tahu jalur akses pasien.
14. As a profesional, I want workspace pasien bergaya Stitch: kolom kiri ringkasan pasien (assessment, consent, riwayat), kolom kanan blok SOAP S/O/A/P berlabel dan rencana, so that dokumentasi cepat dipindai.
15. As a profesional, I want penanda jelas antara catatan internal (indigo, "Hanya tim klinis") dan konten yang terlihat pasien (rencana bertanda tangan), so that tidak ada kebocoran tak sengaja.
16. As a staf, I want console (sidebar, antrean, pengaturan) memakai token & komponen yang sama, so that klinik melihat satu produk utuh.
17. As a sistem, I want pemakaian voucher atomik (kuota tidak terlampaui saat dua pasien menukar bersamaan) dan tercatat di audit, so that data tetap benar.

## Implementation Decisions
- **Token desain** diganti ke Stitch varian 1: navy slate #0F172A (teks/judul), deep cyan #0E7490 (primer: tombol, link, aktif), diagnostic cyan #06B6D4 (aksen grafis saja), sage #10B981 / stable #047857 (sukses), kanvas #F8FAFC, kartu #FFFFFF border #E2E8F0, teks sekunder #475569, status warning #B45309/#FEF3C7, emergency #BE123C/#FFE4E6, internal #4338CA/#EEF2FF. Font Plus Jakarta Sans (heading & UI) + mono untuk kode/ID. Radius 8 (tombol/input/chip) · 16 (kartu) · pill hanya badge. Tanpa bayangan pada kartu diam; bayangan halus hanya hover/popover.
- **Nama token Tailwind tetap** (navy, copper, ivory, sand, slate, body, …) tetapi dipetakan ulang ke nilai Stitch lewat `--brand-*`, supaya whitelabel per klinik tetap berfungsi; judul berhenti memakai serif.
- **Logo Aevia Konsult** (SVG dari ekspor Stitch) menggantikan monogram AEVIA di badge "powered by" dan console; whitelabel tetap tanpa Aevia.
- **Program**: kolom baru `price_mode` (`amount` | `coming_soon`, default `amount`) dan `access` (`open` | `voucher`, default `open`). API publik mengembalikan keduanya; harga disembunyikan bila `coming_soon`.
- **Voucher**: tabel `vouchers` (klinik, kode unik per klinik disimpan huruf besar, program opsional = semua program, kuota opsional, kedaluwarsa opsional, aktif, jumlah terpakai) dan `voucher_redemptions` (voucher, pasien, permintaan, waktu; unik per voucher+pasien). RLS per klinik seperti tabel lain.
- **Penukaran** terjadi saat pasien mengirim permintaan konsultasi: `POST` permintaan menerima `voucher_code` opsional; wajib bila program `access=voucher`. Validasi + penambahan pemakaian + catat penukaran dalam satu transaksi dengan pembuatan permintaan (kunci baris voucher). Kode valid untuk program terbuka tetap dicatat.
- **Kode galat voucher** (pesan Bahasa Indonesia sesuai Verbal Identity): `voucher_required`, `voucher_invalid`, `voucher_expired`, `voucher_exhausted`, `voucher_not_for_program`, `voucher_already_used`.
- **Console**: Pengaturan → Program menambah pilihan tampilan harga & akses; menu baru Pengaturan → Voucher (daftar, buat, nonaktifkan, jumlah terpakai). Hanya `clinic_admin`. Antrean & detail permintaan menampilkan kode voucher.
- **Layout acuan**: landing (hero + 3 langkah + kartu program + FAQ singkat dari data yang ada), program (kartu harga), konsultasi (intake 2 kolom + stepper "Assessment → Pilih program → Kirim permintaan"), workspace dokter (2 kolom, blok S/O/A/P, tab internal vs pasien bila relevan), shell console (sidebar slate + top bar). Halaman lain mengikuti komponen bersama.
- **Seed demo**: program DrMetz contoh diset `coming_soon` + `voucher`, dengan voucher demo; produksi diatur lewat console/SQL terpisah.

## Out of Scope
Pembayaran sungguhan; video call bawaan; integrasi MoreMe/analisis spektral; metrik biometrik Beauty Code palsu; skrining keselamatan/kontraindikasi (konten klinis menunggu dr. Metz); mode gelap; pemisahan catatan internal vs ringkasan pasien di model data (hanya penanda visual pada data yang sudah ada); generator voucher massal/ekspor CSV.

## Further Notes
- Rekomendasi yang dikunci tanpa perubahan ("setuju semua"): nama/logo Aevia Konsult; nama klinik dari data; palet Stitch default + whitelabel menimpa; cakupan semua layar via token + 4 layout acuan; voucher dibuat admin klinik dengan program/kuota/kedaluwarsa opsional, satu pasien satu kali per kode; harga "Segera hadir" + akses voucher per program; skrining keselamatan ditunda.
- Mengganti keputusan desain lama (navy/copper/serif, "teal tidak dipakai") atas permintaan eksplisit pemilik produk 2026-10-25.
- Verbal Identity tetap berlaku pada semua copy baru (tanpa "wajib/gagal/garansi/instan"; pesan voucher tenang dan memberi langkah).

## Changelog
- 2026-10-25 · Phase 1 · Util baru `bg-action` (`--brand-primary-action`, default #0E7490) untuk tombol primer; whitelabel menimpanya dengan `--brand-primary` klinik — alasan: tombol whitelabel tetap berwarna klinik. Toggle mati #94A3B8 — alasan: kontras ≥3:1 (WCAG 1.4.11).
- 2026-10-25 · Phase 3 · Hapus program yang masih dirujuk voucher ditolak 409 `program_has_vouchers`; voucher dengan program klinik lain → 404; kedaluwarsa di form dibaca sebagai akhir hari WIB; Nonaktifkan voucher memakai konfirmasi, Aktifkan tanpa — alasan: integritas FK tanpa cascade, isolasi tenant, dan zona waktu klinik.
- 2026-10-25 · Phase 4 · Permintaan lewat API integrasi (sistem klinik) tidak diwajibkan voucher (`enforce:false`); galat required/invalid/expired/not_for_program = 400, exhausted/already_used = 409; isian & galat form konsultasi dipulihkan lewat state form (useActionState), bukan URL — alasan: sistem klinik adalah pihak tepercaya, dan data kesehatan tidak boleh masuk URL.
- 2026-10-25 · Phase 5 · Landing memakai alur 4 langkah (Assessment, Konsultasi, Rencana personal, Follow-up & progres), bukan "3 langkah" mockup; panel gelap `hero-atmos` tetap di beranda/rencana/hasil — alasan: mencerminkan alur produk sebenarnya dan copy yang dijaga smoke test.
