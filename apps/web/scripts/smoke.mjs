// Smoke HTML berbasis fetch (fallback bila Chromium Playwright tak bisa dipasang).
// Menyalakan API (PGlite sementara) + web, memeriksa kriteria Phase 1 #3, lalu mematikan semuanya.
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deterministik: data dir sementara baru, port acak bebas, build produksi + `next start`, readiness polling,
// dan seluruh proses dimatikan per process group (tanpa pkill berdasarkan nama).
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const [apiPort, webPort, conPort] = [await freePort(), await freePort(), await freePort()];
const API = `http://127.0.0.1:${apiPort}`;
const WEB = `http://127.0.0.1:${webPort}`;
const CON = `http://127.0.0.1:${conPort}`;
const dataDir = mkdtempSync(join(tmpdir(), "aevia-smoke-"));
const procs = [];
let apiLog = "";
const exited = new Map();
const run = (name, cmd, args, env, capture = false) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => { if (capture) apiLog += d; });
  p.stderr.on("data", (d) => { if (capture) apiLog += d; });
  p.on("exit", (code) => exited.set(name, code));
  procs.push(p);
  return p;
};
const runToEnd = (cmd, args, env = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} gagal (${c})`))));
  });
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid, "SIGTERM"); } catch {} });
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });
async function otpCode(email) {
  for (let i = 0; i < 40; i++) {
    const m = [...apiLog.matchAll(new RegExp(`${email.replace(/[.]/g, "\\.")} kode=(\\d{6})`, "g"))].pop();
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`OTP ${email} tidak muncul di log API`);
}
const post = (url, body, token) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
async function waitFor(name, url, ok = (r) => r.status === 200, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited.has(name)) throw new Error(`Proses ${name} berhenti (kode ${exited.get(name)}) sebelum siap`);
    try { if (ok(await fetch(url))) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout menunggu ${name} di ${url}`);
}
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) fails.push(msg); };
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

try {
  if (!process.env.SMOKE_SKIP_BUILD) {
    await runToEnd("pnpm", ["--filter", "@aevia/web", "--filter", "@aevia/console", "build"]);
  }
  run("api", "pnpm", ["--filter", "@aevia/api", "exec", "tsx", "src/server.ts"], { PGLITE_DIR: join(dataDir, "pglite"), UPLOADS_DIR: join(dataDir, "uploads"), PORT: String(apiPort), NODE_ENV: "development" }, true);
  await waitFor("api", `${API}/health`);
  run("web", "pnpm", ["--filter", "@aevia/web", "exec", "next", "start", "-p", String(webPort)], { API_URL: API });
  run("console", "pnpm", ["--filter", "@aevia/console", "exec", "next", "start", "-p", String(conPort)], { API_URL: API, API_PUBLIC_URL: API });
  await waitFor("web", `${WEB}/c/drmetz`);
  await waitFor("console", `${CON}/masuk`);
  // Pemanasan: pastikan data seed terbaca lewat web sebelum pengecekan dimulai.
  await waitFor("web", `${WEB}/c/demo-partner`);

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

  // --- Phase 2: masuk → consent → beranda ---
  const email = `smoke${Date.now()}@contoh.test`;
  check((await fetch(`${WEB}/c/drmetz/masuk`)).status === 200, "/c/drmetz/masuk 200");
  const mh = await (await fetch(`${WEB}/c/drmetz/masuk`)).text();
  check(mh.includes("Kirim kode masuk"), "halaman masuk memuat form email");
  const wl = await (await fetch(`${WEB}/c/demo-partner/masuk`)).text();
  check(!/aevia/i.test(text(wl)), "/c/demo-partner/masuk tanpa kata AEVIA");

  const noSess = await fetch(`${WEB}/c/drmetz/beranda`, { redirect: "manual" });
  check(noSess.status >= 300 && noSess.status < 400 && (noSess.headers.get("location") ?? "").includes("/masuk"), "beranda tanpa sesi → redirect ke masuk");

  check((await post(`${API}/v1/clinics/drmetz/auth/otp`, { email })).status === 200, "API: minta OTP");
  const bad = await post(`${API}/v1/clinics/drmetz/auth/verify`, { email, code: "000000" });
  check(bad.status === 400 || bad.status === 200, "API: kode salah ditolak dengan pesan");
  const code = await otpCode(email);
  const ver = await post(`${API}/v1/clinics/drmetz/auth/verify`, { email, code });
  check(ver.status === 200, "API: verifikasi OTP → token");
  const { token } = await ver.json();
  const cookie = { cookie: `sid_drmetz=${token}` };

  const toConsent = await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie, redirect: "manual" });
  check((toConsent.headers.get("location") ?? "").includes("/c/drmetz/consent"), "sesi baru tanpa keputusan → diarahkan ke consent");
  const cp = await (await fetch(`${WEB}/c/drmetz/consent`, { headers: cookie })).text();
  check(cp.includes("Hasil assessment") && cp.includes("Foto kulit") && cp.includes("Simpan pilihan saya"), "layar consent memuat 4 cakupan");

  const hdr = { "content-type": "application/json", authorization: `Bearer ${token}` };
  for (const [scope, granted] of [["assessment", true], ["medical_record", true], ["photos", false], ["external_context", false]])
    await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope, granted }) });
  const home = await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie });
  const homeHtml = await home.text();
  check(home.status === 200 && homeHtml.includes(email) && homeHtml.includes("Mulai assessment"), "beranda pasien tampil setelah consent");
  check(homeHtml.replace(/<!-- -->/g, "").includes("2 dari 4"), "beranda menampilkan ringkasan consent 2 dari 4");

  const other = await fetch(`${API}/v1/clinics/demo-partner/me`, { headers: { authorization: `Bearer ${token}` } });
  check(other.status === 403, "token klinik A → 403 di klinik B");

  // --- Phase 3: assessment Sovia ---
  const noAuth = await fetch(`${WEB}/c/drmetz/assessment`, { redirect: "manual" });
  check((noAuth.headers.get("location") ?? "").endsWith("/c/drmetz/masuk"), "assessment tanpa sesi → masuk");
  const intro = (await (await fetch(`${WEB}/c/drmetz/assessment`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(intro.includes("Sovia · AI Guide by AEVIA"), "cobrand: header 'Sovia · AI Guide by AEVIA'");
  check(intro.includes("Sovia adalah AI"), "chat: label 'Sovia adalah AI'");
  check(intro.includes("Mari mulai dengan memahami kondisi Anda saat ini"), "intro Sovia (Verbal Identity)");
  check(intro.includes("Mulai assessment"), "tombol Mulai assessment (form)");

  const st1 = await (await post(`${API}/v1/assessments`, {}, token)).json();
  const mid = (await (await fetch(`${WEB}/c/drmetz/assessment`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(mid.includes('role="progressbar"') && mid.includes("Pertanyaan 1 dari 20"), "chat: progress bar + satu pertanyaan per langkah");
  check(mid.includes('type="radio"') && mid.includes("Lanjut"), "pertanyaan pilihan berupa form radio (no-JS)");
  check(!/aevia/i.test(text(mid).replace(/Sovia · AI Guide by AEVIA|powered by AEVIA/g, "")), "tidak ada AEVIA selain header/badge cobrand");

  const emerg = await post(`${API}/v1/assessments/${st1.id}/answers`, { question_id: "tujuan-t", text: "kadang nyeri dada" }, token);
  const eb = await emerg.json();
  check(eb.flagged === true && /IGD/.test(eb.emergency_message), "teks darurat → flagged + rujukan IGD/119");
  const flaggedPage = await (await fetch(`${WEB}/c/drmetz/assessment`, { headers: cookie })).text();
  check(flaggedPage.includes('role="alert"') && flaggedPage.includes("119"), "chat menampilkan pesan darurat");

  const answered = await post(`${API}/v1/assessments/${st1.id}/answers`, { question_id: "tujuan-1", value: 3 }, token);
  check(answered.status === 200, "API: jawab pertanyaan pertama");
  const QS = JSON.parse((await import("node:fs")).readFileSync(new URL("../../../packages/core/src/questions.v0.json", import.meta.url), "utf8")).questions;
  for (const q of QS) {
    if (q.id === "tujuan-1" || q.id === "tujuan-t") continue;
    await post(`${API}/v1/assessments/${st1.id}/answers`, q.type === "choice" ? { question_id: q.id, value: q.area === "tidur" ? 4 : 2 } : { question_id: q.id, text: "" }, token);
  }
  const fin = (await (await fetch(`${WEB}/c/drmetz/assessment`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(fin.includes("Lihat hasil"), "semua terjawab → tombol Lihat hasil");
  const doneRes = await post(`${API}/v1/assessments/${st1.id}/complete`, {}, token);
  check(doneRes.status === 200, "API: selesai (consent assessment aktif)");
  const hasil = (await (await fetch(`${WEB}/c/drmetz/assessment/hasil`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(hasil.includes("Hasil assessment bukan diagnosis."), "hasil: disclaimer 'bukan diagnosis'");
  check(hasil.includes("Prioritas untuk dibahas") && hasil.includes("Relatif stabil"), "hasil: label tenang per area");
  check(hasil.includes("Siapkan konsultasi"), "hasil: CTA Siapkan konsultasi");
  check((await fetch(`${WEB}/c/drmetz/konsultasi`)).status === 200, "/c/drmetz/konsultasi (stub) 200");

  // tanpa consent → 403 manusiawi
  const em2 = `smoke2-${Date.now()}@contoh.test`;
  await post(`${API}/v1/clinics/demo-partner/auth/otp`, { email: em2 });
  const t2 = (await (await post(`${API}/v1/clinics/demo-partner/auth/verify`, { email: em2, code: await otpCode(em2) })).json()).token;
  const s2 = await (await post(`${API}/v1/assessments`, {}, t2)).json();
  const wlChat = (await (await fetch(`${WEB}/c/demo-partner/assessment`, { headers: { cookie: `sid_demo-partner=${t2}` } })).text()).replace(/<!-- -->/g, "");
  check(!/aevia/i.test(text(wlChat)), "whitelabel: chat tanpa kata AEVIA");
  check(wlChat.includes("Sovia · AI Guide") && !wlChat.includes("by AEVIA"), "whitelabel: header '<nama> · AI Guide'");
  const noConsent = await post(`${API}/v1/assessments/${s2.id}/complete`, {}, t2);
  check(noConsent.status === 403, "complete tanpa consent → 403");

  // --- Phase 4: program, prep, antrean ---
  const prog = (await (await fetch(`${WEB}/c/drmetz/program`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(prog.includes("Konsultasi Healthy Aging") && prog.includes("Program Pendampingan Kulit 8 Minggu") && prog.includes("Rp"), "katalog: 3 program drmetz + harga dari DB");
  check(!/permanen|body reset|garansi|instan/i.test(text(prog)), "katalog tanpa klaim terlarang");
  const progs = (await (await fetch(`${API}/v1/clinics/drmetz/programs`)).json()).programs;
  const kons = (await (await fetch(`${WEB}/c/drmetz/konsultasi?program=${progs[0].id}`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(kons.includes("Kirim permintaan konsultasi") && kons.includes("Sovia adalah AI"), "form prep tampil + label AI");
  check(/Tidur/.test(kons) && kons.includes("Anda sudah memiliki gambaran awal"), "form prep terisi dari assessment (Verbal Identity §22)");
  const rq = await post(`${API}/v1/consultation-requests`, { program_id: progs[0].id, prep: { tujuan: "Tidur lebih baik", keluhan: "Sulit tidur", pertanyaan: ["Apa langkah awal?"], konteks_assessment: "ctx" } }, token);
  check(rq.status === 201, "API: kirim permintaan konsultasi");
  const stepper1 = (await (await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(stepper1.includes("Menunggu tinjauan"), "stepper beranda: Menunggu tinjauan");

  const sEmail = "dr.metz@drmetz.test";
  await post(`${API}/v1/staff/auth/otp`, { email: sEmail });
  const sTok = (await (await post(`${API}/v1/staff/auth/verify`, { email: sEmail, code: await otpCode(sEmail) })).json()).token;
  const sCookie = { cookie: `ssid=${sTok}` };
  const antrean = await (await fetch(`${CON}/antrean`, { headers: sCookie })).text();
  check(antrean.includes(email) && antrean.includes("Menunggu ditinjau"), "console /antrean memuat permintaan");
  const qItems = (await (await fetch(`${API}/v1/staff/queue`, { headers: { authorization: `Bearer ${sTok}` } })).json()).items;
  const mine = qItems.find((i) => i.patient_email === email);
  const detail = await (await fetch(`${CON}/pasien/${mine.patient_id}`, { headers: sCookie })).text();
  check(detail.includes("Tidur lebih baik") && detail.includes("Terima dan jadwalkan"), "console /pasien/:id memuat prep + dialog terima");
  const acc = await post(`${API}/v1/staff/consultation-requests/${mine.id}/accept`, { scheduled_at: new Date(Date.now() + 86400000).toISOString(), meeting_url: "https://meet.google.com/smoke-test" }, sTok);
  check(acc.status === 200, "API: terima permintaan");
  const stepper2 = (await (await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(/Terjadwal/.test(stepper2) && stepper2.includes("meet.google.com/smoke-test"), "stepper beranda: Terjadwal + tautan");
  const wlProg = (await (await fetch(`${WEB}/c/demo-partner/program`, { headers: { cookie: `sid_demo-partner=${t2}` } })).text()).replace(/<!-- -->/g, "");
  check(wlProg.includes("Konsultasi Awal") && !wlProg.includes("Healthy Aging") && !/aevia/i.test(text(wlProg)), "whitelabel: katalog klinik sendiri, tanpa AEVIA");

  // --- Phase 5: SOAP, skin, foto, audit ---
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "photos", granted: true }) });
  const reqMine = (await (await fetch(`${API}/v1/consultation-requests/mine`, { headers: hdr })).json()).requests.find((r) => r.consultation);
  const kid = reqMine.consultation.id;
  const sAuth = { authorization: `Bearer ${sTok}` };
  const soapPage = await (await fetch(`${CON}/konsultasi/${kid}`, { headers: sCookie })).text();
  check(soapPage.includes("Catatan SOAP") && soapPage.includes("Subjective") && soapPage.includes("Audit") && soapPage.includes("Resep"), "console /konsultasi/:id: tab + form SOAP");
  const putSoap = await fetch(`${API}/v1/staff/consultations/${kid}/soap`, { method: "PUT", headers: { ...sAuth, "content-type": "application/json" }, body: JSON.stringify({ subjective: "Sulit tidur", objective: "Kulit kering", assessment: "Perlu tinjauan", plan: "Kontrol 2 minggu" }) });
  check(putSoap.status === 200, "API: simpan SOAP");
  const soapAfter = await (await fetch(`${CON}/konsultasi/${kid}`, { headers: sCookie })).text();
  check(soapAfter.includes("Sulit tidur") && soapAfter.includes("Kontrol 2 minggu"), "SOAP tersimpan tampil kembali di console");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("smoke-image")]);
  const up = await fetch(`${API}/v1/staff/consultations/${kid}/photos?angle=front`, { method: "POST", headers: { ...sAuth, "content-type": "image/jpeg" }, body: jpg });
  check(up.status === 201, "API: unggah foto (jpg + magic bytes)");
  const pid = (await up.json()).id;
  const badUp = await fetch(`${API}/v1/staff/consultations/${kid}/photos`, { method: "POST", headers: { ...sAuth, "content-type": "image/jpeg" }, body: Buffer.from("not an image") });
  check(badUp.status === 415, "API: berkas bukan gambar ditolak");
  await fetch(`${API}/v1/staff/photos/${pid}/annotations`, { method: "PUT", headers: { ...sAuth, "content-type": "application/json" }, body: JSON.stringify({ annotations: [{ type: "point", x: 0.3, y: 0.4, label: "Bercak", severity: "medium" }] }) });
  const skinPage = (await (await fetch(`${CON}/konsultasi/${kid}?tab=skin`, { headers: sCookie })).text()).replace(/<!-- -->/g, "");
  check(skinPage.includes("Melasma &amp; hiperpigmentasi") && skinPage.includes("Skor kulit keseluruhan"), "tab Skin: parameter default klinik");
  check(skinPage.includes("Bercak") && skinPage.includes("Overlay area") && skinPage.includes("Foto klinis"), "tab Skin: foto + anotasi + overlay area");
  check(!/multi-?spectral/i.test(skinPage), "tab Skin: tanpa klaim multi-spectral");
  const furl = (await (await fetch(`${API}/v1/staff/photos/${pid}/url`, { headers: sAuth })).json()).url;
  check((await fetch(`${API}${furl}`)).status === 200, "URL bertanda tangan melayani foto");
  check((await fetch(`${API}/v1/staff/consultations/${kid}/soap`, { method: "PUT", headers: { ...hdr }, body: JSON.stringify({ subjective: "", objective: "", assessment: "", plan: "" }) })).status === 403, "token pasien 403 di endpoint SOAP");
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "photos", granted: false }) });
  check((await fetch(`${API}${furl}`)).status === 403, "consent foto dicabut → URL foto 403");
  const audit = (await (await fetch(`${CON}/konsultasi/${kid}?tab=audit`, { headers: sCookie })).text()).replace(/<!-- -->/g, "");
  check(audit.includes("SOAP dibuat") && audit.includes("Foto diunggah") && audit.includes("Sebelum dan sesudah"), "tab Audit: riwayat perubahan");
  const hiddenSkin = (await (await fetch(`${CON}/konsultasi/${kid}?tab=skin`, { headers: sCookie })).text()).replace(/<!-- -->/g, "");
  check(hiddenSkin.includes("sudah mencabutnya") && !hiddenSkin.includes("Bercak"), "consent dicabut → foto & anotasi disembunyikan di console");

  // --- Phase 6: resep + rencana bertanda tangan ---
  const noPlan = (await (await fetch(`${WEB}/c/drmetz/rencana`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(noPlan.includes("Rencana akan tersedia setelah konsultasi selesai ditinjau profesional."), "rencana: empty state §29 sebelum signed");
  const rxTab = await (await fetch(`${CON}/konsultasi/${kid}?tab=resep`, { headers: sCookie })).text();
  check(rxTab.includes("Simpan draf resep"), "console tab Resep berfungsi");
  const planTab = await (await fetch(`${CON}/konsultasi/${kid}?tab=rencana`, { headers: sCookie })).text();
  check(planTab.includes("Fokus Anda saat ini") && planTab.includes("Kapan kita tinjau kembali"), "console tab Rencana: heading §24");
  const jh = { ...sAuth, "content-type": "application/json" };
  const rxSaved = await (await fetch(`${API}/v1/staff/consultations/${kid}/prescriptions`, { method: "PUT", headers: jh, body: JSON.stringify({ items: [{ name: "Tretinoin 0,025%", dose: "tipis", frequency: "malam" }] }) })).json();
  await fetch(`${API}/v1/staff/prescriptions/${rxSaved.id}/issue`, { method: "POST", headers: sAuth });
  const planDraft = await (await fetch(`${API}/v1/staff/consultations/${kid}/care-plans`, { method: "PUT", headers: jh, body: JSON.stringify({ content: { focus: ["Memperbaiki kualitas tidur"], next_steps: ["Rutinitas malam"], monitor: [{ metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" }], review_at: "2026-12-01" }, summary: { discussed: "Pola tidur.", priorities: ["Tidur"] } }) })).json();
  check((await fetch(`${WEB}/c/drmetz/rencana`, { headers: cookie }).then((r) => r.text())).includes("Rencana akan tersedia"), "draf rencana tidak terlihat pasien");
  const signRes = await fetch(`${API}/v1/staff/care-plans/${planDraft.id}/sign`, { method: "POST", headers: jh, body: JSON.stringify({ confirm: true }) });
  check(signRes.status === 200, "API: tandatangani rencana");
  const plan = (await (await fetch(`${WEB}/c/drmetz/rencana`, { headers: cookie })).text()).replace(/<!-- -->/g, "");
  check(plan.includes("Rencana Anda telah diperbarui oleh tim DrMetz."), "rencana: kalimat §34 (nama klinik)");
  check(["Fokus Anda saat ini", "Langkah berikutnya", "Yang perlu dipantau", "Kapan kita tinjau kembali", "Yang dibahas", "Prioritas Anda", "Rencana saat ini"].every((h) => plan.includes(h)), "rencana: heading §23 + §24");
  check(plan.includes("Reviewed by Professional") && plan.includes("Professional Plan"), "rencana: trust badges");
  check(plan.includes("Sovia adalah AI") && plan.includes("Sovia menjelaskan rencana Anda"), "rencana: bubble penjelasan Sovia");
  check(plan.includes("Resep dari dr. Metz") && plan.includes("Tretinoin"), "rencana: resep terbit read-only");
  check(plan.includes("powered by AEVIA") || plan.includes("ditampilkan melalui AEVIA"), "cobrand: menyebut AEVIA sebagai platform");
  check((await (await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie })).text()).includes("Lihat rencana"), "beranda: tombol Lihat rencana");
  const aud = (await (await fetch(`${CON}/konsultasi/${kid}?tab=audit`, { headers: sCookie })).text()).replace(/<!-- -->/g, "");
  check(aud.includes("Rencana ditandatangani") && aud.includes("Resep diterbitkan") && aud.includes("Subjective (S)"), "audit: label manusiawi (S/O/A/P, rencana, resep)");
  const wlPlan = (await (await fetch(`${WEB}/c/demo-partner/rencana`, { headers: { cookie: `sid_demo-partner=${t2}` } })).text()).replace(/<!-- -->/g, "");
  check(wlPlan.includes("Rencana akan tersedia") && !/aevia/i.test(text(wlPlan)), "whitelabel: rencana tanpa AEVIA");

  // --- Phase 7: check-in, progres, pengingat ---
  const flat = (h) => h.replace(/<!-- -->/g, "");
  const prog0 = flat(await (await fetch(`${WEB}/c/drmetz/progres`, { headers: cookie })).text());
  check(prog0.includes("Belum ada data progres. Setelah check-in pertama, perkembangan Anda akan mulai terlihat di sini."), "progres: empty state §29");
  const home7 = flat(await (await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie })).text());
  check(home7.includes("Pemberitahuan") && home7.includes("Rencana Anda sudah diperbarui.") && home7.includes("Lihat perubahan terbaru"), "beranda: notifikasi in-app konteks + aksi (§31)");
  check(home7.includes("Cek progres") && home7.includes("Mulai check-in"), "beranda: CTA check-in & progres");
  const ci = flat(await (await fetch(`${WEB}/c/drmetz/checkin`, { headers: cookie })).text());
  check(ci.includes("Kualitas tidur") && ci.includes('type="radio"') && ci.includes("Simpan check-in"), "check-in: metrik dari rencana signed (form no-JS)");
  check(ci.includes('aria-label="3, Cukup"') && /required=""/.test(ci), "check-in: aria-label per radio + required");
  const c1 = await post(`${API}/v1/checkins`, { values: { tidur: 2 }, note: "awal" }, token);
  check(c1.status === 201, "API: check-in pertama");
  const c2 = await post(`${API}/v1/checkins`, { values: { tidur: 3 } }, token);
  const c2b = await c2.json();
  check(c2.status === 201 && c2b.metrics[0].delta_text === "Naik 50% sejak check-in terakhir", "check-in kedua: 'Naik 50% sejak check-in terakhir'");
  const prog1 = flat(await (await fetch(`${WEB}/c/drmetz/progres`, { headers: cookie })).text());
  check(["Saat ini", "Sebelumnya", "Target", "Tren"].every((w) => prog1.includes(w)), "progres: Saat ini / Sebelumnya / Target / Tren");
  check(prog1.includes("<svg") && prog1.includes("Naik 50% sejak check-in terakhir") && prog1.includes("Ada perubahan positif pada area ini."), "progres: sparkline SVG + delta + status §25");
  check(!/buruk|gagal/i.test(text(prog1)), "progres: tanpa kata buruk/gagal");
  check(flat(await (await fetch(`${WEB}/c/drmetz/rencana`, { headers: cookie })).text()).includes("Saat ini 2"), "rencana: baris metrik 'Saat ini'/'Target' (§37)");
  const homeAfter = flat(await (await fetch(`${WEB}/c/drmetz/beranda`, { headers: cookie })).text());
  check(!homeAfter.includes("Waktunya check-in singkat."), "pengingat check-in belum jatuh tempo tidak tampil");
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "medical_record", granted: false }) });
  const hiddenProg = flat(await (await fetch(`${CON}/pasien/${mine.patient_id}?tab=progres`, { headers: sCookie })).text());
  check(hiddenProg.includes("persetujuan akses rekam medis"), "console: progres disembunyikan tanpa consent rekam medis");
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "medical_record", granted: true }) });
  const conProg = flat(await (await fetch(`${CON}/pasien/${mine.patient_id}?tab=progres`, { headers: sCookie })).text());
  check(conProg.includes("Naik 50% sejak check-in terakhir") && conProg.includes("Tren") && conProg.includes("<svg"), "console: tab Progres dengan kartu yang sama");
  await fetch(`${API}/v1/staff/consultations/${kid}/care-plans`, { method: "PUT", headers: jh, body: JSON.stringify({ content: { focus: ["Hasil permanen"], next_steps: ["Rutinitas"], monitor: [], review_at: null }, summary: { discussed: "", priorities: [] } }) });
  const warn = flat(await (await fetch(`${CON}/konsultasi/${kid}?tab=rencana`, { headers: sCookie })).text());
  check(warn.includes("Perhatian:") && warn.includes("permanen") && warn.includes("Tandatangani rencana"), "console: peringatan non-blocking untuk istilah terlarang");

  // Console staf
  check((await fetch(`${CON}/masuk`)).status === 200, "console /masuk 200");
  // Password staf: halaman, link dari email (log dev), atur password, login
  const masukHtml = await (await fetch(`${CON}/masuk`)).text();
  check(masukHtml.includes('type="password"') && masukHtml.includes("Lupa atau belum punya password?"), "console /masuk: form password + link lupa password");
  check((await (await fetch(`${CON}/masuk/kode`)).text()).includes("Kirim kode masuk"), "console /masuk/kode: OTP tetap tersedia");
  check((await fetch(`${CON}/lupa-password`)).status === 200, "console /lupa-password 200");
  check((await (await fetch(`${CON}/atur-password?token=x`)).text()).includes("belum lengkap atau sudah tidak berlaku"), "console /atur-password token rusak → pesan + minta link baru");
  const pwEmail = "admin@drmetz.test";
  check((await post(`${API}/v1/staff/auth/login`, { email: pwEmail, password: "belum-diatur-1" })).status === 400, "API: login password sebelum diatur → 400");
  check((await post(`${API}/v1/staff/auth/password/request`, { email: pwEmail })).status === 200, "API: minta link atur password");
  let pwLink;
  for (let i = 0; i < 40 && !pwLink; i++) { pwLink = [...apiLog.matchAll(/\[LINK\] password_set admin@drmetz\.test link=(\S+)/g)].pop()?.[1]; if (!pwLink) await new Promise((r) => setTimeout(r, 250)); }
  check(Boolean(pwLink) && pwLink.includes("/atur-password?token="), "email link berisi /atur-password?token=");
  const pwToken = new URL(pwLink).searchParams.get("token");
  check((await (await fetch(`${CON}/atur-password?token=${pwToken}`)).text()).includes("Simpan dan masuk"), "console /atur-password: form password baru");
  const pwSet = await post(`${API}/v1/staff/auth/password/set`, { token: pwToken, password: "Smoke-Password-2026" });
  check(pwSet.status === 200 && (await pwSet.json()).role === "clinic_admin", "API: atur password → sesi admin klinik");
  const pwLogin = await post(`${API}/v1/staff/auth/login`, { email: pwEmail, password: "Smoke-Password-2026" });
  check(pwLogin.status === 200, "API: login dengan password");
  const pwBeranda = await fetch(`${CON}/beranda`, { headers: { cookie: `ssid=${(await pwLogin.json()).token}` } });
  check(pwBeranda.status === 200 && (await pwBeranda.text()).includes("Admin DrMetz"), "console beranda dengan sesi password");

  const se = "dr.metz@drmetz.test";
  await post(`${API}/v1/staff/auth/otp`, { email: se });
  const sv = await post(`${API}/v1/staff/auth/verify`, { email: se, code: await otpCode(se) });
  check(sv.status === 200, "API: staf masuk");
  const st = (await sv.json()).token;
  const ch = await fetch(`${CON}/beranda`, { headers: { cookie: `ssid=${st}` } });
  check(ch.status === 200 && (await ch.text()).includes("dr. Metz"), "console beranda memuat dr. Metz");
  const cn = await fetch(`${CON}/beranda`, { redirect: "manual" });
  check(cn.status >= 300 && cn.status < 400, "console beranda tanpa sesi → redirect");

  // Phase 8: pengaturan klinik + admin AEVIA
  const stafToken = async (email) => {
    await post(`${API}/v1/staff/auth/otp`, { email });
    return (await (await post(`${API}/v1/staff/auth/verify`, { email, code: await otpCode(email) })).json()).token;
  };
  const put = (url, body, tok) => fetch(url, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  const ca = await stafToken("admin@demo-partner.test");
  const pa = await stafToken("admin@aevia.test");
  const caC = { cookie: `ssid=${ca}` };
  const paC = { cookie: `ssid=${pa}` };
  const palette = { primary: "#1F4D3F", accent: "#B5542F", background: "#F5F7F3", surface: "#FFFFFF" };
  const lowC = await put(`${API}/v1/staff/brand`, { brand_mode: "whitelabel", colors: { ...palette, primary: "#AAAAAA" }, font: null, custom_domain: null }, ca);
  const lowB = await lowC.json();
  check(lowC.status === 400 && /minimal 4,5:1/.test(lowB.message), "brand: kontras < 4,5:1 ditolak dengan penjelasan");
  const okB = await put(`${API}/v1/staff/brand`, { brand_mode: "whitelabel", colors: palette, font: "Inter", custom_domain: "sehat.lumina.id" }, ca);
  check(okB.status === 200, "brand: whitelabel + font Inter + domain tersimpan");
  const dp2 = await (await fetch(`${WEB}/c/demo-partner`)).text();
  check(/--font-sans:\s*&quot;Inter&quot;|--font-sans:\s*"Inter"/.test(dp2), "web: font klinik (Inter) dipakai lewat CSS variable");
  check(!/aevia/i.test(text(dp2).replace(/Syarat &amp; ketentuan/g, "")), "whitelabel: landing tanpa kata AEVIA");
  const terms = await (await fetch(`${WEB}/c/demo-partner/syarat`)).text();
  check(terms.includes("AEVIA") && terms.includes("Syarat"), "halaman syarat & ketentuan boleh menyebut AEVIA");
  check(/Sovia/.test(text(dp2)) && !text(dp2).includes("Luna"), "nama asisten baru (Luna) belum tampil sebelum disetujui");
  const queue = (await (await fetch(`${API}/v1/admin/assistants`, { headers: { authorization: `Bearer ${pa}` } })).json()).items;
  const lun = queue.find((i) => i.slug === "demo-partner");
  check(Boolean(lun) && lun.pending_name === "Luna", "admin AEVIA: antrean memuat usulan Luna");
  const adq = await (await fetch(`${CON}/admin/asisten`, { headers: paC })).text();
  check(adq.includes("Luna") && adq.includes("Setujui"), "console /admin/asisten memuat antrean + tombol Setujui");
  check((await post(`${API}/v1/admin/assistants/${lun.clinic_id}/review`, { decision: "approve", note: "" }, pa)).status === 200, "admin AEVIA: setujui nama");
  const dp3 = await (await fetch(`${WEB}/c/demo-partner`)).text();
  check(text(dp3).includes("Luna"), "setelah disetujui, nama Luna tampil di web");

  for (const [path, needle] of [["/pengaturan/brand", "Pemeriksaan keterbacaan"], ["/pengaturan/program", "Tambah program"], ["/pengaturan/staf", "Undang staf"]]) {
    const pg = await fetch(`${CON}${path}`, { headers: caC });
    check(pg.status === 200 && (await pg.text()).includes(needle), `console ${path} memuat "${needle}"`);
  }
  const denied = await fetch(`${CON}/pengaturan/brand`, { headers: sCookie, redirect: "manual" });
  check(denied.status >= 300 && denied.status < 400, "console pengaturan: profesional dialihkan");

  const nc = await post(`${API}/v1/admin/clinics`, { slug: "klinik-smoke", name: "Klinik Smoke", brand_mode: "whitelabel", admin_email: "owner@klinik-smoke.test" }, pa);
  check(nc.status === 201, "admin AEVIA: buat klinik baru");
  const ncp = await fetch(`${WEB}/c/klinik-smoke`);
  check(ncp.status === 200 && (await ncp.text()).includes("Klinik Smoke"), "slug baru langsung bisa dibuka di web");
  const klinikPage = await (await fetch(`${CON}/admin/klinik`, { headers: paC })).text();
  check(klinikPage.includes("Klinik Smoke") && klinikPage.includes("Buat klinik baru"), "console /admin/klinik memuat daftar + form");

  const hostGet = (host, path) =>
    new Promise((resolve, reject) => {
      const r = httpRequest({ host: "127.0.0.1", port: webPort, path, method: "GET", headers: { host } }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      });
      r.on("error", reject);
      r.end();
    });
  const unver = await hostGet("sehat.lumina.id", "/");
  check(unver.status === 404 || !unver.body.includes("Lumina Skin Studio"), "domain belum diverifikasi tidak dipetakan");
  const demoId = (await (await fetch(`${API}/v1/admin/clinics`, { headers: { authorization: `Bearer ${pa}` } })).json()).clinics.find((c) => c.slug === "demo-partner").id;
  check((await put(`${API}/v1/admin/clinics/${demoId}/domain`, { verified: true }, pa)).status === 200, "admin AEVIA: verifikasi domain");
  await new Promise((r) => setTimeout(r, 2500)); // cache negatif proxy 2 dtk
  const dom = await hostGet("sehat.lumina.id", "/");
  check(dom.status === 200 && dom.body.includes("Lumina Skin Studio"), "domain terverifikasi → proxy memetakan host ke klinik");

  // Phase 9: API publik integrasi
  const ik = await post(`${API}/v1/staff/integrations/api-keys`, { name: "Smoke", scopes: ["read:patients", "webhooks:manage"] }, ca);
  const ikb = await ik.json();
  check(ik.status === 201 && /^aev_live_/.test(ikb.secret), "integrasi: kunci API dibuat (rahasia tampil sekali)");
  const me9 = await fetch(`${API}/v1/integrations/me`, { headers: { authorization: `Bearer ${ikb.secret}` } });
  check(me9.status === 200 && (await me9.json()).scopes.includes("read:patients"), "integrasi: kunci API dipakai di /v1/integrations/me");
  const sum9 = await fetch(`${API}/v1/integrations/patients/${mine.patient_id}/summary`, { headers: { authorization: `Bearer ${ikb.secret}` } });
  check(sum9.status === 404, "integrasi: pasien klinik lain tak terjangkau (404)");
  const oc = await (await post(`${API}/v1/staff/integrations/oauth-clients`, { name: "Smoke OAuth", scopes: ["read:patients"] }, ca)).json();
  const tokForm = await fetch(`${API}/v1/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=client_credentials&client_id=${oc.client_id}&client_secret=${oc.client_secret}` });
  const tokB = await tokForm.json();
  check(tokForm.status === 200 && tokB.expires_in === 900, "OAuth: token client-credentials 15 menit (form)");
  check((await fetch(`${API}/v1/integrations/me`, { headers: { authorization: `Bearer ${tokB.access_token}` } })).status === 200, "OAuth: token dipakai di route integrasi");
  const intPage = await (await fetch(`${CON}/pengaturan/integrasi`, { headers: caC })).text();
  check(intPage.includes("Kunci API") && intPage.includes("aev_live_") && !intPage.includes(ikb.secret), "console /pengaturan/integrasi: daftar kunci, rahasia tidak tampil ulang");
  const spec9 = await (await fetch(`${API}/v1/openapi.json`)).json();
  check(spec9.openapi === "3.1.0" && Boolean(spec9.paths["/v1/integrations/patients/{id}/summary"]), "OpenAPI 3.1 memuat route integrasi");
  const docs9 = await fetch(`${API}/docs/`);
  check(docs9.status === 200 && !/https?:\/\/(cdn|unpkg|cdnjs)/i.test(await docs9.text()), "/docs dilayani tanpa CDN");
  const cronNo = await fetch(`${API}/v1/internal/dispatch`, { method: "POST" });
  check(cronNo.status === 401 || cronNo.status === 503, "dispatcher tanpa CRON_SECRET tidak terbuka");

  // Phase 11: konektor
  const wk = await (await post(`${API}/v1/staff/integrations/api-keys`, { name: "Konektor smoke", scopes: ["integrations:write"] }, ca)).json();
  const bcNoConsent = await post(`${API}/v1/integrations/beautycode/tracker`, { aevia_patient_id: mine.patient_id, recorded_at: new Date().toISOString(), skin_barrier: 60 }, wk.secret);
  check(bcNoConsent.status === 404, "BeautyCode: pasien klinik lain tak terjangkau (404)");
  const ksSave = await put(`${API}/v1/staff/connectors/kliniksistem`, { base_url: "https://ks.klinik-smoke.test", enabled: true, push_requested: false }, ca);
  const ksB = await ksSave.json();
  check(ksSave.status === 200 && /^kssec_/.test(ksB.secret), "konektor KlinikSistem: disimpan, rahasia tampil sekali");
  const conPage = await (await fetch(`${CON}/pengaturan/integrasi`, { headers: caC })).text();
  check(conPage.includes("Konektor") && conPage.includes("Uji koneksi") && !conPage.includes(ksB.secret), "console: bagian Konektor + Uji koneksi, rahasia tak tampil ulang");
  await put(`${API}/v1/staff/connectors/kliniksistem`, { base_url: "https://ks.klinik-smoke.test", enabled: false, push_requested: false }, ca);
  const visNo = await post(`${API}/v1/integrations/kliniksistem/visits`, { booking_id: "KS-1", status: "Completed", occurred_at: new Date().toISOString() }, wk.secret);
  check(visNo.status === 409 || visNo.status === 404, "inbound KlinikSistem: konektor nonaktif/booking tak dikenal ditolak");
  // beautycode dengan consent: pasien drmetz (konsol: kartu snapshot)
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "external_context", granted: true }) });
  const adm = await stafToken("admin@drmetz.test");
  const drk = await (await post(`${API}/v1/staff/integrations/api-keys`, { name: "BC drmetz", scopes: ["integrations:write"] }, adm)).json();
  const bcOk = await post(`${API}/v1/integrations/beautycode/tracker`, { email, recorded_at: new Date().toISOString(), skin_barrier: 71, sleep_hours: 6.5, diet_triggers: ["gula"] }, drk.secret);
  check(bcOk.status === 201, "BeautyCode: dengan consent diterima (201)");
  const snap = flat(await (await fetch(`${CON}/pasien/${mine.patient_id}`, { headers: sCookie })).text());
  check(snap.includes("Beauty Code snapshot") && snap.includes("71") && snap.includes("gula"), "console detail pasien: kartu Beauty Code snapshot");
  await fetch(`${API}/v1/me/consents`, { method: "PUT", headers: hdr, body: JSON.stringify({ scope: "external_context", granted: false }) });
  check((await post(`${API}/v1/integrations/beautycode/tracker`, { email, recorded_at: new Date().toISOString(), skin_barrier: 70 }, drk.secret)).status === 403, "BeautyCode: tanpa consent → 403");
} catch (e) {
  console.error(e);
  fails.push(String(e));
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 500));
}
console.log(fails.length ? `\nSmoke GAGAL (${fails.length})` : "\nSmoke OK");
process.exit(fails.length ? 1 : 0);
