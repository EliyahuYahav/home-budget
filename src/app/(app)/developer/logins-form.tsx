"use client";

import { useEffect, useState } from "react";
import { ChevronDown, PlusIcon } from "@/components/icons";
import { BANKS, CARDS, type BankSource } from "@/lib/bank-sources";
import { fingerprint, seal } from "../../../../sync/seal.mjs";
import { removeBankLogin, saveBankLogins, type LoginChange, type SavedLogin, type SyncState } from "./actions";

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

const dateFormat = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });

/** What the user typed for one login and has not saved yet. */
interface Edit {
  /** Undefined until the user touches the label, so a saved label is not overwritten by accident. */
  label?: string;
  values: Record<string, string>;
}

/** A login on screen: saved before (`savedAt`), or just added with the plus and not saved yet. */
interface Entry {
  id: string;
  company: string;
  label: string;
  savedAt: string | null;
}

const SOURCE_OF = new Map([...BANKS, ...CARDS].map((source) => [source.company, source]));

function LoginCard({
  entry,
  source,
  edit,
  busy,
  onEdit,
  onRemove,
}: {
  entry: Entry;
  source: BankSource;
  edit: Edit | undefined;
  busy: boolean;
  onEdit: (edit: Edit) => void;
  onRemove: () => void;
}) {
  const values = edit?.values ?? {};
  const label = edit?.label ?? entry.label;
  const touched = Object.values(values).some(Boolean) || (edit?.label !== undefined && edit.label !== entry.label);
  const isNew = entry.savedAt === null;

  return (
    <details className="rounded-2xl border border-line" open={isNew}>
      <summary className="flex cursor-pointer items-center gap-3 p-3">
        <span className="min-w-0 flex-1 truncate font-semibold">
          {source.label}
          {label && <span className="font-normal text-muted"> · {label}</span>}
        </span>
        <span className={`shrink-0 text-sm font-semibold ${isNew || touched ? "text-warn" : "text-good"}`}>
          {isNew ? "חדש, עוד לא נשמר" : touched ? "שינוי שלא נשמר" : `שמור מ־${dateFormat.format(new Date(entry.savedAt!))}`}
        </span>
        <ChevronDown className="chevron shrink-0 text-muted" />
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">כינוי (לא חובה)</span>
          <input
            className="field"
            value={label}
            onChange={(event) => onEdit({ values, label: event.target.value })}
            placeholder="למשל: הכרטיס של רחל"
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {source.fields.map((field) => (
            <label key={field.key} className="space-y-1">
              <span className="text-sm font-semibold">{field.label}</span>
              <input
                className="field"
                type={field.secret ? "password" : "text"}
                dir="ltr"
                value={values[field.key] ?? ""}
                onChange={(event) => onEdit({ label: edit?.label, values: { ...values, [field.key]: event.target.value } })}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        {!isNew && (
          <p className="text-sm text-muted">
            השדות ריקים כי פרטים שמורים אי אפשר להציג. ממלאים אותם רק כדי להחליף את מה שנשמר.
          </p>
        )}
        <button type="button" className="text-sm font-semibold text-danger underline" disabled={busy} onClick={onRemove}>
          {isNew ? "ביטול ההוספה" : "הסרת החשבון הזה"}
        </button>
      </div>
    </details>
  );
}

function Group({
  title,
  sources,
  entries,
  edits,
  busy,
  onAdd,
  onEdit,
  onRemove,
}: {
  title: string;
  sources: BankSource[];
  entries: Entry[];
  edits: Record<string, Edit>;
  busy: boolean;
  onAdd: (company: string) => void;
  onEdit: (id: string, edit: Edit) => void;
  onRemove: (entry: Entry) => void;
}) {
  const mine = entries.filter((entry) => sources.some((source) => source.company === entry.company));
  return (
    <section className="space-y-2">
      <h3 className="font-bold">{title}</h3>
      {mine.length === 0 && <p className="text-sm text-muted">עוד לא נוסף אף אחד.</p>}
      {mine.map((entry) => (
        <LoginCard
          key={entry.id}
          entry={entry}
          source={SOURCE_OF.get(entry.company)!}
          edit={edits[entry.id]}
          busy={busy}
          onEdit={(edit) => onEdit(entry.id, edit)}
          onRemove={() => onRemove(entry)}
        />
      ))}
      <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={`הוספה: ${title}`}>
        {sources.map((source) => (
          <button
            key={source.company}
            type="button"
            onClick={() => onAdd(source.company)}
            className="flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
          >
            <PlusIcon className="size-4 text-accent" />
            {source.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The bank and card logins: one card per login, added with the plus next to each company, as
 * many per company as needed. Saving sends only what was filled in; the rest stays as saved.
 */
export function LoginsForm({
  publicKey,
  logins,
  legacy,
  busy,
  act,
  report,
}: {
  publicKey: JsonWebKey | null;
  logins: SavedLogin[];
  legacy: boolean;
  busy: boolean;
  /** Runs a server action through the panel, which keeps the screen's state and shows a failure. */
  act: (work: () => Promise<SyncState>, failure: string) => Promise<boolean>;
  report: (kind: "error" | "notice", text: string) => void;
}) {
  const [added, setAdded] = useState<Entry[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [keyCode, setKeyCode] = useState("");
  const [trustedCode, setTrustedCode] = useState<string | null>(null);
  const [codeConfirmed, setCodeConfirmed] = useState(false);

  const keyId = publicKey?.n ?? "";
  useEffect(() => {
    let cancelled = false;
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

  const entries: Entry[] = [...logins, ...added.filter((entry) => !logins.some((login) => login.id === entry.id))];

  function onAdd(company: string) {
    setAdded((current) => [...current, { id: crypto.randomUUID(), company, label: "", savedAt: null }]);
  }

  function onRemove(entry: Entry) {
    setEdits((current) => {
      const rest = { ...current };
      delete rest[entry.id];
      return rest;
    });
    if (entry.savedAt === null) {
      setAdded((current) => current.filter((other) => other.id !== entry.id));
    } else {
      void act(() => removeBankLogin(entry.id), "ההסרה לא הצליחה.");
    }
  }

  async function onSave() {
    if (!publicKey) return;
    const changes: LoginChange[] = [];
    for (const entry of entries) {
      const source = SOURCE_OF.get(entry.company)!;
      const edit = edits[entry.id];
      const name = `${source.label}${(edit?.label ?? entry.label) ? ` (${edit?.label ?? entry.label})` : ""}`;
      const values = Object.fromEntries(source.fields.map((field) => [field.key, (edit?.values[field.key] ?? "").trim()]));
      const filled = Object.values(values).filter(Boolean).length;
      const label = (edit?.label ?? entry.label).trim();

      if (filled === 0) {
        if (entry.savedAt === null) {
          report("error", `ב־${name} עוד לא מולאו פרטים. ממלאים אותם, או מבטלים את ההוספה.`);
          return;
        }
        if (label !== entry.label) changes.push({ id: entry.id, company: entry.company, label });
        continue;
      }
      if (filled < source.fields.length) {
        report("error", `חסרים פרטים ב־${name}. ממלאים את כל השדות, או משאירים את כולם ריקים.`);
        return;
      }
      // Sealed here, in the browser: the server and the database only ever get the sealed text.
      changes.push({ id: entry.id, company: entry.company, label, sealed: await seal(publicKey, JSON.stringify(values)) });
    }
    if (changes.length === 0) {
      report("error", "אין מה לשמור: לא מולאו פרטים חדשים.");
      return;
    }

    const saved = await act(() => saveBankLogins(changes), "הפרטים לא נשמרו. בדקו את החיבור ונסו שוב.");
    if (!saved) return;
    setAdded([]);
    setEdits({});
    report("notice", "נשמר מוצפן. מה שלא מילאתם נשאר כמו שהיה.");
    try {
      localStorage.setItem(TRUSTED_KEY, keyCode);
    } catch {
      // Without storage the code is simply confirmed again next time.
    }
    setTrustedCode(keyCode);
    setCodeConfirmed(false);
  }

  if (!publicKey) {
    return (
      <p className="rounded-2xl bg-warn-soft p-3 text-sm">
        אפשר למלא פרטים רק אחרי שהמחשב בבית התחבר פעם אחת, כי ההצפנה נעשית עם המפתח שלו.
      </p>
    );
  }

  const groupProps = {
    entries,
    edits,
    busy,
    onAdd,
    onEdit: (id: string, edit: Edit) => setEdits((current) => ({ ...current, [id]: edit })),
    onRemove,
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        לכל חשבון או כרטיס יש כרטיסייה משלו; ה־+ ליד שם הבנק או החברה מוסיף עוד אחד, גם כמה מאותו סוג. הפרטים
        מוצפנים כאן בדפדפן עם מפתח שרק המחשב בבית יכול לפתוח, ושמירה מעדכנת רק את מה שמילאתם.
      </p>

      {legacy && (
        <div className="space-y-2 rounded-2xl bg-warn-soft p-3 text-sm">
          <p>
            שמורים אצלכם פרטים מהגרסה הקודמת, שבה הכול נשמר כחבילה אחת ואי אפשר לראות מה בתוכה. הם ממשיכים
            לעבוד, אבל השמירה הבאה תחליף את כולם: הוסיפו כאן את כל החשבונות והכרטיסים לפני שאתם שומרים.
          </p>
          <button
            type="button"
            className="font-semibold text-danger underline"
            disabled={busy}
            onClick={() => void act(() => removeBankLogin(), "המחיקה לא הצליחה.")}
          >
            מחיקת הפרטים הישנים
          </button>
        </div>
      )}

      <Group title="חשבונות בנק" sources={BANKS} {...groupProps} />
      <Group title="כרטיסי אשראי" sources={CARDS} {...groupProps} />

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

      <button
        type="button"
        className="btn w-full"
        disabled={busy || !keyCode || (trustedCode !== keyCode && !codeConfirmed)}
        onClick={() => void onSave()}
      >
        שמירה מוצפנת
      </button>
    </div>
  );
}
