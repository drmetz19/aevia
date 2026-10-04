import { SCOPES, SCOPE_LABELS, deliveryViewSchema, integrationOverviewSchema } from "@aevia/core";
import { z } from "zod";
import { fmtDate, requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, Submit, inputCls, labelCls, primaryCls, ghostCls } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { createApiKey, createOauthClient, createWebhook, deleteWebhook, revokeApiKey, revokeOauthClient, testWebhook, toggleWebhook } from "../actions";

const deliveryStatus = { pending: "Menunggu percobaan ulang", delivered: "Terkirim", failed: "Belum berhasil" } as const;

function ScopeChecks({ name }: { name: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelCls}>Cakupan akses</legend>
      {SCOPES.map((s) => (
        <label key={s} className="flex items-start gap-3 text-base text-body">
          <input type="checkbox" name={name} value={s} className="mt-1 h-5 w-5" />
          <span>
            <code className="text-navy">{s}</code> — {SCOPE_LABELS[s]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export default async function Integrasi() {
  await requireStaff(["clinic_admin"]);
  const res = await staffFetch("/v1/staff/integrations");
  if (!res.ok) throw new Error("Pengaturan integrasi belum dapat dimuat.");
  const o = integrationOverviewSchema.parse(await res.json());
  const deliveries = new Map<string, z.infer<typeof deliveryViewSchema>[]>();
  for (const w of o.webhooks) {
    const r = await staffFetch(`/v1/staff/integrations/webhooks/${w.id}/deliveries`);
    deliveries.set(w.id, r.ok ? z.object({ deliveries: z.array(deliveryViewSchema) }).parse(await r.json()).deliveries : []);
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHead eyebrow="Pengaturan" title="Integrasi" lead="Hubungkan sistem lain ke klinik Anda dengan kunci API, klien OAuth, dan webhook. Rahasia hanya tampil sekali saat dibuat." />
      <div className="mt-6" />
      <SettingsTabs current="/pengaturan/integrasi" />

      <section aria-labelledby="keys" className="rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="keys" className="text-xl font-semibold text-navy">Kunci API</h2>
        {o.api_keys.length === 0 ? (
          <p className="mt-2 text-base text-body">Belum ada kunci API.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {o.api_keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-base font-semibold text-navy">{k.name} <span className="text-[13px] font-medium text-body">· {k.revoked_at ? "Dicabut" : "Aktif"}</span></p>
                  <p className="text-[13px] font-medium text-body"><code>{k.prefix}…</code> · {k.scopes.join(", ")}</p>
                  <p className="text-[13px] font-medium text-body">Dibuat {fmtDate(k.created_at)} · {k.last_used_at ? `terakhir dipakai ${fmtDate(k.last_used_at)}` : "belum pernah dipakai"}</p>
                </div>
                {!k.revoked_at && (
                  <ActionForm action={revokeApiKey} className="space-y-0">
                    <input type="hidden" name="id" value={k.id} />
                    <Submit className={ghostCls}>Cabut</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createApiKey} className="mt-4 space-y-3">
          <label htmlFor="kname" className={labelCls}>Nama kunci</label>
          <input id="kname" name="name" required minLength={2} className={inputCls} placeholder="mis. Sistem ERP" />
          <label htmlFor="kmode" className={labelCls}>Jenis</label>
          <select id="kmode" name="mode" className={inputCls}>
            <option value="live">Live (aev_live_…)</option>
            <option value="test">Uji (aev_test_…)</option>
          </select>
          <ScopeChecks name="scopes" />
          <Submit className={primaryCls}>Buat kunci API</Submit>
        </ActionForm>
      </section>

      <section aria-labelledby="oauth" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="oauth" className="text-xl font-semibold text-navy">Klien OAuth (client-credentials)</h2>
        <p className="mt-2 text-base text-body">Tukar client ID dan secret dengan token berumur 15 menit di <code>/v1/oauth/token</code>.</p>
        {o.oauth_clients.length === 0 ? (
          <p className="mt-2 text-base text-body">Belum ada klien OAuth.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {o.oauth_clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-base font-semibold text-navy">{c.name} <span className="text-[13px] font-medium text-body">· {c.revoked_at ? "Dicabut" : "Aktif"}</span></p>
                  <p className="text-[13px] font-medium text-body"><code>{c.client_id}</code> · {c.scopes.join(", ")}</p>
                </div>
                {!c.revoked_at && (
                  <ActionForm action={revokeOauthClient} className="space-y-0">
                    <input type="hidden" name="id" value={c.id} />
                    <Submit className={ghostCls}>Cabut</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createOauthClient} className="mt-4 space-y-3">
          <label htmlFor="cname" className={labelCls}>Nama klien</label>
          <input id="cname" name="name" required minLength={2} className={inputCls} />
          <ScopeChecks name="scopes" />
          <Submit className={primaryCls}>Buat klien OAuth</Submit>
        </ActionForm>
      </section>

      <section aria-labelledby="hooks" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="hooks" className="text-xl font-semibold text-navy">Webhook</h2>
        <p className="mt-2 text-base text-body">Kami mengirim kejadian ke alamat https Anda, ditandatangani dengan <code>X-Aevia-Signature</code>. Gagal terkirim akan dicoba ulang hingga 3 kali.</p>
        {o.webhooks.map((w) => (
          <article key={w.id} className="mt-4 rounded-md border border-line p-4">
            <p className="break-all text-base font-semibold text-navy">{w.url}</p>
            <p className="text-[13px] font-medium text-body">{w.active ? "Aktif" : "Nonaktif"} · {w.events.join(", ")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm action={testWebhook} className="space-y-0">
                <input type="hidden" name="id" value={w.id} />
                <Submit className={primaryCls}>Kirim tes</Submit>
              </ActionForm>
              <ActionForm action={toggleWebhook} className="space-y-0">
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="active" value={String(!w.active)} />
                <Submit className={ghostCls}>{w.active ? "Nonaktifkan" : "Aktifkan"}</Submit>
              </ActionForm>
              <ActionForm action={deleteWebhook} className="space-y-0">
                <input type="hidden" name="id" value={w.id} />
                <Submit className={ghostCls}>Hapus</Submit>
              </ActionForm>
            </div>
            <h3 className="mt-4 text-base font-semibold text-navy">Log pengiriman</h3>
            {(deliveries.get(w.id) ?? []).length === 0 ? (
              <p className="text-base text-body">Belum ada pengiriman.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[520px] text-left text-base">
                  <caption className="sr-only">Log pengiriman webhook</caption>
                  <thead className="text-[13px] font-medium text-body">
                    <tr>
                      <th scope="col" className="py-2 pr-3">Waktu</th>
                      <th scope="col" className="py-2 pr-3">Kejadian</th>
                      <th scope="col" className="py-2 pr-3">Status</th>
                      <th scope="col" className="py-2">Percobaan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(deliveries.get(w.id) ?? []).map((d) => (
                      <tr key={d.id} className="border-t border-line">
                        <td className="py-2 pr-3 text-body">{fmtDate(d.created_at)}</td>
                        <td className="py-2 pr-3 text-body">{d.event_type}</td>
                        <td className="py-2 pr-3 text-body">{deliveryStatus[d.status]}{d.last_status_code ? ` (HTTP ${d.last_status_code})` : ""}</td>
                        <td className="py-2 text-body">{d.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        ))}
        <ActionForm action={createWebhook} className="mt-4 space-y-3">
          <label htmlFor="wurl" className={labelCls}>Alamat endpoint (https)</label>
          <input id="wurl" name="url" type="url" required pattern="https://.*" placeholder="https://contoh.id/webhook" className={inputCls} />
          <fieldset className="space-y-2">
            <legend className={labelCls}>Kejadian</legend>
            {o.events.map((e) => (
              <label key={e} className="flex items-center gap-3 text-base text-body">
                <input type="checkbox" name="events" value={e} className="h-5 w-5" /> <code>{e}</code>
              </label>
            ))}
          </fieldset>
          <Submit className={primaryCls}>Tambah webhook</Submit>
        </ActionForm>
      </section>
    </main>
  );
}
