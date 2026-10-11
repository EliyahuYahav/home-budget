"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendChatMessage } from "@/app/actions";
import type { ChatMessage } from "@/lib/types";

const EXAMPLES = ["סופר 230", "דלק 180 אתמול", "קיבלתי בונוס 1500", "כמה נשאר לנו החודש?"];

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
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
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <header className="pb-3">
        <h1 className="text-xl font-bold">הבוט</h1>
        <p className="text-sm text-muted">
          כותבים מה הוצאתם וכמה, והוא רושם ומשייך לקטגוריה.
          {!smartBot && " כרגע פועל הזיהוי הבסיסי, בלי Claude."}
        </p>
      </header>

      <ol className="flex-1 space-y-2" aria-live="polite">
        {messages.length === 0 && (
          <li className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
            עוד אין הודעות. אפשר להתחיל באחת מהדוגמאות שלמטה.
          </li>
        )}
        {messages.map((message) => {
          const mine = message.role === "user";
          const author =
            mine && message.user_id !== currentUserId ? memberNames[message.user_id ?? ""] : null;
          return (
            <li key={message.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-[0.95rem] leading-relaxed ${
                  mine ? "bg-accent text-accent-ink" : "border border-line bg-card"
                }`}
              >
                {author && <p className="text-xs opacity-80">{author}</p>}
                {message.content}
              </div>
            </li>
          );
        })}
        {sending && (
          <li className="flex justify-end">
            <div className="rounded-2xl border border-line bg-card px-3 py-2 text-sm text-muted">
              רושם…
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      <div className="sticky bottom-[3.25rem] -mx-4 space-y-2 bg-bg px-4 pb-3 pt-3">
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft p-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2 overflow-x-auto">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={sending}
              onClick={() => void send(example)}
              className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-sm"
            >
              {example}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <label className="sr-only" htmlFor="chat-input">
            הודעה לבוט
          </label>
          <input
            id="chat-input"
            className="field"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="למשל: סופר 230"
            maxLength={500}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button className="btn" disabled={sending || !draft.trim()}>
            שליחה
          </button>
        </form>
      </div>
    </div>
  );
}
