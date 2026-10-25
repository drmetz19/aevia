# Brief — Redesain Stitch "Aevia Konsult" + akses program via voucher
- **Tujuan:** tampilan web pasien & console mirip ekspor Stitch `stitch_aevia_konsult` (Clinical Sanctuary) sebelum uji coba; ganti "bayar" dengan kode voucher.
- **Aktor:** pasien (web), profesional & admin klinik (console), admin AEVIA.
- **Sudah ada:** tema berbasis token CSS (`packages/ui/tokens.css`, `--brand-*` per klinik untuk whitelabel); Plus Jakarta Sans sudah terpasang; program punya `price_idr`; permintaan konsultasi gratis (tanpa pembayaran).
- **Desain sumber:** DESIGN.md "Clinical Sanctuary" — navy slate #0F172A, deep cyan #0E7490, diagnostic cyan #06B6D4, sage #10B981, kanvas #F8FAFC, kartu putih border #E2E8F0 tanpa bayangan, radius 8 (tombol/input) & 16 (kartu), Plus Jakarta Sans + mono untuk kode; logo lingkaran busur gradien + berlian.
- **Layar acuan:** landing, intake/form konsultasi (2 kolom + stepper + kartu ringkasan), program (kartu harga), workspace dokter (SOAP S/O/A/P + tab catatan internal vs ringkasan pasien).
- **Voucher:** harga program bisa diset "Segera hadir"; pasien tetap bisa mengakses program dengan kode voucher.
- **Batasan:** jangan tampilkan fitur/data palsu dari mockup (video call, MoreMe spektral, metrik biometrik) bila belum ada di produk; Verbal Identity & guardrail tetap; whitelabel tetap tanpa "AEVIA"; WCAG AA; mobile-first.
- **Output:** desain-terkunci baru, PRD + plan fase, kode + tes, deploy setelah lulus.
- **Asumsi:** palet Stitch menggantikan navy/copper sebagai default platform; klinik whitelabel tetap bisa menimpa warna.
