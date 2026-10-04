// Smoke HTML berbasis fetch (fallback bila Chromium Playwright tak bisa dipasang).
// Menyalakan API (PGlite sementara) + web, memeriksa kriteria Phase 1 #3, lalu mematikan semuanya.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const procs = [];
const run = (cmd, args, env) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: "ignore", detached: true });
  procs.push(p);
};
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid); } catch {} });
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timeout menunggu ${url}`);
}
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) fails.push(msg); };
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

try {
  run("pnpm", ["--filter", "@aevia/api", "dev"], { PGLITE_DIR: mkdtempSync(join(tmpdir(), "aevia-smoke-")), PORT: "4000" });
  run("pnpm", ["--filter", "@aevia/web", "dev"], { API_URL: API });
  await waitFor(`${API}/health`);
  await waitFor(`${WEB}/c/drmetz`);

  const dm = await (await fetch(`${WEB}/c/drmetz`)).text();
  check(dm.includes("DrMetz"), "/c/drmetz memuat nama DrMetz");
  check(dm.includes("powered by AEVIA"), "/c/drmetz memuat 'powered by AEVIA'");
  check(dm.replace(/<!-- -->/g, "").includes("Sovia adalah AI"), "/c/drmetz memuat 'Sovia adalah AI'");
  check(dm.includes("Mulai assessment") && dm.includes("/c/drmetz/assessment"), "CTA Mulai assessment → /assessment");
  for (const s of ["Assessment", "Konsultasi", "Rencana personal", "Follow-up &amp; progres"])
    check(dm.includes(s), `stepper: ${s}`);

  const dp = await (await fetch(`${WEB}/c/demo-partner`)).text();
  check(dp.includes("Lumina Skin Studio"), "/c/demo-partner memuat nama klinik");
  check(!/aevia/i.test(text(dp)) && !/<title>[^<]*aevia/i.test(dp) && !/alt="[^"]*aevia/i.test(dp), "/c/demo-partner tanpa kata AEVIA (teks, title, alt)");
  check(dp.includes("--brand-primary:#1F4D3F") || dp.includes("--brand-primary: #1F4D3F"), "whitelabel menimpa --brand-primary");

  const nf = await fetch(`${WEB}/c/tidak-ada`);
  check(nf.status === 404, "slug tak dikenal → 404 di web");
  const as = await fetch(`${WEB}/c/drmetz/assessment`);
  check(as.status === 200, "/c/drmetz/assessment 200");
} catch (e) {
  console.error(e);
  fails.push(String(e));
} finally {
  stop();
}
console.log(fails.length ? `\nSmoke GAGAL (${fails.length})` : "\nSmoke OK");
process.exit(fails.length ? 1 : 0);
