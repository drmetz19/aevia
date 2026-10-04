export interface OtpSender {
  send(msg: { email: string; code: string; purpose: "patient" | "staff"; clinicSlug?: string }): Promise<void>;
}

/** Adapter dev: kode OTP tampil di log API. Produksi: ganti dengan adapter penyedia email. */
export const consoleOtpSender: OtpSender = {
  async send({ email, code, purpose, clinicSlug }) {
    console.log(`[OTP] ${purpose}${clinicSlug ? `@${clinicSlug}` : ""} ${email} kode=${code}`);
  },
};
