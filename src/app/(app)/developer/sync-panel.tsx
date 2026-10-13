"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";
import { BANKS, CARDS, type BankSource } from "@/lib/bank-sources";
import { fingerprint, seal } from "../../../../sync/seal.mjs";
import {
  clearBankCredentials,
  exportHouseholdData,
  getSyncState,
  requestSync,
  resetHouseholdData,
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

const RANGES = [
  { months: 1, label: "חודש אחורה" },
  { months: 3, label: "שלושה חודשים" },
  { months: 6, label: "חצי שנה" },
  { months: 12, label: "שנה" },
];

const RESET_WORD = "מחק";

/** Hands the browser a file to save. */
function download(name: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
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

/** A section of the screen that opens and closes, like a category on the budget screen. */
function Fold({
  title,
  aside,
  open,
  children,
}: {
  title: string;
  /** Shown in the header, so the state is visible while the section is closed. */
  aside?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel" open={open}>
      <summary className="flex cursor-pointer items-center gap-3 p-4">
        <span className="flex-1 text-lg font-bold">{title}</span>
        {aside}
        <ChevronDown className="chevron shrink-0 text-muted" />
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

/** One login inside the details form. Closed fields are still sent with the form. */
function SourceFold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-line">
      <summary className="flex cursor-pointer items-center gap-3 p-3 font-semibold">
        <span className="flex-1">{title}</span>
        <ChevronDown className="chevron shrink-0 text-muted" />
      </summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}

export function SyncPanel({ initialState }: { initialState: SyncState }) {
  const [state, setState] = useState(initialState);
  const [bank, setBank] = useState(BANKS[0].company);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const [monthsBack, setMonthsBack] = useState(1);
  const [resetText, setResetText] = useState("");
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

  async function onReset() {
    if (resetText !== RESET_WORD) return;
    const done = await act(async () => {
      // A copy first: the deletion cannot be undone.
      const backup = await exportHouseholdData();
      download(`home-budget-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
      return resetHouseholdData(resetText);
    }, "האיפוס לא הושלם. ייתכן שחלק מהנתונים כבר נמחקו; רעננו את המסך כדי לראות מה נשאר.");
    if (done) {
      setResetText("");
      setNotice("הנתונים נמחקו. קובץ גיבוי ירד למכשיר.");
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
      <Fold
        title="המחשב בבית"
        aside={
          <span
            className={`flex items-center gap-2 text-sm font-semibold ${state.agentOnline ? "text-good" : "text-muted"}`}
          >
            <span className={`size-2.5 rounded-full ${state.agentOnline ? "bg-good" : "bg-line"}`} aria-hidden="true" />
            {state.agentOnline ? "מחובר" : "לא מחובר"}
          </span>
        }
      >
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
      </Fold>

      <Fold
        title="פרטי כניסה"
        aside={
          <span className="text-sm text-muted">
            {state.credentialsSavedAt
              ? `נשמרו ב־${timeFormat.format(new Date(state.credentialsSavedAt))}`
              : "לא נשמרו"}
          </span>
        }
      >
        <p className="text-sm text-muted">
          הפרטים מוצפנים כאן בדפדפן, לפני השליחה, עם מפתח שרק המחשב בבית יכול לפתוח. במסד נשמר רק הטקסט
          המוצפן, ולכן אי אפשר להציג אותם שוב. שמירה מחליפה את כל מה שנשמר קודם, אז כדי לשנות או
          להוסיף כרטיס ממלאים מחדש את כל הפרטים. כרטיס שאין לכם משאירים ריק.
        </p>
        {state.publicKey ? (
          <form onSubmit={onSave} className="space-y-3">
            <SourceFold title="חשבון הבנק">
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
            </SourceFold>
            {CARDS.map((source) => (
              <SourceFold key={source.company} title={`כרטיס אשראי: ${source.label}`}>
                <SourceFields source={source} />
              </SourceFold>
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
      </Fold>

      <Fold
        title="סנכרון"
        open
        aside={
          latest && (
            <span
              className={`text-sm font-semibold ${
                latest.status === "failed" ? "text-danger" : latest.status === "done" ? "text-good" : "text-accent"
              }`}
            >
              {STATUS_LABEL[latest.status]}
            </span>
          )
        }
      >
        <label className="block space-y-1">
          <span className="text-sm font-semibold">כמה אחורה לקרוא</span>
          <select
            className="field"
            value={monthsBack}
            onChange={(event) => setMonthsBack(Number(event.target.value))}
          >
            {RANGES.map((range) => (
              <option key={range.months} value={range.months}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="btn btn-quiet"
            disabled={busy || active || !state.agentOnline}
            onClick={() => void act(() => requestSync(true, monthsBack), "הבקשה לא נשלחה.")}
          >
            ריצת ניסיון
          </button>
          <button
            className="btn"
            disabled={busy || active || !state.agentOnline}
            onClick={() => void act(() => requestSync(false, monthsBack), "הבקשה לא נשלחה.")}
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
      </Fold>

      <Fold title="איפוס נתונים">
        <p className="text-sm text-muted">
          מוחק את כל ההוצאות וההכנסות (<span className="num">{state.stored.transactions}</span> שורות) ואת
          היסטוריית הבוט (<span className="num">{state.stored.chatMessages}</span> הודעות), כדי להתחיל מחדש
          מהבנק. הקטגוריות, סכומי התקציב, ההגדרות והמשתמשים נשארים. לפני המחיקה יורד למכשיר קובץ גיבוי, אבל
          אין דרך להחזיר אותו לאפליקציה בלחיצה.
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">כדי לאשר, כתבו: {RESET_WORD}</span>
          <input
            className="field"
            value={resetText}
            onChange={(event) => setResetText(event.target.value.trim())}
            autoComplete="off"
          />
        </label>
        <button
          className="btn btn-danger w-full"
          disabled={busy || active || resetText !== RESET_WORD}
          onClick={() => void onReset()}
        >
          מחיקת כל ההוצאות, ההכנסות והצ׳אט
        </button>
      </Fold>

      {notice && (
        <p role="status" className="rounded-3xl bg-good-soft p-4 text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-3xl bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
