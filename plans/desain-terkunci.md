# Desain terkunci — Aevia Konsult (Clinical Sanctuary)
Sumber: `design/stitch/` (ekspor Stitch: DESIGN.md varian 1, `aevia-konsult-logo.svg`, layar *.html + *.png). Mengganti desain navy/copper/serif (2026-10-25, permintaan pemilik produk). `design/ref/` lama hanya acuan ALUR.
## Token (default cobrand; whitelabel tetap menimpa --brand-* dari data klinik)
- Nama util Tailwind lama DIPERTAHANKAN, nilainya dipetakan ulang: `navy` → #0F172A (teks/judul) · `copper` → #0E7490 deep cyan (primer: tombol, link, aktif, fokus) · `copper-ink` → #0E7490 · `deep` → #0F172A (panel gelap) · `ivory` → #F8FAFC (kanvas) · `sand` → #F1F5F9 (latar lembut/chip) · `slate` → #64748B (caption) · `body` → #475569 (teks sekunder) · border #E2E8F0, border kuat #CBD5E1 · aksen grafis #06B6D4 (cyan, hanya ikon/garis/grafik) · sukses #047857 on #D1FAE5 · perhatian #B45309 on #FEF3C7 · kritis #BE123C on #FFE4E6 · internal #4338CA on #EEF2FF border #C7D2FE.
- Tombol primer pakai `--brand-primary-action` = #0E7490 (hover #0C4A6E); `bg-navy` tetap boleh untuk tombol gelap sekunder.
- Font: Plus Jakarta Sans (semua heading & UI; 400/500/600/700) · mono `ui-monospace, SFMono-Regular, Menlo` untuk kode/ID/angka klinis (tabular-nums). `font-serif` TIDAK dipakai lagi (variabel diarahkan ke Plus Jakarta Sans 700).
- Skala: display 36/44 700 (mobile 28/36) · H2 28/36 600 (mobile 22/30) · H3 18/26 600 · body 16/24 · body-sm 14/20 · label 12/16 600 · eyebrow 11 uppercase tracking .08em cyan.
- Radius: 8 (tombol, input, chip) · 16 (kartu) · 9999 hanya badge/pill status. Kartu: putih + 1px #E2E8F0, TANPA shadow; hover/aktif: border #CBD5E1 + shadow 0 4px 6px -1px rgba(15,23,42,.05).
- Spacing 8pt; padding kartu 16 (mobile) / 24 (desktop); gutter mobile 16; tinggi tombol/input 44 mobile.
## Komponen
- Tombol: primer cyan #0E7490 teks putih radius 8 · sekunder putih border #E2E8F0 teks #0F172A · bahaya #BE123C. Bukan pill.
- Badge/pill status: 11px 600, padding 2×8, warna semantik di atas + border tipis.
- Logo: `design/stitch/aevia-konsult-logo.svg` (mark lingkaran + teks). Cobrand: header = logo/nama klinik + "powered by" + mark Aevia Konsult kecil; console: logo lengkap di sidebar. Whitelabel: tanpa Aevia.
- Header pasien: putih, border bawah #E2E8F0, nama klinik 600 + subjudul slate; stepper bernomor (lingkaran 24px; selesai = cyan + centang; aktif = ring cyan) untuk alur intake.
- Intake/form 2 kolom (≥1024): kiri isian dalam kartu bernomor-ikon, kanan kartu ringkasan (tim/klinik, cakupan program bercentang, catatan keamanan data); mobile: satu kolom, kartu ringkasan di bawah.
- Kartu program: harga besar 700 atau label "Segera hadir"; daftar fasilitas bercentang sage; kartu unggulan border cyan 2px + badge.
- Console: sidebar putih border kanan (desktop) atau slate #0F172A (pilih satu: PUTIH), item aktif latar #ECFEFF teks cyan; konten kanvas #F8FAFC. Workspace pasien 2 kolom (4/8): kiri ringkasan pasien, kanan blok SOAP berhuruf S/O/A/P (kotak 24px cyan) + label sumber kanan; catatan internal = kartu indigo #EEF2FF + gembok "Hanya tim klinis"; konten terlihat pasien = kartu putih border cyan + ikon mata.
- Banner darurat: #FFE4E6 border 1.5px #BE123C.
- Ikon: lucide-react 1.75px.
## Layar acuan
| Layar | Acuan | Fase |
|---|---|---|
| Fondasi token, header, logo, console shell | master-branding.png, intake-sync.png (header/stepper) | 1 |
| Kartu program + pengaturan program | program.png (bagian "Investasi"), landing.png (kartu harga) | 2 |
| Pengaturan voucher (console) | workspace-dokter.png (gaya kartu/tabel console) | 3 |
| Intake konsultasi + voucher | intake-program.png, form-konsultasi.png | 4 |
| Landing & halaman pasien lain | landing.png | 5 |
| Workspace dokter | workspace-dokter.png | 6 |
## Aturan
- Mobile-first (390) + desktop (1280); kontras WCAG AA; fokus 2px ring #0E7490 offset 2; alt text.
- Jangan menambah warna/font di luar token. Jangan menampilkan fitur/data dari mockup yang tidak ada di produk (video call, MoreMe/spektral, metrik biometrik, SIP/STR, nama dokter contoh) — bagian tanpa data dihilangkan, bukan diisi contoh.
- Copy tetap Verbal Identity (tanpa "wajib, gagal, permanen, garansi, instan, miracle"); hasil assessment selalu "bukan diagnosis"; whitelabel tanpa kata "Aevia" kecuali syarat & ketentuan.
