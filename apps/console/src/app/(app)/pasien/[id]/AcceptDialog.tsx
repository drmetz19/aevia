"use client";

import { useActionState, useRef } from "react";
import { acceptRequestAction, type AcceptState } from "../../../actions";

export function AcceptDialog({ requestId, patientId }: { requestId: string; patientId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptRequestAction, {});
  const input = "mt-1 w-full rounded-md border border-line bg-ivory px-4 py-3 text-base text-navy";
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">
        Terima dan jadwalkan
      </button>
      <dialog ref={ref} aria-labelledby={`t-${requestId}`} className="m-auto w-[min(92vw,440px)] rounded-lg border border-line bg-white p-6 shadow-soft backdrop:bg-black/40">
        <h3 id={`t-${requestId}`} className="text-xl font-semibold leading-7 text-navy">Jadwalkan konsultasi</h3>
        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="patient_id" value={patientId} />
          <div>
            <label htmlFor={`w-${requestId}`} className="block text-[13px] font-medium text-navy">Tanggal dan jam (WIB)</label>
            <input id={`w-${requestId}`} name="scheduled_local" type="datetime-local" required className={input} />
          </div>
          <div>
            <label htmlFor={`u-${requestId}`} className="block text-[13px] font-medium text-navy">Tautan Google Meet atau Zoom</label>
            <input id={`u-${requestId}`} name="meeting_url" type="url" required placeholder="https://meet.google.com/..." className={input} />
          </div>
          {state.error && <p role="alert" className="text-base text-critical">{state.error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="rounded-pill bg-navy px-6 py-3 text-base font-semibold text-white">Simpan jadwal</button>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-pill border border-navy px-6 py-3 text-base font-semibold text-navy">Batal</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
