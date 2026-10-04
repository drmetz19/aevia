# Brief — AEVIA Platform (v0)

**Tujuan:** Bangun AEVIA, platform healthy aging lintas klinik: Assessment → Pilih klinik → Konsultasi → Personal Plan (disetujui profesional) → Follow-up/Check-in → Progress. DrMetz = provider pertama ("DrMetz · powered by AEVIA").
**Aktor:** Pengguna/pasien · Profesional (dokter/konsultan) · Admin klinik · Admin AEVIA · Sovia (AI guide, bukan pengambil keputusan klinis).
**Stack:** Node.js + TypeScript. Wajib siap terhubung ke ekosistem lain via REST API + MCP server.
**Konteks:** Brand Strategy, Verbal Identity 3.0, Brand Identity System v1.0 (PDF), Master Blueprint v0.1, karakter Sovia, 6 screenshot referensi (DrMetz Care: form konsultasi, landing, skin analysis, program acne, slimming, konsultasi SOAP).
**Batasan:** AI guides, professionals decide — Sovia tidak diagnosis/resep/ubah dosis. Brand klinik tampil utama. Hasil assessment bukan diagnosis. Bahasa ikut Verbal Identity (tanpa "permanen/garansi/wajib/gagal"). Data medis punya batas izin sendiri.
**Output:** Monorepo TS (API + MCP + web pasien + konsol klinik), PRD, plan fase tracer-bullet, test + smoke per fase.
**Asumsi awal (perlu dikunci):** multi-tenant sejak awal; Postgres; mode hemat token.
