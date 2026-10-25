import { staffProgramListSchema, staffVoucherListSchema, type StaffVoucher, type VoucherStatus } from "@aevia/core";
import { requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, dangerCls, Submit } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { createVoucher, setVoucherActive } from "../actions";

const BADGE: Record<VoucherStatus, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "border-[#047857]/30 bg-[#D1FAE5] text-[#047857]" },
  inactive: { label: "Nonaktif", cls: "border-line bg-sand text-body" },
  expired: { label: "Kedaluwarsa", cls: "border-[#BE123C]/30 bg-[#FFE4E6] text-[#BE123C]" },
  exhausted: { label: "Habis", cls: "border-[#B45309]/30 bg-[#FEF3C7] text-[#B45309]" },
};
const day = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

function Row({ v }: { v: StaffVoucher }) {
  const b = BADGE[v.status];
  return (
    <tr className="border-b border-line last:border-0">
      <td data-label="Kode" className="px-4 py-3 font-mono text-base font-semibold text-navy [overflow-wrap:anywhere]">{v.code}</td>
      <td data-label="Program" className="px-4 py-3 text-body">{v.program_name ?? "Semua program"}</td>
      <td data-label="Terpakai" className="px-4 py-3 font-mono tabular-nums text-navy">{v.used_count}/{v.max_uses ?? "∞"}</td>
      <td data-label="Kedaluwarsa" className="px-4 py-3 text-body">{v.expires_at ? day.format(new Date(v.expires_at)) : "Tanpa batas"}</td>
      <td data-label="Status" className="px-4 py-3">
        <span className={`inline-flex rounded-pill border px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>{b.label}</span>
      </td>
      <td className="px-4 py-3">
        <ActionForm action={setVoucherActive} className="space-y-2">
          <>
            <input type="hidden" name="id" value={v.id} />
            <input type="hidden" name="active" value={v.active ? "false" : "true"} />
            <Submit className={v.active ? dangerCls : ghostCls} confirm={v.active ? `Nonaktifkan voucher ${v.code}? Pasien tidak bisa memakainya lagi.` : undefined}>
              {v.active ? "Nonaktifkan" : "Aktifkan"}
            </Submit>
          </>
        </ActionForm>
      </td>
    </tr>
  );
}

export default async function Voucher() {
  await requireStaff(["clinic_admin"]);
  const [vRes, pRes] = await Promise.all([staffFetch("/v1/staff/vouchers"), staffFetch("/v1/staff/programs")]);
  const { vouchers } = vRes.ok ? staffVoucherListSchema.parse(await vRes.json()) : { vouchers: [] };
  const { programs } = pRes.ok ? staffProgramListSchema.parse(await pRes.json()) : { programs: [] };
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Pengaturan" title="Voucher akses program" lead="Bagikan kode kepada pasien untuk program yang bertanda “Perlu kode voucher”. Kode tidak membedakan huruf besar atau kecil." />
      <div className="mt-6" />
      <SettingsTabs current="/pengaturan/voucher" />

      <section aria-labelledby="baru" className="rounded-lg border border-line bg-white p-4 md:p-6">
        <h2 id="baru" className="text-xl font-semibold text-navy">Buat voucher</h2>
        <ActionForm action={createVoucher} className="mt-4 space-y-3">
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="v-code">Kode</label>
                <input id="v-code" name="code" required minLength={4} maxLength={32} pattern="[A-Za-z0-9\-]{4,32}" autoCapitalize="characters" autoComplete="off" aria-describedby="v-code-h" className={`${inputCls} font-mono uppercase`} />
                <p id="v-code-h" className="mt-1 text-[13px] text-slate">4–32 karakter: huruf, angka, atau tanda hubung.</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="v-prog">Program</label>
                <select id="v-prog" name="program_id" defaultValue="" className={inputCls}>
                  <option value="">Semua program</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="v-max">Kuota</label>
                <input id="v-max" name="max_uses" type="number" min={1} aria-describedby="v-max-h" className={inputCls} />
                <p id="v-max-h" className="mt-1 text-[13px] text-slate">Kosong = tanpa batas pemakaian.</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="v-exp">Berlaku sampai</label>
                <input id="v-exp" name="expires_on" type="date" aria-describedby="v-exp-h" className={inputCls} />
                <p id="v-exp-h" className="mt-1 text-[13px] text-slate">Kosong = tanpa batas waktu.</p>
              </div>
            </div>
            <Submit className={primaryCls}>Buat voucher</Submit>
          </>
        </ActionForm>
      </section>

      {vouchers.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-white p-6 text-base text-body">Belum ada voucher. Buat satu di atas untuk mulai membagikan akses.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="table-stack w-full min-w-[720px] text-left text-base">
            <caption className="sr-only">Daftar voucher klinik</caption>
            <thead className="border-b border-line text-[13px] font-medium text-body">
              <tr>
                <th scope="col" className="px-4 py-3">Kode</th>
                <th scope="col" className="px-4 py-3">Program</th>
                <th scope="col" className="px-4 py-3">Terpakai</th>
                <th scope="col" className="px-4 py-3">Kedaluwarsa</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <Row key={v.id} v={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
