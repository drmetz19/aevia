import { staffProgramListSchema, type StaffProgram } from "@aevia/core";
import { requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, Submit } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { deleteProgram, saveProgram } from "../actions";

function ProgramFields({ p }: { p?: StaffProgram }) {
  return (
    <>
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className={labelCls} htmlFor={`name-${p?.id ?? "new"}`}>Nama program</label>
      <input id={`name-${p?.id ?? "new"}`} name="name" defaultValue={p?.name} required minLength={3} className={inputCls} />
      <label className={labelCls} htmlFor={`sum-${p?.id ?? "new"}`}>Ringkasan</label>
      <textarea id={`sum-${p?.id ?? "new"}`} name="summary" defaultValue={p?.summary} rows={2} maxLength={400} className={inputCls} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor={`dur-${p?.id ?? "new"}`}>Durasi (minggu, boleh kosong)</label>
          <input id={`dur-${p?.id ?? "new"}`} name="duration_weeks" type="number" min={1} defaultValue={p?.duration_weeks ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`price-${p?.id ?? "new"}`}>Harga (Rupiah, kosong = ditentukan klinik)</label>
          <input id={`price-${p?.id ?? "new"}`} name="price_idr" type="number" min={0} defaultValue={p?.price_idr ?? ""} className={inputCls} />
        </div>
      </div>
      <label className={labelCls} htmlFor={`inc-${p?.id ?? "new"}`}>Yang termasuk (satu per baris)</label>
      <textarea id={`inc-${p?.id ?? "new"}`} name="includes" defaultValue={p?.includes.join("\n")} rows={3} className={inputCls} />
      <label className="flex items-center gap-3 text-base text-body">
        <input type="checkbox" name="active" defaultChecked={p ? p.active : true} className="h-5 w-5" />
        Tampil di katalog pasien
      </label>
    </>
  );
}

export default async function Program() {
  await requireStaff(["clinic_admin"]);
  const res = await staffFetch("/v1/staff/programs");
  const { programs } = res.ok ? staffProgramListSchema.parse(await res.json()) : { programs: [] };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Pengaturan" title="Program pendampingan" lead="Kelola katalog yang dilihat pasien. Harga ditetapkan klinik Anda." />
      <div className="mt-6" />
      <SettingsTabs current="/pengaturan/program" />
      <ul className="space-y-4">
        {programs.map((p) => (
          <li key={p.id} className="rounded-lg border border-line bg-white p-6 shadow-soft">
            <details>
              <summary className="cursor-pointer text-xl font-semibold text-navy">
                {p.name} <span className="text-[13px] font-medium text-body">{p.active ? "· Tampil" : "· Disembunyikan"}</span>
              </summary>
              <ActionForm action={saveProgram} className="mt-4 space-y-3">
                                  <>
                    <ProgramFields p={p} />
                    <Submit className={primaryCls}>Simpan perubahan</Submit>
                  </>
              </ActionForm>
              <ActionForm action={deleteProgram} className="mt-3">
                                  <>
                    <input type="hidden" name="id" value={p.id} />
                    <Submit className={ghostCls}>Hapus program</Submit>
                  </>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>
      <section aria-labelledby="baru" className="mt-8 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="baru" className="text-xl font-semibold text-navy">Tambah program</h2>
        <ActionForm action={saveProgram} className="mt-4 space-y-3">
                      <>
              <ProgramFields />
              <Submit className={primaryCls}>Tambah program</Submit>
            </>
        </ActionForm>
      </section>
    </main>
  );
}
