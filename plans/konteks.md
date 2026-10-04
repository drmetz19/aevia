# Konteks codebase — AEVIA
- Stack: Node 22, TypeScript strict, pnpm workspaces + Turborepo. API Fastify 5 + Zod (+ fastify-type-provider-zod, OpenAPI). DB Drizzle ORM; prod `pg` (Supabase), dev/test PGlite (@electric-sql/pglite) dgn migrasi SQL sama. Web & console Next.js (App Router) + Tailwind. MCP @modelcontextprotocol/sdk. Test Vitest (unit/integrasi) + Playwright (smoke UI).
- Struktur: apps/{api,web,console,mcp} · packages/{core,db,ui} · plans/ · design/ref/ (screenshot acuan) · docs/
- Perintah (root): dev `pnpm dev` · build `pnpm build` · typecheck `pnpm typecheck` · test `pnpm test` · smoke `pnpm smoke` · seed `pnpm db:seed`
- Env: `.env.example` di root (DATABASE_URL kosong → PGlite di `.data/pglite`; JWT_SECRET; ANTHROPIC_API_KEY opsional; STORAGE_DRIVER=local|supabase).
- Konvensi: domain & schema Zod di packages/core (dipakai api, web, console, mcp); semua akses DB lewat helper `withTenant(clinicId, fn)` (transaksi + SET LOCAL ROLE aevia_app + set_config). Service layer di api/src/modules/<modul>/ (routes.ts, service.ts, *.test.ts). Penulisan klinis → audit. Copy UI Bahasa Indonesia sesuai Verbal Identity.
- Test: vitest di tiap paket (`*.test.ts` di samping kode); test API pakai `app.inject` + PGlite in-memory baru per file. Playwright di apps/web/e2e & apps/console/e2e.
- Desain: plans/desain-terkunci.md (token di packages/ui/tokens.css + tailwind preset)
- Scripts Super Dev: /root/.claude/plugins/synced/2dc58d5f-aef4-453c-8200-95048c7d7e54_2e680570-e628-4664-86d1-9e94bcec4edc/super-dev/skills/super-dev/scripts
