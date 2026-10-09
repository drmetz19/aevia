import { SCOPES, SCOPE_LABELS, connectorOverviewSchema, deliveryViewSchema, integrationOverviewSchema } from "@aevia/core";
import { z } from "zod";
import { fmtDate, requireStaff, staffFetch } from "@/lib/api";
import { PageHead, ActionForm, Submit, inputCls, labelCls, primaryCls, ghostCls } from "@/components/Ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { saveBeautycode, saveKliniksistem, syncBeautycode, testKliniksistem, createApiKey, createOauthClient, createWebhook, deleteWebhook, revokeApiKey, revokeOauthClient, testWebhook, toggleWebhook } from "../actions";

const deliveryStatus = { pending: "Menunggu percobaan ulang", delivered: "Terkirim", failed: "Belum berhasil" } as const;

function ScopeChecks({ name }: { name: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelCls}>Cakupan akses</legend>
      {SCOPES.map((s) => (
        <label key={s} className="flex min-h-11 items-start gap-3 py-1 text-base text-body">
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
  const cr = await staffFetch("/v1/staff/connectors");
  const con = cr.ok ? connectorOverviewSchema.parse(await cr.json()) : { connectors: [], deliveries: [] };
  const ks = con.connectors.find((c) => c.kind === "kliniksistem");
  const bc = con.connectors.find((c) => c.kind === "beautycode");
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
                <table className="table-stack table-stack-flush mt-2 w-full min-w-[520px] text-left text-base">
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
                        <td data-label="Waktu" className="py-2 pr-3 text-body">{fmtDate(d.created_at)}</td>
                        <td data-label="Kejadian" className="py-2 pr-3 text-body">{d.event_type}</td>
                        <td data-label="Status" className="py-2 pr-3 text-body">{deliveryStatus[d.status]}{d.last_status_code ? ` (HTTP ${d.last_status_code})` : ""}</td>
                        <td data-label="Percobaan" className="py-2 text-body">{d.attempts}</td>
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
              <label key={e} className="flex min-h-11 items-center gap-3 text-base text-body">
                <input type="checkbox" name="events" value={e} className="h-5 w-5" /> <code>{e}</code>
              </label>
            ))}
          </fieldset>
          <Submit className={primaryCls}>Tambah webhook</Submit>
        </ActionForm>
      </section>

      <section aria-labelledby="konektor" className="mt-6 rounded-lg border border-line bg-white p-6 shadow-soft">
        <h2 id="konektor" className="text-xl font-semibold text-navy">Konektor</h2>
        <p className="mt-2 text-base text-body">Hubungkan KlinikSistem (jadwal dan kunjungan) dan Beauty Code (catatan harian pasien). Kontrak lengkap ada di docs/integrasi.</p>

        <h3 className="mt-6 text-lg font-semibold text-navy">KlinikSistem</h3>
        <p className="mt-1 text-[13px] font-medium text-body">
          {ks?.configured ? (ks.enabled ? "Aktif" : "Dinonaktifkan") : "Belum diatur"}
          {ks?.last_sync_at ? ` · sinkron terakhir ${fmtDate(ks.last_sync_at)}` : ""}
        </p>
        <ActionForm action={saveKliniksistem} className="mt-3 space-y-3">
          <label htmlFor="ksurl" className={labelCls}>Alamat dasar KlinikSistem (https)</label>
          <input id="ksurl" name="base_url" type="url" required pattern="https://.*" defaultValue={ks?.base_url ?? ""} placeholder="https://kliniksistem.klinikanda.id" className={inputCls} />
          <p className="text-[13px] font-medium text-body">Booking dikirim ke <code>/aevia/bookings</code> dengan tanda tangan <code>X-Aevia-Signature</code>.</p>
          <label className="flex min-h-11 items-center gap-3 text-base text-body"><input type="checkbox" name="enabled" defaultChecked={ks?.enabled ?? true} className="h-5 w-5" /> Aktifkan pengiriman booking</label>
          <label className="flex min-h-11 items-center gap-3 text-base text-body"><input type="checkbox" name="push_requested" defaultChecked={ks?.push_requested ?? false} className="h-5 w-5" /> Kirim juga saat permintaan konsultasi masuk (sebelum dijadwalkan)</label>
          {ks?.has_secret && <label className="flex min-h-11 items-center gap-3 text-base text-body"><input type="checkbox" name="rotate_secret" className="h-5 w-5" /> Putar rahasia penandatangan (rahasia lama tidak berlaku lagi)</label>}
          <Submit className={primaryCls}>Simpan konektor</Submit>
        </ActionForm>
        {ks?.configured && (
          <ActionForm action={testKliniksistem} className="mt-3 space-y-0">
            <Submit className={ghostCls}>Uji koneksi</Submit>
          </ActionForm>
        )}
        {con.deliveries.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="table-stack table-stack-flush w-full min-w-[520px] text-left text-base">
              <caption className="sr-only">Pengiriman ke KlinikSistem</caption>
              <thead className="text-[13px] font-medium text-body">
                <tr>
                  <th scope="col" className="py-2 pr-3">Waktu</th>
                  <th scope="col" className="py-2 pr-3">Kejadian</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
                  <th scope="col" className="py-2">Booking</th>
                </tr>
              </thead>
              <tbody>
                {con.deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td data-label="Waktu" className="py-2 pr-3 text-body">{fmtDate(d.created_at)}</td>
                    <td data-label="Kejadian" className="py-2 pr-3 text-body">{d.event_type}</td>
                    <td data-label="Status" className="py-2 pr-3 text-body">{deliveryStatus[d.status]}{d.last_status_code ? ` (HTTP ${d.last_status_code})` : ""}</td>
                    <td data-label="Booking" className="py-2 text-body">{d.external_ref ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mt-8 text-lg font-semibold text-navy">Beauty Code</h3>
        <p className="mt-1 text-base text-body">AEVIA menarik ringkasan tracker harian (tidur, kondisi kulit, energi, stres, mood, air, aktivitas) dari Beauty Code setiap jam, <strong className="font-semibold text-navy">hanya untuk pasien yang menyetujui berbagi konteks dari aplikasi lain</strong> dan terhubung ke klinik di Beauty Code. Foto tidak pernah ditarik.</p>
        <ActionForm action={saveBeautycode} className="mt-3 space-y-3">
          <label htmlFor="bcurl" className={labelCls}>Alamat Beauty Code</label>
          <input id="bcurl" name="pull_base_url" type="url" defaultValue={bc?.base_url ?? "https://www.aginggracefully.online"} placeholder="https://www.aginggracefully.online" className={inputCls} />
          <label htmlFor="bcclinic" className={labelCls}>ID klinik di Beauty Code</label>
          <input id="bcclinic" name="pull_clinic_id" defaultValue={bc?.remote_clinic_id ?? ""} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputCls} />
          <label htmlFor="bckey" className={labelCls}>Kunci API Beauty Code (izin <code>tracker:read</code>)</label>
          <input id="bckey" name="api_key" type="password" autoComplete="off" placeholder={bc?.has_secret ? "Tersimpan. Isi hanya untuk mengganti." : "Tempel kunci dari Admin Beauty Code → Klinik"} className={inputCls} />
          <label className="flex min-h-11 items-center gap-3 text-base text-body"><input type="checkbox" name="enabled" defaultChecked={bc?.enabled ?? true} className="h-5 w-5" /> Aktifkan Beauty Code (sinkron otomatis + terima kiriman)</label>
          <Submit className={primaryCls}>Simpan</Submit>
        </ActionForm>
        {bc?.base_url && bc.remote_clinic_id && bc.has_secret && (
          <div className="mt-4 space-y-3 rounded-md border border-line p-4">
            <p className="text-[13px] font-medium text-body">
              Sinkron terakhir:{" "}
              {bc.last_pull ? (
                <span className={bc.last_pull.ok ? "text-success" : "text-critical"}>{fmtDate(bc.last_pull.at)} · {bc.last_pull.message}</span>
              ) : (
                "belum pernah"
              )}
            </p>
            <ActionForm action={syncBeautycode} className="space-y-3">
              <Submit className={ghostCls}>Sinkron sekarang</Submit>
            </ActionForm>
          </div>
        )}
        <p className="mt-4 text-[13px] font-medium text-body">Cara lain: Beauty Code juga bisa mengirim catatan langsung dengan kunci API AEVIA bercakupan <code>integrations:write</code> (bagian Kunci API di atas).</p>
      </section>
    </main>
  );
}
