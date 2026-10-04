# @aevia/mcp — server MCP untuk AEVIA

Server [Model Context Protocol](https://modelcontextprotocol.io) agar asisten AI (Claude Desktop, Claude Code, dll.) dapat membaca ringkasan pendampingan dan melakukan dua aksi terbatas untuk **klinik Anda**.

**Zero akses DB.** Server ini hanya memanggil REST integrasi AEVIA lewat HTTP (`/v1/integrations/*`) dengan kunci API klinik. Karena itu semua aturan API berlaku apa adanya: cakupan (scope), persetujuan pasien, isolasi klinik, batas permintaan, dan audit. Setiap panggilan mengirim `X-Aevia-Actor: mcp`, sehingga audit klinik mencatat `actor_type=mcp` dengan penanda `mcp:<prefix kunci>`.

## Tool (tepat 6)

| Tool | Cakupan kunci | Keterangan |
| --- | --- | --- |
| `get_patient_summary` | `read:patients` | Persetujuan, jumlah permintaan konsultasi; bagian klinis hanya bila pasien menyetujui akses rekam medis. Tanpa nama/email. |
| `list_checkins` | `read:progress` | Check-in terbaru (butuh persetujuan rekam medis). |
| `get_progress` | `read:progress` | Progres terhitung per metrik (butuh persetujuan). |
| `get_care_plan` | `read:plans` | Rencana yang **sudah ditandatangani** (hanya baca; butuh persetujuan). |
| `send_checkin_reminder` | `write:reminders` | Pengingat check-in dengan teks baku. |
| `create_consultation_request` | `write:consultation_requests` | Mengajukan permintaan konsultasi; klinik tetap meninjau. |

Tidak ada tool untuk SOAP, resep, atau membuat/menandatangani rencana: itu hanya dapat dilakukan profesional klinik. Hasil tool berupa teks ringkas ditambah `structuredContent`; galat API (mis. `consent_required`, `insufficient_scope`) dikembalikan sebagai hasil `isError` dengan pesan yang jelas.

## Menyiapkan kunci

Konsol AEVIA → **Pengaturan → Integrasi → Kunci API**. Pilih hanya cakupan yang dibutuhkan, salin rahasia `aev_live_…` (tampil sekali). Lihat juga [docs/integrasi/README.md](../../docs/integrasi/README.md).

## Transport 1: stdio (lokal)

Variabel lingkungan: `AEVIA_API_KEY` (wajib), `AEVIA_API_URL` (default `http://localhost:4000`).

Dari repo ini: `AEVIA_API_KEY=aev_live_… pnpm --filter @aevia/mcp start`

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "aevia": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/ke/aevia", "--filter", "@aevia/mcp", "start"],
      "env": {
        "AEVIA_API_URL": "https://api.contoh-klinik.id",
        "AEVIA_API_KEY": "aev_live_…"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add aevia \
  --env AEVIA_API_URL=https://api.contoh-klinik.id \
  --env AEVIA_API_KEY=aev_live_… \
  -- pnpm --silent --dir /path/ke/aevia --filter @aevia/mcp start
```

## Transport 2: Streamable HTTP

Endpoint `POST /mcp` (tanpa sesi, cocok untuk serverless). Kunci API dikirim pada setiap permintaan lewat `Authorization: Bearer aev_live_…` dan diteruskan apa adanya ke API; server tidak menyimpan kunci. Tanpa header → `401`.

- Lokal: `AEVIA_API_URL=http://localhost:4000 pnpm --filter @aevia/mcp start:http` → `http://localhost:4100/mcp` (port: `MCP_PORT`).
- Vercel: deploy `apps/mcp` sebagai project (Root Directory `apps/mcp`); `api/mcp.ts` adalah Function dan `vercel.json` memetakan `/mcp` ke sana. Set env `AEVIA_API_URL`.

### Claude Code (HTTP)

```bash
claude mcp add --transport http aevia https://mcp.contoh-klinik.id/mcp \
  --header "Authorization: Bearer aev_live_…"
```

### Klien lain (`.mcp.json`)

```json
{
  "mcpServers": {
    "aevia": {
      "type": "http",
      "url": "https://mcp.contoh-klinik.id/mcp",
      "headers": { "Authorization": "Bearer aev_live_…" }
    }
  }
}
```

## Keamanan

- Gunakan kunci khusus MCP dengan cakupan minimal; cabut dari konsol bila tidak dipakai (berlaku seketika).
- Data klinis pasien hanya terbaca bila pasien menyetujui akses rekam medis; pencabutan berlaku seketika.
- Batas permintaan per kunci berlaku (`429` dengan `Retry-After`).

## Pengujian

`pnpm --filter @aevia/mcp test` menjalankan klien MCP in-memory dan Streamable HTTP terhadap API sungguhan (PGlite): tepat 6 tool, isolasi klinik, consent, dan audit `actor=mcp`.
