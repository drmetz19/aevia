# Desain terkunci — AEVIA
Sumber: PDF AEVIA Brand Identity System v1.0 + `design/ref/*.png` (screenshot = acuan ALUR & LAYOUT saja; warna teal & klaim di dalamnya TIDAK dipakai).
## Token (default brand mode cobrand; whitelabel menimpa --brand-* dari data klinik)
- Warna: navy #0B1F3A (primer: teks, tombol, nav) · copper #C9825A (aksen: CTA highlight, ikon aktif, tagline; JANGAN untuk body text di latar terang) · deep navy #071426 (hero/latar gelap) · ivory #F7F4EF (latar halaman) · sand #E9DDD2 (divider, kartu lembut, bubble Sovia) · slate #697386 (teks sekunder, hanya caption/large di ivory) · putih #FFFFFF (kartu). Rasio 60 navy/ivory · 30 sand · 10 copper.
- Teks copper di latar terang (eyebrow, link aksen) pakai `copper-ink` = copper digelapkan sampai kontras ≥4.5:1 di ivory/putih; copper murni hanya di latar navy, ikon, garis, tombol ≥18px.
- Teks body di ivory: `body` #3A4A5E (AA). Slate hanya caption di putih.
- Status: sukses #2F6B4F, perhatian #A86B1E, kritis #9A3B30 (pakai teks + ikon, bukan warna saja).
- Font: heading/kutipan DM Serif Display 400; UI & body Manrope 400/500/600. Skala: H1 48/56 serif · H2 28/36 600 · H3 20/28 600 · body 16/26 · caption 13/18 500 · eyebrow 11 uppercase tracking .12em copper.
- Radius 10 / 20 / 36 (pill tombol & badge) · border 1px #E6DCCF · shadow lembut 0 1px 2px rgba(11,31,58,.06), 0 8px 24px rgba(11,31,58,.06). Spacing kelipatan 4, gutter mobile 16.
## Komponen
- Tombol: pill; primer navy/teks putih; aksen copper/teks putih (hanya ≥16px 600); sekunder outline. Sentence case, kata kerja di depan ("Mulai assessment", "Lihat rencana", "Siapkan konsultasi").
- Kartu: putih, radius 20, border tipis, padding 20–24. Eyebrow copper di atas judul.
- Trust badge: pill outline + dot copper ("Verified Clinic", "Reviewed by Professional", "Professional Plan").
- Progress card: angka besar serif, delta copper "+24% sejak check-in terakhir", sparkline copper, baris Current/Previous/Target.
- Journey stepper: ① Assessment ② Konsultasi ③ Rencana personal ④ Follow-up & progres (status: selesai/menunggu tinjauan).
- Percakapan Sovia: bubble Sovia sand kiri + avatar `design/ref/sovia-avatar.png`; bubble pasien navy kanan teks putih; header "Sovia · AI Guide by AEVIA" + label "Sovia adalah AI".
- Header pasien: logo klinik + nama klinik utama; cobrand → "powered by AEVIA" kecil slate + monogram; whitelabel → tanpa AEVIA.
- Console: sidebar navy kiri (desktop), konten ivory, tabel/kartu putih; layout 2 kolom seperti `console-soap.png`.
- Ikon: garis tunggal 1.5px, sudut membulat, tanpa isi (lucide-react).
## Layar acuan
| Layar | Acuan | Fase |
|---|---|---|
| Landing klinik | design/ref/landing.png (+ brand-visual-system.png hero navy) | 1 |
| Assessment Sovia | design/ref/sovia-ai.png (chat + stepper) | 3 |
| Form/prep konsultasi | design/ref/form-konsultasi.png, program-acne.png | 4 |
| Console SOAP & skin | design/ref/console-soap.png, skin-analysis.png | 5–6 |
| Program/katalog | design/ref/program-slimming.png (kartu paket) | 4, 8 |
## Aturan
- Mobile-first (390) + desktop (1280); kontras WCAG AA; alt text; fokus keyboard terlihat (ring copper 2px).
- Jangan menambah warna/font di luar token. Gambar belum ada → blok warna solid token.
- Copy wajib lolos Verbal Identity: tanpa "wajib, gagal, permanen, garansi, instan, miracle, bahaya, rusak"; hasil assessment selalu "bukan diagnosis".
