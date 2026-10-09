export type MailMessage =
  | { email: string; code: string; purpose: "patient" | "staff"; clinicSlug?: string; link?: undefined }
  | { email: string; link: string; purpose: "password_set" | "password_reset"; code?: undefined; clinicSlug?: undefined };

export interface OtpSender {
  send(msg: MailMessage): Promise<void>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Isi email netral tanpa merek (aman untuk klinik white-label). Kode/link tidak pernah dicatat ke log produksi. */
export function composeMail(m: MailMessage): { subject: string; text: string; html: string } {
  if (m.purpose === "password_set" || m.purpose === "password_reset") {
    const set = m.purpose === "password_set";
    const subject = set ? "Atur password akun staf Anda" : "Atur ulang password Anda";
    const intro = set ? "Akun staf Anda sudah dibuat. Buat password untuk masuk ke console:" : "Kami menerima permintaan untuk mengatur ulang password Anda:";
    const ttl = set ? "Link berlaku 72 jam dan hanya bisa dipakai sekali." : "Link berlaku 60 menit dan hanya bisa dipakai sekali.";
    const tail = "Jika Anda tidak meminta ini, abaikan email ini.";
    return {
      subject,
      text: `${intro}\n${m.link}\n\n${ttl}\n${tail}`,
      html: `<p>${intro}</p><p><a href="${esc(m.link)}" style="display:inline-block;padding:12px 20px;background:#0B1F3A;color:#ffffff;border-radius:36px;text-decoration:none;font-weight:600">${set ? "Buat password" : "Atur ulang password"}</a></p><p style="font-size:13px;color:#3A4A5E">Atau salin link ini: ${esc(m.link)}</p><p style="font-size:13px;color:#3A4A5E">${ttl} ${tail}</p>`,
    };
  }
  return {
    subject: "Kode masuk Anda",
    text: `Kode masuk Anda: ${m.code}\n\nKode berlaku 10 menit. Jika Anda tidak meminta kode ini, abaikan email ini.`,
    html: `<p>Kode masuk Anda: <strong style="font-size:20px;letter-spacing:2px">${esc(m.code ?? "")}</strong></p><p>Kode berlaku 10 menit. Jika Anda tidak meminta kode ini, abaikan email ini.</p>`,
  };
}

/** Adapter dev: kode OTP tampil di log API. Produksi: ganti dengan adapter penyedia email. */
export const consoleOtpSender: OtpSender = {
  async send(m) {
    if (m.link) console.log(`[LINK] ${m.purpose} ${m.email} link=${m.link}`);
    else console.log(`[OTP] ${m.purpose}${m.clinicSlug ? `@${m.clinicSlug}` : ""} ${m.email} kode=${m.code}`);
  },
};

export interface ResendOptions {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
}

/**
 * Pengirim email lewat Resend (HTTP). Teks netral tanpa merek (aman untuk klinik white-label).
 * Galat penyedia dilempar sebagai galat umum; kode OTP tidak pernah dicatat ke log.
 */
export function resendOtpSender(o: ResendOptions): OtpSender {
  return {
    async send(m) {
      const { subject, text } = composeMail(m);
      const res = await (o.fetchFn ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: o.from,
          to: [m.email],
          subject,
          text,
        }),
      });
      if (!res.ok) throw new Error(`Pengiriman email gagal (HTTP ${res.status}).`);
    },
  };
}

export interface MailketingOptions {
  apiToken: string;
  /** Format "Nama <email@domain>" atau email saja. Email harus terdaftar di menu Add Domain Mailketing. */
  from: string;
  fetchFn?: typeof fetch;
}

/** Pisahkan "Nama <email>" → { name, email }. */
export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1] || m[2]!, email: m[2]! };
  return { name: from.trim(), email: from.trim() };
}

/**
 * Pengirim email lewat Mailketing (POST form-urlencoded ke /api/v1/send).
 * Mailketing menjawab HTTP 200 juga saat gagal, jadi status JSON wajib dicek.
 */
export function mailketingOtpSender(o: MailketingOptions): OtpSender {
  const { name, email: fromEmail } = parseFrom(o.from);
  return {
    async send(m) {
      const { subject, html } = composeMail(m);
      const body = new URLSearchParams({
        api_token: o.apiToken,
        from_name: name,
        from_email: fromEmail,
        recipient: m.email,
        subject,
        content: html,
      });
      const res = await (o.fetchFn ?? fetch)("https://api.mailketing.co.id/api/v1/send", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`Pengiriman email gagal (HTTP ${res.status}).`);
      let data: { status?: string; response?: string } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error("Pengiriman email gagal (jawaban Mailketing tidak terbaca).");
      }
      if (data.status !== "success") throw new Error(`Pengiriman email gagal (Mailketing: ${data.response ?? "tidak diketahui"}).`);
    },
  };
}

/**
 * Urutan: MAILKETING_API_TOKEN → RESEND_API_KEY → (dev) log. Keduanya butuh OTP_FROM_EMAIL.
 * Produksi tanpa pengirim email → galat saat start.
 */
export function otpSenderFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: typeof fetch): OtpSender {
  if (env.MAILKETING_API_TOKEN) {
    if (!env.OTP_FROM_EMAIL) throw new Error("OTP_FROM_EMAIL wajib diisi bila MAILKETING_API_TOKEN diatur (mis. 'Klinik <masuk@domain.id>').");
    return mailketingOtpSender({ apiToken: env.MAILKETING_API_TOKEN, from: env.OTP_FROM_EMAIL, fetchFn });
  }
  if (env.RESEND_API_KEY) {
    if (!env.OTP_FROM_EMAIL) throw new Error("OTP_FROM_EMAIL wajib diisi bila RESEND_API_KEY diatur (mis. 'Klinik <masuk@domain.id>').");
    return resendOtpSender({ apiKey: env.RESEND_API_KEY, from: env.OTP_FROM_EMAIL, fetchFn });
  }
  if (env.NODE_ENV === "production") throw new Error("Pengirim email OTP belum diatur: isi MAILKETING_API_TOKEN (atau RESEND_API_KEY) dan OTP_FROM_EMAIL.");
  return consoleOtpSender;
}
