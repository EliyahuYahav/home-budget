"use client";

import { useActionState } from "react";
import { createTelegramLink, disconnectTelegram, type TelegramLinkState } from "@/app/actions";
import { SubmitButton } from "./submit-button";

const initial: TelegramLinkState = {};

/** Links the member's own Telegram chat to the bot, or removes the link. */
export function TelegramSettings({ linked, available }: { linked: boolean; available: boolean }) {
  const [state, createLink, creating] = useActionState(createTelegramLink, initial);

  if (linked) {
    return (
      <form action={disconnectTelegram}>
        <SubmitButton className="text-sm font-semibold text-danger underline" pendingLabel="מנתק…">
          לנתק את הטלגרם שלי
        </SubmitButton>
      </form>
    );
  }
  return (
    <div className="space-y-3">
      {state.link ? (
        <div className="space-y-2 rounded-2xl bg-accent-soft p-4">
          <a className="btn w-full" href={state.link} target="_blank" rel="noreferrer">
            פתיחת הבוט בטלגרם
          </a>
          <p className="text-sm text-muted">
            בטלגרם לוחצים על &quot;התחל&quot; (Start), והצ&apos;אט מתחבר. הקישור טוב לרבע שעה ולפעם אחת.
          </p>
        </div>
      ) : (
        <form action={createLink}>
          <button className="btn" disabled={!available || creating}>
            {creating ? "יוצר קישור…" : "חיבור לטלגרם"}
          </button>
        </form>
      )}
      {!available && <p className="text-sm text-muted">הבוט בטלגרם עוד לא הוגדר באתר הזה.</p>}
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
