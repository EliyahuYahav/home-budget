"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendChatMessage } from "@/app/actions";
import { BotText } from "@/components/bot-text";
import { SendIcon } from "@/components/icons";
import { dayLabel, todayISO } from "@/lib/dates";
import type { ChatMessage } from "@/lib/types";

const EXAMPLES = ["סופר 230", "דלק 180 אתמול", "קיבלתי בונוס 1500", "כמה נשאר לנו החודש?"];

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
  const endRef = useRef<HTMLDivElement>(null);
  const sending = pending !== "";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setPending(content);
    setError("");
    setDraft("");
    try {
      const { userMessage, botMessage } = await sendChatMessage(content);
      setMessages((current) => [...current, userMessage, botMessage]);
    } catch {
      // Put the text back so nothing the user typed is lost.
      setDraft(content);
      setError("ההודעה לא נשלחה. בדקו את החיבור ונסו שוב.");
    } finally {
      setPending("");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const today = todayISO();
  const dayOf = (message: ChatMessage) => todayISO(new Date(message.created_at));

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <header className="pb-3">
        <h1 className="font-display text-3xl font-bold">הבוט</h1>
        <p className="text-muted">
          כותבים מה הוצאתם וכמה, והוא רושם ומשייך לקטגוריה.
          {!smartBot && " כרגע פועל הזיהוי הבסיסי, בלי Claude."}
        </p>
      </header>

      <ol className="flex-1 space-y-2" aria-live="polite">
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
                  className={`max-w-[85%] whitespace-pre-line rounded-3xl px-4 py-2.5 leading-relaxed ${
                    mine
                      ? "rounded-ss-lg bg-accent text-accent-ink"
                      : "rounded-se-lg bg-card shadow-card"
                  }`}
                >
                  {author && <p className="text-sm font-bold opacity-80">{author}</p>}
                  <BotText text={message.content} />
                  <span className={`num ms-2 text-xs ${mine ? "opacity-75" : "text-muted"}`}>
                    {timeFormat.format(sentAt)}
                  </span>
                </div>
              </div>
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
              <div className="rounded-3xl rounded-se-lg bg-card px-4 py-3 shadow-card">
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
      <div ref={endRef} />

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] -mx-4 space-y-2 bg-bg px-4 pb-3 pt-3">
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
        <form onSubmit={onSubmit} className="flex gap-2 rounded-full bg-card p-1.5 ps-4 shadow-card focus-within:outline-2 focus-within:outline-accent">
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
