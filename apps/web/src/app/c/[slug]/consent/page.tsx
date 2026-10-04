import { notFound } from "next/navigation";
import { consentCopy, consentScopes } from "@aevia/core";
import { ClinicHeader } from "@/components/ClinicHeader";
import { brandStyle, fetchClinic } from "@/lib/api";
import { getConsents, requirePatient } from "@/lib/session";
import { saveConsents } from "../actions";

export default async function Consent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const current = await getConsents(slug);
  return (
    <div style={brandStyle(clinic)} className="min-h-screen bg-ivory">
      <ClinicHeader clinic={clinic} />
      <main className="mx-auto max-w-xl px-4 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">Persetujuan</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight text-navy">Anda yang menentukan data apa yang dibagikan</h1>
        <p className="mt-3 text-base text-body">
          Pilih yang nyaman bagi Anda. Persetujuan ini hanya berlaku untuk {clinic.name} dan bisa Anda ubah atau cabut kapan saja.
        </p>
        <form action={saveConsents} className="mt-8 space-y-4">
          <input type="hidden" name="slug" value={clinic.slug} />
          {consentScopes.map((scope) => {
            const st = current.find((c) => c.scope === scope);
            return (
              <label key={scope} className="flex cursor-pointer gap-4 rounded-lg border border-line bg-white p-5 shadow-soft">
                <input type="checkbox" name={scope} defaultChecked={st?.granted} className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand-primary)]" />
                <span>
                  <span className="block text-xl font-semibold leading-7 text-navy">{consentCopy[scope].title}</span>
                  <span className="mt-1 block text-base text-body">{consentCopy[scope].desc}</span>
                  {st?.granted_at && st.granted && (
                    <span className="mt-1 block text-[13px] font-medium text-slate">
                      Disetujui {new Date(st.granted_at).toLocaleDateString("id-ID", { dateStyle: "long" })}
                    </span>
                  )}
                  {st?.revoked_at && !st.granted && (
                    <span className="mt-1 block text-[13px] font-medium text-slate">
                      Dicabut {new Date(st.revoked_at).toLocaleDateString("id-ID", { dateStyle: "long" })}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          <button type="submit" className="w-full rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">
            Simpan pilihan saya
          </button>
        </form>
      </main>
    </div>
  );
}
