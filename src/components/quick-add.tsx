"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendChatMessage } from "@/app/actions";
import { BotText } from "./bot-text";
import { SendIcon } from "./icons";

/** One-line entry on the home screen: goes through the bot and shows its answer in place. */
export function QuickAdd() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    setReply("");
    setDraft("");
    try {
      const { botMessage } = await sendChatMessage(content);
      setReply(botMessage.content);
      // The numbers on this screen come from the server; fetch them again.
      router.refresh();
    } catch {
      // Put the text back so nothing the user typed is lost.
      setDraft(content);
      setError("ההודעה לא נשלחה. בדקו את החיבור ונסו שוב.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className="flex gap-2 rounded-full bg-card p-1.5 ps-4 shadow-card focus-within:outline-2 focus-within:outline-accent">
        <label className="sr-only" htmlFor="quick-add">
          מה הוצאתם?
        </label>
        <input
          id="quick-add"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="מה הוצאתם? למשל: סופר 230"
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
          disabled={sending || !draft.trim()}
          aria-label="רישום"
        >
          {sending ? (
            <span className="typing" aria-hidden="true">
              <span className="!bg-accent-ink" />
              <span className="!bg-accent-ink" />
              <span className="!bg-accent-ink" />
            </span>
          ) : (
            <SendIcon />
          )}
        </button>
      </form>
      <div aria-live="polite">
        {reply && (
          <p className="whitespace-pre-line rounded-3xl bg-accent-soft p-4 text-[0.95rem] leading-relaxed">
            <BotText text={reply} />
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-3xl bg-danger-soft p-4 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
