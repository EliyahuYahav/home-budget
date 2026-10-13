"use client";

import { useActionState } from "react";
import { sendReportNow, setMonthlyReport, type FormState } from "@/app/actions";

const initial: FormState = {};

/** Turns the monthly report on or off, and sends one now to whoever is asking. */
export function ReportSettings({ enabled, canSend, email }: { enabled: boolean; canSend: boolean; email: string }) {
  const [switchState, switchAction, switching] = useActionState(setMonthlyReport, initial);
  const [sendState, sendAction, sending] = useActionState(sendReportNow, initial);
  const state = sendState.message || sendState.error ? sendState : switchState;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <form action={switchAction}>
          <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
          <button className="btn btn-quiet" disabled={switching || sending}>
            {switching ? "שומר…" : enabled ? "להפסיק לשלוח" : "לשלוח כל חודש"}
          </button>
        </form>
        <form action={sendAction}>
          <button className="btn" disabled={!canSend || switching || sending}>
            {sending ? "שולח…" : "לשלוח לי דוח עכשיו"}
          </button>
        </form>
      </div>
      <p className="text-sm text-muted">
        {canSend ? (
          <>
            הדוח עכשיו נשלח רק אליך, ל־<span dir="ltr">{email}</span>.
          </>
        ) : (
          "שליחת מייל עוד לא הוגדרה באתר הזה."
        )}
      </p>
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-2xl bg-good-soft p-3 text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
