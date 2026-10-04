import { brandSettingsSchema } from "@aevia/core";
import { publicFileUrl, requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, Submit } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { BrandForm } from "./BrandForm";
import { proposeAssistant, removeLogo, setLlm, uploadLogo } from "../actions";

const statusText = { pending: "Menunggu persetujuan", approved: "Disetujui", rejected: "Belum disetujui" } as const;

export default async function Brand() {
  await requireStaff(["clinic_admin"]);
  const res = await staffFetch("/v1/staff/brand");
  if (!res.ok) throw new Error("Pengaturan merek belum dapat dimuat.");
  const b = brandSettingsSchema.parse(await res.json());
  const a = b.assistant;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Pengaturan" title="Merek & asisten" lead={`Atur tampilan halaman ${b.name}. Warna diperiksa otomatis agar tetap mudah dibaca.`} />
      <div className="mt-6" />
      <SettingsTabs current="/pengaturan/brand" />

      <section aria-labelledby="logo" className="rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="logo" className="text-xl font-semibold text-navy">Logo</h2>
        {b.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={publicFileUrl(b.logo_url)} alt={`Logo ${b.name}`} className="mt-3 h-16 w-16 rounded-pill object-cover" />
        )}
        <ActionForm action={uploadLogo} className="mt-3 space-y-3">
                      <>
              <label htmlFor="logo-file" className={labelCls}>Berkas logo (PNG atau WebP, maksimal 1 MB)</label>
              <input id="logo-file" name="file" type="file" accept="image/png,image/webp" className={inputCls} />
              <Submit className={primaryCls}>Unggah logo</Submit>
            </>
        </ActionForm>
        {b.logo_url && (
          <ActionForm action={removeLogo} className="mt-3">
            <Submit className={ghostCls}>Hapus logo</Submit>
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="merek" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="merek" className="text-xl font-semibold text-navy">Warna, font, dan domain</h2>
        <div className="mt-4"><BrandForm b={b} /></div>
      </section>

      <section aria-labelledby="asisten" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="asisten" className="text-xl font-semibold text-navy">Nama & avatar asisten</h2>
        <p className="mt-2 text-base text-body">
          Saat ini pasien melihat nama <strong>{a.name}</strong>. Status usulan: {statusText[a.status]}
          {a.pending_name ? ` (“${a.pending_name}”)` : ""}.
        </p>
        {a.status === "rejected" && a.review_note && <p className="mt-2 text-base text-body">Catatan tim AEVIA: {a.review_note}</p>}
        <ActionForm action={proposeAssistant} className="mt-4 space-y-3">
                      <>
              <label htmlFor="name" className={labelCls}>Usulan nama baru</label>
              <input id="name" name="name" maxLength={30} className={inputCls} autoComplete="off" />
              <label htmlFor="avatar" className={labelCls}>Usulan avatar (PNG atau WebP, maksimal 1 MB)</label>
              <input id="avatar" name="file" type="file" accept="image/png,image/webp" className={inputCls} />
              <Submit className={primaryCls}>Ajukan untuk ditinjau</Submit>
            </>
        </ActionForm>
      </section>

      <section aria-labelledby="llm" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="llm" className="text-xl font-semibold text-navy">Percakapan asisten dengan AI generatif</h2>
        <p className="mt-2 text-base text-body">
          {b.llm_available
            ? "Bila dinyalakan, asisten memakai model bahasa untuk percakapan; pagar pengaman klinis tetap aktif."
            : "Belum tersedia: layanan belum memiliki kunci layanan AI. Asisten tetap berjalan dengan alur terpandu."}
        </p>
        <ActionForm action={setLlm} className="mt-4">
                      <>
              <input type="hidden" name="enabled" value={String(!b.llm_enabled)} />
              <Submit disabled={(!b.llm_enabled && !b.llm_available)} className={primaryCls}>
                {b.llm_enabled ? "Matikan percakapan AI" : "Nyalakan percakapan AI"}
              </Submit>
            </>
        </ActionForm>
      </section>
    </main>
  );
}
