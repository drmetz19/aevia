# AEVIA

**Guidance for Better Aging.** AEVIA adalah platform pendampingan healthy aging untuk klinik: pasien menjalani assessment bersama asisten AI (Sovia), menyiapkan konsultasi, menerima rencana pendampingan yang ditandatangani profesional, lalu memantau progres lewat check-in. Prinsipnya: **AI guides. Professionals decide.** AI tidak mendiagnosis, tidak meresepkan, dan tidak pernah menulis catatan klinis, resep, atau rencana.

Satu platform, banyak klinik (multi-tenant): setiap klinik punya halaman sendiri (`/c/:slug`), merek (co-brand atau white-label), asisten bernama sendiri, program, dan staf. Isolasi data memakai Postgres Row-Level Security.

## Isi repo

| Path | Fungsi |
| --- | --- |
| `apps/web` | Web pasien per klinik (Next.js): landing, masuk OTP, consent, assessment Sovia, program, konsultasi, rencana, check-in, progres |
| `apps/console` | Konsol staf (Next.js): antrean, detail pasien, SOAP, analisis kulit, resep, rencana, pengaturan klinik, integrasi; admin platform |
| `apps/api` | REST API (Fastify + Zod), OpenAPI 3.1 di `/v1/openapi.json`, docs di `/docs`, webhook dispatcher |
| `apps/mcp` | Server MCP (stdio + Streamable HTTP) untuk asisten AI: 6 tool terbatas, lewat REST integrasi |
| `packages/core` | Domain murni: assessment, guardrail, prompt LLM, skema Zod, kontras warna |
| `packages/db` | Drizzle + migrasi SQL (PGlite dev/test, Postgres produksi), RLS, seed |
| `packages/ui` | Token desain, Tailwind, font self-hosted |
| `docs/` | `integrasi/` (API publik, webhook, KlinikSistem, BeautyCode), `deploy.md`, `brand/` |
| `plans/` | PRD, rencana fase, keputusan desain |

## Mulai cepat

Prasyarat: Node 22, pnpm 10.

```bash
pnpm install
pnpm db:seed        # database lokal (PGlite di .data/pglite) + klinik demo
pnpm dev            # web :3000, console :3001, api :4000
```

Salin `.env.example` ke `.env` bila perlu mengubah pengaturan; semua opsional untuk dev. Tanpa `DATABASE_URL`, API memakai PGlite lokal dan kode OTP **tampil di log API** (`[OTP] … kode=123456`).

Untuk Postgres sungguhan: isi `DATABASE_URL` lalu `pnpm db:migrate` (lihat [docs/deploy.md](docs/deploy.md)).

### Akun demo (hasil `db:seed`)

| Peran | Email | Masuk di |
| --- | --- | --- |
| Profesional DrMetz | `dr.metz@drmetz.test` | console `/masuk` |
| Admin klinik DrMetz | `admin@drmetz.test` | console `/masuk` |
| Admin klinik Lumina (white-label) | `admin@demo-partner.test` | console `/masuk` |
| Admin platform AEVIA | `admin@aevia.test` | console `/masuk` |
| Pasien | email apa saja | `http://localhost:3000/c/drmetz/masuk` (co-brand) atau `/c/demo-partner/masuk` (white-label) |

Login memakai OTP 6 angka; ambil kodenya dari log API.

### Alur demo cepat

1. Pasien: buka `/c/drmetz/masuk`, masuk, setujui consent, jalankan assessment, pilih program, kirim permintaan konsultasi.
2. Profesional: console → Antrean → terima dan jadwalkan; isi SOAP, analisis kulit, resep, lalu tandatangani rencana.
3. Pasien: lihat rencana dan penjelasan Sovia, kirim check-in, lihat progres.
4. Admin klinik: Pengaturan → merek, program, staf, integrasi.

## Test

```bash
pnpm typecheck          # semua paket
pnpm test               # core, db, api, mcp (Vitest, PGlite in-memory)
pnpm build              # web + console (Next) dan paket lain
pnpm smoke              # build produksi + start web/console/API, pemeriksaan HTML/API end-to-end
AEVIA_TEST_PG_URL=postgres://owner:pw@localhost:5432/postgres pnpm test   # sama, terhadap Postgres sungguhan
```

## Sovia: skrip dan mode LLM

Default Sovia memakai skrip deterministik. Admin klinik dapat menyalakan mode LLM (Claude) bila platform memiliki `ANTHROPIC_API_KEY`; model dari `ANTHROPIC_MODEL`. LLM hanya merapikan bahasa konteks persiapan konsultasi dan penjelasan rencana. Setiap keluaran melewati guardrail (kata terlarang, klaim diagnosis); bila bermasalah, kosong, atau lambat, sistem memakai teks skrip tanpa galat ke pasien. Pemakaian tercatat di `llm_calls` dan terlihat di konsol.

## Integrasi

- API publik, kunci API, OAuth client-credentials, webhook bertanda tangan: [docs/integrasi/README.md](docs/integrasi/README.md)
- KlinikSistem: [docs/integrasi/kliniksistem.md](docs/integrasi/kliniksistem.md)
- BeautyCode: [docs/integrasi/beautycode.md](docs/integrasi/beautycode.md)
- MCP (Claude Desktop / Claude Code): [apps/mcp/README.md](apps/mcp/README.md)
- Deploy Supabase + Vercel: [docs/deploy.md](docs/deploy.md)

## Prinsip yang dijaga kode

- Setiap penulisan klinis diaudit (append-only); resep terbit dan rencana bertanda tangan tidak dapat diubah (trigger DB).
- Data klinis hanya terbaca bila pasien memberi consent yang relevan; pencabutan berlaku seketika.
- Bahasa produk mengikuti Verbal Identity (tenang, jelas, tanpa klaim hasil); white-label tidak menampilkan "AEVIA" kecuali di syarat dan ketentuan.
