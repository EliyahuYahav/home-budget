"use client";

import { useActionState } from "react";
import { connectTelegramWebhook, type FormState } from "@/app/actions";
import { ChevronDown } from "@/components/icons";

const initial: FormState = {};

/** For whoever runs the site: tells Telegram to deliver the bot's messages here. Once is enough. */
export function TelegramPanel() {
  const [state, connect, connecting] = useActionState(connectTelegramWebhook, initial);
  return (
    <details className="panel">
      <summary className="flex cursor-pointer items-center gap-3 p-4 font-bold">
        <span className="flex-1">הבוט בטלגרם</span>
        <ChevronDown className="chevron text-muted" />
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-muted">
          אחרי שהטוקן של הבוט הוגדר בשרת, לוחצים כאן פעם אחת כדי שטלגרם ישלח את ההודעות לאתר הזה. לחיצה
          נוספת לא מזיקה.
        </p>
        <form action={connect}>
          <button className="btn btn-quiet" disabled={connecting}>
            {connecting ? "מחבר…" : "חיבור הבוט לאתר"}
          </button>
        </form>
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
    </details>
  );
}
