export interface OtpSender {
  send(msg: { email: string; code: string; purpose: "patient" | "staff"; clinicSlug?: string }): Promise<void>;
}

/** Adapter dev: kode OTP tampil di log API. Produksi: ganti dengan adapter penyedia email. */
export const consoleOtpSender: OtpSender = {
  async send({ email, code, purpose, clinicSlug }) {
    console.log(`[OTP] ${purpose}${clinicSlug ? `@${clinicSlug}` : ""} ${email} kode=${code}`);
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
    async send({ email, code }) {
      const res = await (o.fetchFn ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: o.from,
          to: [email],
          subject: "Kode masuk Anda",
          text: `Kode masuk Anda: ${code}\n\nKode berlaku 10 menit. Jika Anda tidak meminta kode ini, abaikan email ini.`,
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
    async send({ email, code }) {
      const body = new URLSearchParams({
        api_token: o.apiToken,
        from_name: name,
        from_email: fromEmail,
        recipient: email,
        subject: "Kode masuk Anda",
        content: `<p>Kode masuk Anda: <strong style="font-size:20px;letter-spacing:2px">${code}</strong></p><p>Kode berlaku 10 menit. Jika Anda tidak meminta kode ini, abaikan email ini.</p>`,
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
