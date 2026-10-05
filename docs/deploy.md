# Deploy: Supabase + Vercel

Panduan langkah demi langkah. Web dan console sudah ter-deploy di Vercel. Project API dibangun dengan `pnpm --filter @aevia/api build:vercel` (esbuild → Build Output API v3 di `apps/api/.vercel/output`), karena runtime Vercel tidak bisa memuat paket workspace `@aevia/*` yang berupa TypeScript mentah. PGlite diganti stub di bundel produksi.

Arsitektur: 4 project Vercel dari satu repo (root directory berbeda) + 1 project Supabase.

| Project Vercel | Root Directory | Isi |
| --- | --- | --- |
| `aevia-api` | `apps/api` | REST API + OpenAPI (`/docs`) + Cron dispatcher |
| `aevia-web` | `apps/web` | Web pasien per klinik (`/c/:slug`), domain klinik |
| `aevia-console` | `apps/console` | Konsol staf klinik dan admin platform |
| `aevia-mcp` | `apps/mcp` | Server MCP Streamable HTTP (`/mcp`), opsional |

## 1. Supabase

1. Buat project. Catat **Database password**.
2. Ambil connection string (Project Settings → Database):
   - **Migrasi dan seed**: koneksi langsung (`:5432`) atau Session pooler.
   - **Runtime API (Vercel)**: Transaction pooler (`:6543`). Aman untuk AEVIA karena `SET LOCAL ROLE` dan `set_config(…, true)` hanya berlaku di dalam transaksi.
   - Tambahkan `?sslmode=require` pada URL.
3. **Role aplikasi `aevia_app`.** Migrasi 0001 membuatnya otomatis (`CREATE ROLE aevia_app NOLOGIN NOSUPERUSER NOBYPASSRLS` lalu `GRANT aevia_app TO CURRENT_USER`). Syarat: role yang dipakai di `DATABASE_URL` (di Supabase biasanya `postgres`) boleh `CREATE ROLE`. Bila ditolak, buat manual sekali dari SQL Editor lalu jalankan ulang migrasi:
   ```sql
   CREATE ROLE aevia_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
   GRANT aevia_app TO postgres;
   ```
   `aevia_app` **harus bukan superuser dan tanpa BYPASSRLS**; itulah yang membuat isolasi antarklinik (RLS) berlaku. Jangan pernah mengisi `DATABASE_URL` dengan role superuser untuk runtime.
4. Migrasi (dari mesin Anda atau CI):
   ```bash
   DATABASE_URL='postgres://postgres:…@db.xxxx.supabase.co:5432/postgres?sslmode=require' pnpm db:migrate
   ```
   Idempoten dan tercatat di tabel `_migrations`. Jangan menjalankan dua migrasi bersamaan. Migrasi 0013 otomatis mencabut hak role `anon`/`authenticated` (PostgREST) dari semua tabel; API AEVIA tidak memakai PostgREST.
5. Data demo hanya untuk staging: `DATABASE_URL=… pnpm db:seed`. **Jangan seed di produksi.** Buat klinik pertama lewat admin platform; admin platform pertama dimasukkan manual:
   ```sql
   INSERT INTO platform_admins (email, name) VALUES ('anda@perusahaan.id', 'Nama Anda');
   ```
6. **Storage**: buat bucket **privat** `skin-photos` (jangan public). API memakai service role key dan membuat URL bertanda tangan; foto klinis tidak pernah dilayani publik.

## 2. Vercel

Untuk tiap project: Import repo, set **Root Directory** sesuai tabel, dan biarkan `vercel.json` di folder itu menentukan install/build. Aktifkan "Include source files outside of the Root Directory" (workspace `packages/*` dipakai bersama).

### Matriks environment

| Variabel | api | web | console | mcp | Keterangan |
| --- | :-: | :-: | :-: | :-: | --- |
| `DATABASE_URL` | ✔ | | | | Transaction pooler Supabase, `?sslmode=require` |
| `JWT_SECRET` | ✔ | | | | Min. 32 karakter acak (`openssl rand -base64 48`). Produksi menolak nilai bawaan |
| `ENCRYPTION_KEY` | ✔ | | | | 32 byte: `openssl rand -hex 32`. Mengenkripsi rahasia webhook/konektor. **Jangan hilang atau diganti** tanpa memutar semua rahasia |
| `CRON_SECRET` | ✔ | | | | Vercel Cron mengirimnya sebagai `Authorization: Bearer`. `/v1/internal/dispatch` menjawab 503 bila kosong |
| `ANTHROPIC_API_KEY` | ✔ | | | | Opsional. Tanpa ini mode LLM tidak dapat dinyalakan klinik; Sovia memakai skrip |
| `ANTHROPIC_MODEL` | ✔ | | | | Opsional. Default `claude-sonnet-5-5` |
| `STORAGE_DRIVER` | ✔ | | | | `supabase` di produksi (`local` hanya dev) |
| `SUPABASE_URL` | ✔ | | | | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | | | | Rahasia server; jangan di klien |
| `SUPABASE_BUCKET` | ✔ | | | | Default `skin-photos` |
| `MAILKETING_API_TOKEN` | ✔ | | | | Pengirim email OTP (diutamakan). Token dari menu Integrasi Mailketing. **Produksi wajib salah satu: Mailketing atau Resend** |
| `RESEND_API_KEY` | | | | | Alternatif bila tidak memakai Mailketing |
| `OTP_FROM_EMAIL` | ✔ | | | | Mis. `Klinik Anda <masuk@domain.id>`; email harus terdaftar di menu Add Domain Mailketing (atau terverifikasi di Resend) |
| `API_URL` | | ✔ | ✔ | | URL API dari server Next.js (mis. `https://api.domain.id`) |
| `API_PUBLIC_URL` | | | ✔ | | URL API yang dapat dijangkau browser (foto di konsol) |
| `PLATFORM_HOSTS` | | ✔ | | | Host platform yang bukan domain klinik, mis. `app.domain.id` |
| `AEVIA_API_URL` | | | | ✔ | URL API untuk server MCP |

Catatan:
- `DATABASE_URL` dan rahasia lain jangan di-commit. `.env.example` hanya contoh.
- Rahasia web/console tidak butuh `JWT_SECRET`: token sesi dipegang cookie httpOnly (`sid_<slug>` web, `ssid` konsol) dan diverifikasi API.

### Cron dispatcher

`apps/api/vercel.json` mendaftarkan `GET /v1/internal/dispatch` tiap menit. Vercel mengirim `Authorization: Bearer $CRON_SECRET` otomatis bila `CRON_SECRET` diatur. Cron tiap menit membutuhkan plan Pro; di Hobby hanya harian, sehingga retry webhook/konektor (1 dan 5 menit) tidak akan tepat waktu. Alternatif: jalankan `pnpm --filter @aevia/api dispatch -- --watch` di server mana pun yang punya `DATABASE_URL`, atau panggil endpoint dari penjadwal luar.

### Domain klinik

Tambahkan domain klinik ke project `aevia-web` di Vercel (Domains). Admin klinik mengisi domain di Pengaturan → Merek; admin platform memverifikasinya (Admin → Klinik). Setelah itu `proxy.ts` memetakan host ke `/c/:slug`.

### API sebagai Vercel Function

`apps/api/src/vercel.ts` membungkus Fastify (satu app per instance, tanpa migrasi saat start). Saat build, `scripts/build-vercel.mjs` membundelnya dengan esbuild ke `.vercel/output` (Build Output API v3); semua path diarahkan ke fungsi itu. Cron tetap didefinisikan di `vercel.json`.

## 3. Urutan deploy pertama

1. Supabase: bucket, `pnpm db:migrate`, platform admin pertama.
2. Vercel `aevia-api` dengan semua variabel di atas. Cek `GET /health` dan `/docs`.
3. `aevia-web` dan `aevia-console` dengan `API_URL`.
4. Admin platform masuk di konsol (OTP via email), membuat klinik pertama.
5. Uji alur: pasien masuk → assessment → permintaan konsultasi → staf menerima.
6. (Opsional) `aevia-mcp`.

## 4. Pemeriksaan keamanan sebelum rilis

- [ ] `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` acak dan berbeda; tersimpan hanya di Vercel.
- [ ] Bucket `skin-photos` privat; `STORAGE_DRIVER=supabase`.
- [ ] `aevia_app` bukan superuser dan tanpa BYPASSRLS (`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='aevia_app'` → `f, f`).
- [ ] Role `anon`/`authenticated` tidak punya hak pada tabel publik (migrasi 0013).
- [ ] Email OTP terkirim dari domain terverifikasi; tidak ada kode OTP di log produksi.
- [ ] Data seed demo tidak ada di database produksi.

## 5. Menjalankan test terhadap Postgres sungguhan

```bash
AEVIA_TEST_PG_URL=postgres://owner:pw@localhost:5432/postgres pnpm test
```

Setiap test membuat database sementara (role pemilik butuh `CREATEDB`) dan menghapusnya setelahnya. Aktif hanya bila variabel itu diisi; default test memakai PGlite.
