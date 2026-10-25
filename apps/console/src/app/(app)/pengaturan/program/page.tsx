import { staffProgramListSchema, type StaffProgram } from "@aevia/core";
import { requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, dangerCls, Submit } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { deleteProgram, saveProgram } from "../actions";

function Choice({ id, name, legend, value, options }: { id: string; name: string; legend: string; value: string; options: [string, string][] }) {
  return (
    <fieldset>
      <legend className={labelCls}>{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([v, label]) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-4 text-base text-navy has-[:checked]:border-copper has-[:checked]:bg-[#ECFEFF] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand-accent)]">
            <input type="radio" name={name} value={v} defaultChecked={value === v} id={`${id}-${v}`} className="h-4 w-4 accent-[var(--brand-primary-action)]" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ProgramFields({ p }: { p?: StaffProgram }) {
  const uid = p?.id ?? "new";
  return (
    <>
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className={labelCls} htmlFor={`name-${p?.id ?? "new"}`}>Nama program</label>
      <input id={`name-${p?.id ?? "new"}`} name="name" defaultValue={p?.name} required minLength={3} className={inputCls} />
      <label className={labelCls} htmlFor={`sum-${p?.id ?? "new"}`}>Ringkasan</label>
      <textarea id={`sum-${p?.id ?? "new"}`} name="summary" defaultValue={p?.summary} rows={2} maxLength={400} className={inputCls} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor={`dur-${uid}`}>Durasi (minggu)</label>
          <input id={`dur-${uid}`} name="duration_weeks" type="number" min={1} defaultValue={p?.duration_weeks ?? ""} aria-describedby={`dur-h-${uid}`} className={inputCls} />
          <p id={`dur-h-${uid}`} className="mt-1 text-[13px] text-slate">Boleh kosong.</p>
        </div>
        <div>
          <label className={labelCls} htmlFor={`price-${uid}`}>Harga</label>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base text-slate">Rp</span>
            <input id={`price-${uid}`} name="price_idr" type="number" min={0} defaultValue={p?.price_idr ?? ""} aria-describedby={`price-h-${uid}`} className={`${inputCls} pl-11`} />
          </div>
          <p id={`price-h-${uid}`} className="mt-1 text-[13px] text-slate">Kosong = ditentukan klinik. Tidak tampil ke pasien bila “Segera hadir”.</p>
        </div>
      </div>
      <Choice id={`mode-${uid}`} name="price_mode" legend="Tampilan harga" value={p?.price_mode ?? "amount"} options={[["amount", "Tampilkan harga"], ["coming_soon", "Segera hadir"]]} />
      <Choice id={`acc-${uid}`} name="access" legend="Akses" value={p?.access ?? "open"} options={[["open", "Terbuka"], ["voucher", "Perlu kode voucher"]]} />
      <label className={labelCls} htmlFor={`inc-${p?.id ?? "new"}`}>Yang termasuk (satu per baris)</label>
      <textarea id={`inc-${p?.id ?? "new"}`} name="includes" defaultValue={p?.includes.join("\n")} rows={3} className={inputCls} />
      <label className="flex items-center gap-3 text-base text-body">
        <input type="checkbox" name="active" defaultChecked={p ? p.active : true} className="h-5 w-5 accent-[var(--brand-primary-action)]" />
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
          <li key={p.id} className="rounded-lg border border-line bg-white p-4 md:p-6">
            <details>
              <summary className="cursor-pointer text-xl font-semibold text-navy">
                {p.name} <span className="text-[13px] font-medium text-body">{p.active ? "· Tampil" : "· Disembunyikan"}{p.price_mode === "coming_soon" ? " · Segera hadir" : ""}{p.access === "voucher" ? " · Perlu voucher" : ""}</span>
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
                    <Submit className={dangerCls} confirm={`Hapus program “${p.name}”? Tindakan ini tidak dapat dibatalkan.`}>Hapus program</Submit>
                  </>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>
      <section aria-labelledby="baru" className="mt-8 rounded-lg border border-line bg-white p-4 md:p-6">
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
