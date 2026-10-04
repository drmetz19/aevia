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

/** RESEND_API_KEY + OTP_FROM_EMAIL → email sungguhan. Selain itu kode tampil di log (hanya untuk dev). Produksi tanpa email → galat saat start. */
export function otpSenderFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: typeof fetch): OtpSender {
  if (env.RESEND_API_KEY) {
    if (!env.OTP_FROM_EMAIL) throw new Error("OTP_FROM_EMAIL wajib diisi bila RESEND_API_KEY diatur (mis. 'Klinik <masuk@domain.id>').");
    return resendOtpSender({ apiKey: env.RESEND_API_KEY, from: env.OTP_FROM_EMAIL, fetchFn });
  }
  if (env.NODE_ENV === "production") throw new Error("Pengirim email OTP belum diatur: isi RESEND_API_KEY dan OTP_FROM_EMAIL.");
  return consoleOtpSender;
}
