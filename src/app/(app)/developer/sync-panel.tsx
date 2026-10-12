"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { BANKS, CARDS, type BankSource } from "@/lib/bank-sources";
import { fingerprint, seal } from "../../../../sync/seal.mjs";
import {
  clearBankCredentials,
  getSyncState,
  requestSync,
  saveBankCredentials,
  type SyncRun,
  type SyncState,
} from "./actions";

const timeFormat = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// The key code this device last sealed bank details with. A different code later means the
// key in the database was replaced, by a new home computer or by someone else.
const TRUSTED_KEY = "bank-sync-key-code";

function readTrustedKey() {
  try {
    return localStorage.getItem(TRUSTED_KEY);
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<SyncRun["status"], string> = {
  queued: "ממתין למחשב בבית",
  running: "רץ עכשיו",
  done: "הסתיים",
  failed: "נכשל",
};

function SourceFields({ source }: { source: BankSource }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {source.fields.map((field) => (
        <label key={field.key} className="space-y-1">
          <span className="text-sm font-semibold">{field.label}</span>
          <input
            className="field"
            name={`${source.company}.${field.key}`}
            type={field.secret ? "password" : "text"}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  );
}

export function SyncPanel({ initialState }: { initialState: SyncState }) {
  const [state, setState] = useState(initialState);
  const [bank, setBank] = useState(BANKS[0].company);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const [keyCode, setKeyCode] = useState("");
  const [trustedCode, setTrustedCode] = useState<string | null>(null);
  const [codeConfirmed, setCodeConfirmed] = useState(false);

  const keyId = state.publicKey?.n ?? "";
  useEffect(() => {
    let cancelled = false;
    const publicKey = state.publicKey;
    const work = publicKey ? fingerprint(publicKey) : Promise.resolve("");
    void work.then((code) => {
      if (cancelled) return;
      setKeyCode(code);
      setTrustedCode(readTrustedKey());
      setCodeConfirmed(false);
    });
    return () => {
      cancelled = true;
    };
    // The key is re-sent with every refresh; only a different key needs a new code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyId]);
  const keyChanged = trustedCode !== null && keyCode !== "" && trustedCode !== keyCode;

  const latest = state.runs[0];
  const active = latest?.status === "queued" || latest?.status === "running";

  // Follows a run closely while it is going, and otherwise just keeps the "connected" light honest.
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(
      async () => {
        try {
          const next = await getSyncState();
          if (!cancelled) setState(next);
        } catch {
          // A missed refresh is replaced by the next one.
        }
      },
      active ? 2000 : 15000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    const box = outputRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [latest?.output]);

  async function act(work: () => Promise<SyncState>, failure: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setState(await work());
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const publicKey = state.publicKey;
    if (!publicKey) return;

    const values = new FormData(form);
    const credentials: Record<string, Record<string, string>> = {};
    for (const source of [...BANKS.filter((b) => b.company === bank), ...CARDS]) {
      const filled = Object.fromEntries(
        source.fields.map((field) => [field.key, String(values.get(`${source.company}.${field.key}`) ?? "").trim()]),
      );
      const count = Object.values(filled).filter(Boolean).length;
      if (count === 0) continue;
      if (count < source.fields.length) {
        setError(`חסרים פרטים עבור ${source.label}. ממלאים את כל השדות או משאירים את כולם ריקים.`);
        return;
      }
      credentials[source.company] = filled;
    }
    if (Object.keys(credentials).length === 0) {
      setError("לא מולאו פרטים.");
      return;
    }

    const saved = await act(
      // Sealed here, in the browser: the server and the database only ever get the sealed text.
      async () => saveBankCredentials(await seal(publicKey, JSON.stringify(credentials))),
      "הפרטים לא נשמרו. בדקו את החיבור ונסו שוב.",
    );
    if (saved) {
      form.reset();
      setNotice("הפרטים נשמרו מוצפנים.");
      try {
        localStorage.setItem(TRUSTED_KEY, keyCode);
      } catch {
        // Without storage the code is simply confirmed again next time.
      }
      setTrustedCode(keyCode);
      setCodeConfirmed(false);
    }
  }

  if (!state.schemaReady) {
    return (
      <Card className="space-y-2">
        <SectionTitle>נשאר צעד אחד במסד הנתונים</SectionTitle>
        <p className="text-muted">
          מריצים שוב את הקובץ <code className="num">supabase/schema.sql</code> ב־SQL Editor של Supabase. הוא
          מוסיף את הטבלאות של הסנכרון, ובטוח להרצה חוזרת.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>המחשב בבית</SectionTitle>
          <span
            className={`flex items-center gap-2 text-sm font-semibold ${state.agentOnline ? "text-good" : "text-muted"}`}
          >
            <span className={`size-2.5 rounded-full ${state.agentOnline ? "bg-good" : "bg-line"}`} aria-hidden="true" />
            {state.agentOnline ? "מחובר" : "לא מחובר"}
          </span>
        </div>
        {state.agentOnline ? (
          <p className="text-sm text-muted">הסנכרון עצמו רץ על המחשב בבית. מכאן רק מבקשים אותו ורואים מה קרה.</p>
        ) : (
          <p className="text-sm text-muted">
            {state.agentSeenAt
              ? `נראה לאחרונה ב־${timeFormat.format(new Date(state.agentSeenAt))}. `
              : "המחשב עוד לא התחבר אף פעם. "}
            כדי לחבר אותו, מריצים בתיקייה <code className="num">sync</code> את הפקודה{" "}
            <code className="num">npm run agent</code> ומשאירים את החלון פתוח.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle>פרטי כניסה לבנק</SectionTitle>
          <span className="text-sm text-muted">
            {state.credentialsSavedAt
              ? `נשמרו ב־${timeFormat.format(new Date(state.credentialsSavedAt))}`
              : "לא נשמרו"}
          </span>
        </div>
        <p className="text-sm text-muted">
          הפרטים מוצפנים כאן בדפדפן, לפני השליחה, עם מפתח שרק המחשב בבית יכול לפתוח. במסד נשמר רק הטקסט
          המוצפן, ולכן אי אפשר להציג אותם שוב; כדי לשנות, ממלאים מחדש.
        </p>
        {state.publicKey ? (
          <form onSubmit={onSave} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-semibold">בנק</span>
              <select className="field" value={bank} onChange={(event) => setBank(event.target.value)}>
                {BANKS.map((b) => (
                  <option key={b.company} value={b.company}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            {BANKS.filter((b) => b.company === bank).map((source) => (
              <SourceFields key={source.company} source={source} />
            ))}
            {CARDS.map((source) => (
              <fieldset key={source.company} className="space-y-2">
                <legend className="text-sm font-bold">כרטיס אשראי: {source.label}</legend>
                <SourceFields source={source} />
              </fieldset>
            ))}
            <div className={`space-y-2 rounded-2xl p-3 text-sm ${keyChanged ? "bg-danger-soft" : "bg-accent-soft"}`}>
              <p>
                קוד המפתח של המחשב בבית: <span className="num font-bold">{keyCode || "…"}</span>
              </p>
              <p className={keyChanged ? "font-semibold text-danger" : "text-muted"}>
                {keyChanged
                  ? "הקוד שונה מזה שאיתו נשמרו הפרטים בפעם הקודמת במכשיר הזה. אם לא החלפתם מחשב או מחקתם את קובץ המפתח, אל תמלאו פרטים."
                  : "הסוכן מדפיס את אותו קוד בחלון שלו כשהוא עולה. ממלאים פרטים רק כשהקודים זהים."}
              </p>
              {trustedCode !== keyCode && (
                <label className="flex items-center gap-2.5 font-semibold">
                  <input
                    type="checkbox"
                    className="size-5 accent-accent"
                    checked={codeConfirmed}
                    onChange={(event) => setCodeConfirmed(event.target.checked)}
                  />
                  השוויתי, הקוד זהה לזה שבחלון הסוכן
                </label>
              )}
            </div>
            <div className="flex gap-3">
              <button className="btn flex-1" disabled={busy || !keyCode || (trustedCode !== keyCode && !codeConfirmed)}>
                שמירה מוצפנת
              </button>
              {state.credentialsSavedAt && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void act(clearBankCredentials, "המחיקה לא הצליחה.")}
                >
                  מחיקה
                </button>
              )}
            </div>
          </form>
        ) : (
          <p className="rounded-2xl bg-warn-soft p-3 text-sm">
            אפשר למלא פרטים רק אחרי שהמחשב בבית התחבר פעם אחת, כי ההצפנה נעשית עם המפתח שלו.
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-2xl bg-good-soft p-3 text-sm">
            {notice}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle>סנכרון</SectionTitle>
          {latest && (
            <span
              className={`text-sm font-semibold ${
                latest.status === "failed" ? "text-danger" : latest.status === "done" ? "text-good" : "text-accent"
              }`}
            >
              {STATUS_LABEL[latest.status]}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="btn btn-quiet"
            disabled={busy || active || !state.agentOnline}
            onClick={() => void act(() => requestSync(true), "הבקשה לא נשלחה.")}
          >
            ריצת ניסיון
          </button>
          <button
            className="btn"
            disabled={busy || active || !state.agentOnline}
            onClick={() => void act(() => requestSync(false), "הבקשה לא נשלחה.")}
          >
            סנכרון
          </button>
        </div>
        <p className="text-sm text-muted">
          {state.agentOnline
            ? "ריצת ניסיון מציגה מה היה נרשם בלי לכתוב כלום. סנכרון רושם את ההוצאות החדשות."
            : "הכפתורים נפתחים כשהמחשב בבית מחובר."}
        </p>
        <pre
          ref={outputRef}
          dir="ltr"
          aria-live="polite"
          aria-label="פלט הסנכרון"
          className="num h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-[#1d1b33] p-3 text-start font-mono text-[0.8rem] leading-relaxed text-[#e9e7f7]"
        >
          {latest
            ? `$ ${latest.dry_run ? "sync --dry-run" : "sync"}   ${timeFormat.format(new Date(latest.created_at))}\n${latest.output}${
                active ? "▍" : ""
              }`
            : "עוד לא הייתה ריצה."}
        </pre>
        {state.runs.length > 1 && (
          <ul className="space-y-1 text-sm text-muted">
            {state.runs.slice(1).map((run) => (
              <li key={run.id} className="flex justify-between gap-3">
                <span>
                  {run.dry_run ? "ריצת ניסיון" : "סנכרון"}, {timeFormat.format(new Date(run.created_at))}
                </span>
                <span className={run.status === "failed" ? "text-danger" : ""}>{STATUS_LABEL[run.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && (
        <p role="alert" className="rounded-3xl bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
