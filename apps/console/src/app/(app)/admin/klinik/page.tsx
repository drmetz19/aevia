import { adminClinicListSchema } from "@aevia/core";
import { fmtDate, requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, Submit } from "@/components/Ui";
import { createClinic, verifyDomain } from "../../pengaturan/actions";

export default async function Klinik() {
  await requireStaff(["aevia_admin"]);
  const res = await staffFetch("/v1/admin/clinics");
  const { clinics } = res.ok ? adminClinicListSchema.parse(await res.json()) : { clinics: [] };
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Admin platform" title="Klinik" lead="Buat klinik baru beserta admin pertamanya, dan verifikasi domain khusus." />
      <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-white shadow-soft">
        <table className="table-stack w-full min-w-[640px] text-left text-base">
          <caption className="sr-only">Daftar klinik</caption>
          <thead className="border-b border-line text-[13px] font-medium text-body">
            <tr>
              <th scope="col" className="px-4 py-3">Klinik</th>
              <th scope="col" className="px-4 py-3">Mode</th>
              <th scope="col" className="px-4 py-3">Domain</th>
              <th scope="col" className="px-4 py-3">Dibuat</th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><span className="font-semibold text-navy">{c.name}</span><br /><span className="text-[13px] font-medium text-body">/c/{c.slug}</span></td>
                <td data-label="Mode" className="px-4 py-3 text-body">{c.brand_mode === "whitelabel" ? "White-label" : "Co-brand"}</td>
                <td data-label="Domain" className="px-4 py-3">
                  {c.custom_domain ? (
                    <ActionForm action={verifyDomain} className="space-y-2">
                                              <>
                          <p className="text-body">{c.custom_domain} · {c.domain_verified ? "Terverifikasi" : "Menunggu verifikasi"}</p>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="verified" value={String(!c.domain_verified)} />
                          <Submit className={ghostCls}>{c.domain_verified ? "Cabut verifikasi" : "Verifikasi domain"}</Submit>
                        </>
                    </ActionForm>
                  ) : (
                    <span className="text-body">Belum ada</span>
                  )}
                </td>
                <td data-label="Dibuat" className="px-4 py-3 text-body">{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="baru" className="mt-8 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="baru" className="text-xl font-semibold text-navy">Buat klinik baru</h2>
        <ActionForm action={createClinic} className="mt-4 space-y-3">
                      <>
              <label htmlFor="cname" className={labelCls}>Nama klinik</label>
              <input id="cname" name="name" required minLength={2} className={inputCls} />
              <label htmlFor="cslug" className={labelCls}>Alamat klinik (huruf kecil, angka, tanda hubung)</label>
              <input id="cslug" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" className={inputCls} />
              <label htmlFor="cmode" className={labelCls}>Mode merek</label>
              <select id="cmode" name="brand_mode" className={inputCls}>
                <option value="cobrand">Co-brand</option>
                <option value="whitelabel">White-label</option>
              </select>
              <label htmlFor="cemail" className={labelCls}>Email admin pertama</label>
              <input id="cemail" name="admin_email" type="email" required className={inputCls} />
              <label htmlFor="caname" className={labelCls}>Nama admin pertama (opsional)</label>
              <input id="caname" name="admin_name" className={inputCls} />
              <Submit className={primaryCls}>Buat klinik</Submit>
            </>
        </ActionForm>
      </section>
    </main>
  );
}
