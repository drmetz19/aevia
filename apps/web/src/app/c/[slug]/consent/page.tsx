import { notFound } from "next/navigation";
import { consentCopy, consentScopes } from "@aevia/core";
import { Lock } from "lucide-react";
import { PageIntro } from "@/components/PageIntro";
import { PatientShell } from "@/components/PatientShell";
import { fetchClinic } from "@/lib/api";
import { getConsents, requirePatient } from "@/lib/session";
import { saveConsents } from "../actions";

export default async function Consent({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ dari?: string }> }) {
  const { slug } = await params;
  const { dari } = await searchParams;
  const clinic = await fetchClinic(slug);
  if (!clinic) notFound();
  await requirePatient(slug);
  const current = await getConsents(slug);
  const decided = current.some((c) => c.decided);
  return (
    <PatientShell clinic={clinic} nav={decided} width="max-w-xl">
      <PageIntro eyebrow="Persetujuan" title="Anda yang menentukan data apa yang dibagikan">
        <p>Pilih yang nyaman bagi Anda. Persetujuan ini hanya berlaku untuk {clinic.name} dan bisa Anda ubah atau cabut kapan saja.</p>
      </PageIntro>
      <form action={saveConsents} className="mt-8 space-y-3">
        <input type="hidden" name="slug" value={clinic.slug} />
        {dari === "assessment" && <input type="hidden" name="dari" value="assessment" />}
        {consentScopes.map((scope, i) => {
          const st = current.find((c) => c.scope === scope);
          return (
            <label
              key={scope}
              style={{ "--d": i + 1 } as React.CSSProperties}
              className="reveal flex cursor-pointer items-start gap-4 rounded-lg border border-line bg-surface p-5 shadow-soft transition-colors has-[:checked]:border-navy/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand-accent)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold leading-7 text-navy">{consentCopy[scope].title}</span>
                <span className="mt-1 block text-[15px] leading-6 text-body">{consentCopy[scope].desc}</span>
                {st?.granted_at && st.granted && (
                  <span className="mt-2 inline-block rounded-pill bg-sand px-2.5 py-0.5 text-[12px] font-semibold text-navy">
                    Disetujui {new Date(st.granted_at).toLocaleDateString("id-ID", { dateStyle: "long" })}
                  </span>
                )}
                {st?.revoked_at && !st.granted && (
                  <span className="mt-2 inline-block rounded-pill border border-line px-2.5 py-0.5 text-[12px] font-semibold text-slate">
                    Dicabut {new Date(st.revoked_at).toLocaleDateString("id-ID", { dateStyle: "long" })}
                  </span>
                )}
              </span>
              <input type="checkbox" name={scope} defaultChecked={st?.granted} className="switch mt-1 focus-visible:outline-none" />
            </label>
          );
        })}
        <p className="flex items-center gap-2 px-1 pt-1 text-[13px] font-medium text-slate">
          <Lock aria-hidden="true" size={14} strokeWidth={1.75} />
          Data disimpan terpisah untuk {clinic.name}.
        </p>
        <div className={`sticky z-30 pt-2 lg:static ${decided ? "bottom-[calc(84px+env(safe-area-inset-bottom))]" : "bottom-4"}`}>
          <button type="submit" className="w-full rounded-pill bg-navy px-6 py-3.5 text-base font-semibold text-white shadow-soft transition active:scale-[0.98]">
            Simpan pilihan saya
          </button>
        </div>
      </form>
    </PatientShell>
  );
}
