# Lembar Kredensial MCP AEVIA

Lembar ini memisahkan **kredensial** dari [dokumentasi MCP](mcp.md). Dokumentasi boleh dibagikan ke siapa saja; lembar yang **sudah diisi** adalah rahasia klinik.

**Cara pakai**

1. Salin file ini menjadi `mcp.kredensial.md` (atau simpan di password manager klinik). Pola `*.kredensial.md` sudah diabaikan git, jadi salinan berisi tidak ikut ter-commit.
2. Isi kolom **Nilai** di bawah.
3. Jangan kirim lembar yang sudah diisi lewat chat, email, atau tangkapan layar. Bagikan lewat password manager.

> Kunci API tidak dapat dibuat dari dokumen ini atau dari repo. Kunci hanya dibuat oleh admin klinik di konsol, dan rahasianya hanya tampil **sekali** saat dibuat.

## 1. Alamat

| Item | Nilai | Keterangan |
| --- | --- | --- |
| URL API AEVIA (`AEVIA_API_URL`) | `https://` | Alamat project `aevia-api`. Dipakai server MCP, bukan oleh asisten. |
| URL server MCP | `https://…/mcp` | Alamat project `aevia-mcp` + `/mcp`. Dipakai asisten (transport HTTP). |
| Konsol klinik | `https://` | Tempat membuat dan mencabut kunci: **Pengaturan → Integrasi → Kunci API**. |

## 2. Kunci API

Buat **satu kunci per orang atau per asisten**, jangan dipakai bersama. Salin baris di bawah untuk tiap kunci.

| Item | Nilai |
| --- | --- |
| Nama kunci di konsol | |
| Prefix (aman ditulis, untuk mencocokkan audit) | `aev_live_` |
| Rahasia lengkap (`AEVIA_API_KEY`) | `aev_live_` |
| Cakupan | ☐ `read:patients` ☐ `read:progress` ☐ `read:plans` ☐ `write:reminders` ☐ `write:consultation_requests` |
| Dipakai oleh / di perangkat | |
| Dibuat oleh, tanggal | |
| Jadwal ganti (rotasi) | |

Panduan cakupan:

| Kebutuhan | Cakupan |
| --- | --- |
| Hanya membaca (ringkasan, check-in, progres, rencana) | `read:patients`, `read:progress`, `read:plans` |
| + kirim pengingat check-in | + `write:reminders` |
| + ajukan permintaan konsultasi | + `write:consultation_requests` |

Di log audit klinik, setiap panggilan lewat kunci ini tercatat sebagai `mcp:<prefix>`, jadi prefix cukup untuk menelusuri siapa yang memakai kunci tanpa membuka rahasianya.

## 3. Menyimpan kunci di luar file konfigurasi

Supaya file konfigurasi asisten bisa dibagikan tanpa rahasia, simpan kunci di variabel lingkungan dan rujuk namanya saja.

**Variabel lingkungan** (mis. `~/.zshrc`, `~/.bashrc`, atau pengaturan variabel lingkungan Windows):

```bash
export AEVIA_MCP_URL="https://…/mcp"
export AEVIA_API_KEY="aev_live_…"
```

**Claude Code, `.mcp.json` tanpa rahasia** (aman di-commit; `${…}` diisi dari variabel lingkungan saat dijalankan):

```json
{
  "mcpServers": {
    "aevia": {
      "type": "http",
      "url": "${AEVIA_MCP_URL}",
      "headers": { "Authorization": "Bearer ${AEVIA_API_KEY}" }
    }
  }
}
```

**Claude Code, lewat perintah** (konfigurasi tersimpan di tingkat pengguna, bukan di repo):

```bash
claude mcp add --scope user --transport http aevia "$AEVIA_MCP_URL" \
  --header "Authorization: Bearer $AEVIA_API_KEY"
```

**stdio lokal / Claude Desktop**: server membaca `AEVIA_API_URL` dan `AEVIA_API_KEY` dari lingkungan. Di Claude Desktop nilainya diisi di blok `env` pada `claude_desktop_config.json`; file itu ada di komputer pengguna, jangan di-commit atau dibagikan.

**Server `aevia-mcp` (Vercel)** hanya butuh `AEVIA_API_URL`. Server ini **tidak** menyimpan kunci; kunci selalu datang dari header asisten.

## 4. Jika kunci bocor atau tidak dipakai lagi

1. Konsol → **Pengaturan → Integrasi → Kunci API** → cabut kunci tersebut. Berlaku seketika untuk stdio maupun HTTP.
2. Buat kunci baru dengan cakupan yang sama, perbarui variabel lingkungan atau konfigurasi asisten.
3. Periksa audit klinik untuk penanda `mcp:<prefix lama>` guna melihat apa saja yang sempat diakses.
4. Perbarui tabel di bagian 2 (prefix, tanggal, pemakai).
