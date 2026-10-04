import { assistantQueueSchema } from "@aevia/core";
import { fmtDate, publicFileUrl, requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, inputCls, labelCls, primaryCls, ghostCls, Submit } from "@/components/Ui";
import { reviewAssistant } from "../../pengaturan/actions";

export default async function Asisten() {
  await requireStaff(["aevia_admin"]);
  const res = await staffFetch("/v1/admin/assistants");
  const { items } = res.ok ? assistantQueueSchema.parse(await res.json()) : { items: [] };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Admin platform" title="Persetujuan nama asisten" lead="Nama dan avatar baru baru tampil di web klinik setelah disetujui di sini." />
      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-white p-6 text-base text-body">Tidak ada usulan yang menunggu.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {items.map((i) => (
            <li key={i.clinic_id} className="rounded-lg border border-line bg-white p-6 shadow-soft">
              <h2 className="text-xl font-semibold text-navy">{i.clinic_name}</h2>
              <p className="mt-1 text-base text-body">
                Nama saat ini <strong>{i.current_name}</strong>
                {i.pending_name ? <> → usulan <strong>{i.pending_name}</strong></> : null}
                {i.submitted_at ? ` · diajukan ${fmtDate(i.submitted_at)}` : ""}
              </p>
              {i.has_pending_avatar && (
                <p className="mt-2 text-base text-body">
                  Avatar baru diajukan:{" "}
                  <a className="font-semibold text-copper-ink underline underline-offset-4" href={publicFileUrl(`/v1/admin/assistants/${i.clinic_id}/avatar`)}>
                    lihat berkas
                  </a>
                </p>
              )}
              <ActionForm action={reviewAssistant} className="mt-4 space-y-3">
                                  <>
                    <input type="hidden" name="id" value={i.clinic_id} />
                    <label htmlFor={`note-${i.clinic_id}`} className={labelCls}>Catatan (wajib diisi bila menolak)</label>
                    <input id={`note-${i.clinic_id}`} name="note" className={inputCls} />
                    <div className="flex gap-3">
                      <Submit name="decision" value="approve" className={primaryCls}>Setujui</Submit>
                      <Submit name="decision" value="reject" className={ghostCls}>Tolak</Submit>
                    </div>
                  </>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
