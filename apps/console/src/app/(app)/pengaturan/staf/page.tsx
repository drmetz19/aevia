import { teamListSchema } from "@aevia/core";
import { requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, Submit } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { inviteStaff, setStaffActive } from "../actions";

const roleLabel = { professional: "Profesional", clinic_admin: "Admin klinik" } as const;

export default async function Staf() {
  await requireStaff(["clinic_admin"]);
  const res = await staffFetch("/v1/staff/team");
  const { members } = res.ok ? teamListSchema.parse(await res.json()) : { members: [] };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Pengaturan" title="Staf klinik" lead="Undang profesional atau admin baru, dan atur akses mereka. Staf yang dinonaktifkan langsung tidak dapat masuk." />
      <div className="mt-6" />
      <SettingsTabs current="/pengaturan/staf" />
      <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-soft">
        <table className="w-full min-w-[560px] text-left text-base">
          <caption className="sr-only">Daftar staf klinik</caption>
          <thead className="border-b border-line text-[13px] font-medium text-body">
            <tr>
              <th scope="col" className="px-4 py-3">Nama</th>
              <th scope="col" className="px-4 py-3">Peran</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Akses</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><span className="font-semibold text-navy">{m.name}</span><br /><span className="text-[13px] font-medium text-body">{m.email}</span></td>
                <td className="px-4 py-3 text-body">{roleLabel[m.role]}</td>
                <td className="px-4 py-3 text-body">{m.active ? "Aktif" : "Nonaktif"}</td>
                <td className="px-4 py-3">
                  <ActionForm action={setStaffActive} className="space-y-2">
                                          <>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="active" value={String(!m.active)} />
                        <Submit className={ghostCls}>{m.active ? "Nonaktifkan" : "Aktifkan"}</Submit>
                      </>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="undang" className="mt-8 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="undang" className="text-xl font-semibold text-navy">Undang staf</h2>
        <ActionForm action={inviteStaff} className="mt-4 space-y-3">
                      <>
              <label htmlFor="iname" className={labelCls}>Nama</label>
              <input id="iname" name="name" required minLength={2} className={inputCls} />
              <label htmlFor="iemail" className={labelCls}>Email</label>
              <input id="iemail" name="email" type="email" required className={inputCls} />
              <label htmlFor="irole" className={labelCls}>Peran</label>
              <select id="irole" name="role" className={inputCls}>
                <option value="professional">Profesional</option>
                <option value="clinic_admin">Admin klinik</option>
              </select>
              <Submit className={primaryCls}>Undang</Submit>
            </>
        </ActionForm>
      </section>
    </main>
  );
}
