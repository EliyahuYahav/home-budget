"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendChatMessage, undoChatEntries } from "@/app/actions";
import { BotText } from "@/components/bot-text";
import { SendIcon } from "@/components/icons";
import { dayLabel, todayISO } from "@/lib/dates";
import type { ChatMessage } from "@/lib/types";

const EXAMPLES = ["דלק 180 אתמול", "קיבלתי בונוס 1500", "כמה נשאר לנו החודש?"];

const timeFormat = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
});

export function ChatWindow({
  initialMessages,
  memberNames,
  currentUserId,
  smartBot,
}: {
  initialMessages: ChatMessage[];
  memberNames: Record<string, string>;
  currentUserId: string;
  smartBot: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  /** Text of the message being sent, shown right away while the bot works. */
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  /** Rows logged by the latest bot answer, which can still be taken back. */
  const [undoable, setUndoable] = useState<{ messageId: string; ids: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const sending = pending !== "";

  // Only the message list scrolls, and it follows the newest message.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, pending, undoable]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setPending(content);
    setError("");
    setDraft("");
    try {
      const { userMessage, botMessage, entryIds } = await sendChatMessage(content);
      setMessages((current) => [...current, userMessage, botMessage]);
      setUndoable(entryIds.length > 0 ? { messageId: botMessage.id, ids: entryIds } : null);
    } catch {
      // Put the text back so nothing the user typed is lost.
      setDraft(content);
      setError("ההודעה לא נשלחה. בדקו את החיבור ונסו שוב.");
    } finally {
      setPending("");
    }
  }

  async function undo() {
    if (!undoable || undoing) return;
    setUndoing(true);
    setError("");
    try {
      const botMessage = await undoChatEntries(undoable.ids);
      setMessages((current) => [...current, botMessage]);
      setUndoable(null);
    } catch {
      setError("הביטול לא הצליח. אפשר למחוק את השורה במסך ההוצאות.");
    } finally {
      setUndoing(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const today = todayISO();
  const dayOf = (message: ChatMessage) => todayISO(new Date(message.created_at));

  return (
    // As tall as the space between the top of the screen and the navigation bar, so the
    // header and the writing bar never move.
    <div className="flex h-[calc(100dvh-9rem-env(safe-area-inset-bottom))] flex-col">
      <header className="shrink-0 pb-3">
        <h1 className="font-display text-5xl font-bold leading-none">הבוט</h1>
        <p className="text-muted">
          כותבים מה הוצאתם וכמה, והוא רושם ומשייך לקטגוריה.
          {!smartBot && " כרגע פועל הזיהוי הבסיסי, בלי Claude."}
        </p>
      </header>

      <ol
        ref={listRef}
        className="-mx-4 min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-live="polite"
      >
        {messages.length === 0 && !sending && (
          <li className="rounded-3xl border border-dashed border-line p-5 text-center text-muted">
            עוד אין הודעות. אפשר להתחיל באחת מהדוגמאות שלמטה.
          </li>
        )}
        {messages.map((message, index) => {
          const mine = message.role === "user";
          const author =
            mine && message.user_id !== currentUserId ? memberNames[message.user_id ?? ""] : null;
          const sentAt = new Date(message.created_at);
          const day = dayOf(message);
          const newDay = index === 0 || day !== dayOf(messages[index - 1]);
          return (
            <li key={message.id}>
              {newDay && (
                <p className="py-2 text-center text-sm font-semibold text-muted">
                  {dayLabel(day, today)}
                </p>
              )}
              <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-3xl px-4 py-3 leading-relaxed ${
                    mine
                      ? "rounded-ss-lg bg-accent text-accent-ink"
                      : "rounded-se-lg border border-card-line bg-card shadow-card"
                  }`}
                >
                  {author && <p className="text-sm font-bold opacity-80">{author}</p>}
                  <BotText text={message.content} />
                  <span className={`num mt-1.5 block text-end text-xs ${mine ? "opacity-75" : "text-muted"}`}>
                    {timeFormat.format(sentAt)}
                  </span>
                </div>
              </div>
              {undoable?.messageId === message.id && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => void undo()}
                    disabled={undoing}
                    className="rounded-full px-3 py-1 text-sm font-bold text-accent underline disabled:opacity-50"
                  >
                    {undoing ? "מבטל…" : "ביטול הרישום"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {sending && (
          <>
            <li className="flex justify-start">
              <div className="max-w-[85%] rounded-3xl rounded-ss-lg bg-accent px-4 py-2.5 text-accent-ink opacity-80">
                {pending}
              </div>
            </li>
            <li className="flex justify-end">
              <div className="rounded-3xl rounded-se-lg border border-card-line bg-card px-4 py-3 shadow-card">
                <span className="typing" role="status" aria-label="הבוט רושם">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </li>
          </>
        )}
      </ol>

      <div className="shrink-0 space-y-2 pt-3">
        {error && (
          <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              // Fills the box instead of sending: a stray tap must not log an expense.
              onClick={() => setDraft(example)}
              className="shrink-0 rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent"
            >
              {example}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="panel flex gap-2 rounded-full p-1.5 ps-4 focus-within:outline-2 focus-within:outline-accent">
          <label className="sr-only" htmlFor="chat-input">
            הודעה לבוט
          </label>
          <input
            id="chat-input"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="למשל: סופר 230"
            maxLength={500}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
            disabled={sending || !draft.trim()}
            aria-label="שליחה"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
