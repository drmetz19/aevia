// Audit tampilan mobile: isi data demo lewat API (dev server lokal sudah jalan), lalu screenshot
// setiap layar web & console di lebar HP dan laporkan elemen yang melebar keluar layar.
// Pakai: DEV_LOG=/path/log-dev  node apps/web/scripts/mobile-audit.mjs [lebar]
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const API = process.env.API ?? "http://localhost:4000";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CON = process.env.CON ?? "http://localhost:3001";
const LOG = process.env.DEV_LOG ?? "/tmp/claude-0/dev.log";
const OUT = process.env.OUT ?? "/tmp/claude-0/shots";
const W = Number(process.argv[2] ?? 390);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body, tok) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body ?? {}) });
const put = (url, body, tok) =>
  fetch(url, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
const logLen = () => readFileSync(LOG, "utf8").length;
async function otp(email, from) {
  for (let i = 0; i < 60; i++) {
    const m = [...readFileSync(LOG, "utf8").slice(from).matchAll(new RegExp(`${email.replace(/[.+]/g, "\\$&")} kode=(\\d{6})`, "g"))].pop();
    if (m) return m[1];
    await sleep(250);
  }
  throw new Error("OTP tidak ditemukan untuk " + email);
}
async function patient(slug, email) {
  const from = logLen();
  await post(`${API}/v1/clinics/${slug}/auth/otp`, { email });
  return (await (await post(`${API}/v1/clinics/${slug}/auth/verify`, { email, code: await otp(email, from) })).json()).token;
}
// Token staf disimpan antar-jalan agar tidak kena batas permintaan OTP.
const TOK_FILE = `${OUT}/staff-tokens.json`;
const cached = (() => { try { return JSON.parse(readFileSync(TOK_FILE, "utf8")); } catch { return {}; } })();
async function staff(email) {
  if (cached[email]) {
    const ok = await fetch(`${API}/v1/staff/queue`, { headers: { authorization: `Bearer ${cached[email]}` } });
    if (ok.status !== 401) return cached[email];
  }
  const from = logLen();
  const r = await post(`${API}/v1/staff/auth/otp`, { email });
  if (r.status === 429) throw new Error(`Batas OTP untuk ${email}; tunggu ±10 menit`);
  const t = (await (await post(`${API}/v1/staff/auth/verify`, { email, code: await otp(email, from) })).json()).token;
  if (!t) throw new Error(`Gagal masuk sebagai ${email} (batas OTP? tunggu beberapa menit)`);
  cached[email] = t;
  writeFileSync(TOK_FILE, JSON.stringify(cached));
  return t;
}

// --- data ---
const email = `audit-${Date.now()}@contoh.test`;
const tok = await patient("drmetz", email);
for (const [scope, granted] of [["assessment", true], ["medical_record", true], ["photos", true], ["external_context", false]])
  await put(`${API}/v1/me/consents`, { scope, granted }, tok);
const fresh = await patient("drmetz", `audit-baru-${Date.now()}@contoh.test`); // tanpa consent → layar consent
const mid = await patient("drmetz", `audit-tengah-${Date.now()}@contoh.test`);
for (const s of ["assessment", "medical_record"]) await put(`${API}/v1/me/consents`, { scope: s, granted: true }, mid);
await post(`${API}/v1/assessments`, {}, mid); // assessment sedang berjalan

const a = await (await post(`${API}/v1/assessments`, {}, tok)).json();
const QS = JSON.parse(readFileSync(new URL("../../../packages/core/src/questions.v0.json", import.meta.url), "utf8")).questions;
for (const q of QS)
  await post(`${API}/v1/assessments/${a.id}/answers`, q.type === "choice" ? { question_id: q.id, value: q.area === "tidur" ? 4 : 2 } : { question_id: q.id, text: "Ingin tidur lebih nyenyak" }, tok);
await post(`${API}/v1/assessments/${a.id}/complete`, {}, tok);
const progs = (await (await fetch(`${API}/v1/clinics/drmetz/programs`)).json()).programs;
await post(`${API}/v1/consultation-requests`, { program_id: progs[0].id, prep: { tujuan: "Tidur lebih baik dan kulit lebih segar", keluhan: "Sulit tidur sejak 3 bulan", pertanyaan: ["Apa langkah awal?", "Berapa lama sampai terlihat perubahan?"], konteks_assessment: "ctx" } }, tok);

const sTok = await staff("dr.metz@drmetz.test");
const q = (await (await fetch(`${API}/v1/staff/queue`, { headers: { authorization: `Bearer ${sTok}` } })).json()).items;
const mine = q.find((i) => i.patient_email === email);
await post(`${API}/v1/staff/consultation-requests/${mine.id}/accept`, { scheduled_at: new Date(Date.now() + 86400000).toISOString(), meeting_url: "https://meet.google.com/audit-mobile-aevia" }, sTok);
const kid = (await (await fetch(`${API}/v1/consultation-requests/mine`, { headers: { authorization: `Bearer ${tok}` } })).json()).requests.find((r) => r.consultation).consultation.id;
await put(`${API}/v1/staff/consultations/${kid}/soap`, { subjective: "Sulit tidur", objective: "Kulit kering di pipi", assessment: "Perlu tinjauan pola tidur", plan: "Kontrol 2 minggu" }, sTok);
const rx = await (await put(`${API}/v1/staff/consultations/${kid}/prescriptions`, { items: [{ name: "Tretinoin 0,025%", dose: "tipis", frequency: "malam" }, { name: "Pelembap ceramide", dose: "secukupnya", frequency: "pagi & malam" }] }, sTok)).json();
await post(`${API}/v1/staff/prescriptions/${rx.id}/issue`, {}, sTok);
const plan = await (await put(`${API}/v1/staff/consultations/${kid}/care-plans`, { content: { focus: ["Memperbaiki kualitas tidur", "Menjaga hidrasi kulit"], next_steps: ["Rutinitas malam", "Pelembap rutin"], monitor: [{ metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" }], review_at: "2026-12-01" }, summary: { discussed: "Pola tidur dan perawatan kulit.", priorities: ["Tidur", "Kulit"] } }, sTok)).json();
await post(`${API}/v1/staff/care-plans/${plan.id}/sign`, { confirm: true }, sTok);
await post(`${API}/v1/checkins`, { values: { tidur: 2 }, note: "awal" }, tok);
await post(`${API}/v1/checkins`, { values: { tidur: 3 } }, tok);
const ca = await staff("admin@drmetz.test");
const pa = await staff("admin@aevia.test");

// --- layar ---
const P = (p) => `${WEB}/c/drmetz${p}`;
const pages = [
  ["web-landing", P(""), null],
  ["web-masuk", P("/masuk"), null],
  ["web-syarat", P("/syarat"), null],
  ["web-consent", P("/consent"), ["sid_drmetz", fresh, WEB]],
  ["web-beranda", P("/beranda"), ["sid_drmetz", tok, WEB]],
  ["web-assessment-chat", P("/assessment"), ["sid_drmetz", mid, WEB]],
  ["web-assessment-hasil", P("/assessment/hasil"), ["sid_drmetz", tok, WEB]],
  ["web-program", P("/program"), ["sid_drmetz", tok, WEB]],
  ["web-konsultasi", P(`/konsultasi?program=${progs[0].id}`), ["sid_drmetz", tok, WEB]],
  ["web-rencana", P("/rencana"), ["sid_drmetz", tok, WEB]],
  ["web-checkin", P("/checkin"), ["sid_drmetz", tok, WEB]],
  ["web-progres", P("/progres"), ["sid_drmetz", tok, WEB]],
  ["web-wl-landing", `${WEB}/c/demo-partner`, null],
  ["con-masuk", `${CON}/masuk`, null],
  ["con-beranda", `${CON}/beranda`, ["ssid", sTok, CON]],
  ["con-antrean", `${CON}/antrean`, ["ssid", sTok, CON]],
  ["con-pasien", `${CON}/pasien/${mine.patient_id}`, ["ssid", sTok, CON]],
  ["con-pasien-progres", `${CON}/pasien/${mine.patient_id}?tab=progres`, ["ssid", sTok, CON]],
  ["con-soap", `${CON}/konsultasi/${kid}`, ["ssid", sTok, CON]],
  ["con-skin", `${CON}/konsultasi/${kid}?tab=skin`, ["ssid", sTok, CON]],
  ["con-resep", `${CON}/konsultasi/${kid}?tab=resep`, ["ssid", sTok, CON]],
  ["con-rencana", `${CON}/konsultasi/${kid}?tab=rencana`, ["ssid", sTok, CON]],
  ["con-audit", `${CON}/konsultasi/${kid}?tab=audit`, ["ssid", sTok, CON]],
  ["con-admin-beranda", `${CON}/beranda`, ["ssid", ca, CON]],
  ["con-brand", `${CON}/pengaturan/brand`, ["ssid", ca, CON]],
  ["con-program", `${CON}/pengaturan/program`, ["ssid", ca, CON]],
  ["con-staf", `${CON}/pengaturan/staf`, ["ssid", ca, CON]],
  ["con-integrasi", `${CON}/pengaturan/integrasi`, ["ssid", ca, CON]],
  ["con-platform-klinik", `${CON}/admin/klinik`, ["ssid", pa, CON]],
  ["con-platform-asisten", `${CON}/admin/asisten`, ["ssid", pa, CON]],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const report = [];
for (const [name, url, ck] of pages) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  if (ck) await ctx.addCookies([{ name: ck[0], value: ck[1], url: ck[2] }]);
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle" }).catch((e) => ({ status: () => "ERR " + e.message }));
  await sleep(300);
  const info = await page.evaluate((vw) => {
    const sw = document.documentElement.scrollWidth;
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // lewati elemen di dalam kontainer yang memang bisa digulir horizontal
        let p = el.parentElement, scrollable = false;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.getBoundingClientRect().right <= vw + 1) { scrollable = true; break; }
          p = p.parentElement;
        }
        if (!scrollable) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} → ${Math.round(r.left)}..${Math.round(r.right)} "${(el.textContent || "").trim().slice(0, 40)}"`);
      }
    }
    const small = [...document.querySelectorAll("a,button,input,select,textarea,label")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 32 && !["label"].includes(e.tagName.toLowerCase());
    }).length;
    const tiny = [...document.querySelectorAll("p,span,a,li,td,th,label,button")].filter((e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length;
    return { sw, out: out.slice(0, 12), n: out.length, small, tiny, title: document.title, h: document.documentElement.scrollHeight };
  }, W);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  report.push({ name, status: typeof res?.status === "function" ? res.status() : "?", url: page.url().replace(/^https?:\/\/[^/]+/, ""), ...info });
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
for (const r of report)
  console.log(`${r.sw > W ? "✗" : "✓"} ${r.name.padEnd(22)} ${r.status} lebar=${r.sw} overflowEl=${r.n} tapKecil=${r.small} teksKecil=${r.tiny} ${r.url}${r.out.length ? "\n    " + r.out.join("\n    ") : ""}`);
