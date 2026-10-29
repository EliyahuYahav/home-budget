// Bank sync from the bot: recognising the command and deciding the answer. No I/O here, so
// every rule is tested without a database; src/lib/chat.ts does the reading and writing.
import { shortDate, todayISO } from "./dates";

/** The agent reports in every 15 seconds; a minute of silence means it is off. */
export const AGENT_ONLINE_WITHIN_MS = 60_000;

export type SyncCommand = { kind: "request"; monthsBack: number } | { kind: "status" };

// Words around the command that change nothing: "תעשה סנכרון עם הבנק בבקשה".
const FILLER = new Set(["תעשה", "תבצע", "תריץ", "תפעיל", "בוא", "אפשר", "בבקשה", "עכשיו", "את", "עם", "הבנק", "מהבנק", "בנק", "לבנק", "של", "אחורה"]);
const VERB = /^(?:סנכרן|תסנכרן|לסנכרן|נסנכרן|סנכרון|סינכרון)$/;
const STATUS = /^(?:מה\s+(?:עם|מצב)\s+ה?סנכרון|מצב\s+ה?סנכרון|סטטוס\s+(?:ה)?סנכרון|איך\s+הלך\s+ה?סנכרון|הסנכרון\s+הסתיים)$/;

function normalize(text: string): string {
  return text
    .trim()
    .replace(/[?!.,״"׳']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How far back a phrase like "חצי שנה" or "3 חודשים" reaches, or null if it is not one. */
function monthsFrom(words: string[]): { months: number; used: number } | null {
  const [a, b] = words;
  if (a === "חודש") return { months: 1, used: b === "אחד" ? 2 : 1 };
  if (a === "חודשיים") return { months: 2, used: 1 };
  if (a === "חצי" && b === "שנה") return { months: 6, used: 2 };
  if (a === "שנה") return { months: 12, used: 1 };
  if (a && /^\d{1,2}$/.test(a) && b === "חודשים") {
    const months = Number(a);
    if (months >= 1 && months <= 12) return { months, used: 2 };
  }
  return null;
}

/**
 * Recognises a request to sync ("סנכרן", "תעשה סנכרון חצי שנה") or to hear how the last one
 * went ("מה עם הסנכרון"). Anything else, including an expense that mentions a number, is not
 * a command and goes to the bot as usual. Strict on purpose: a message that only looks like
 * a command must not start a bank login.
 */
export function parseSyncCommand(text: string): SyncCommand | null {
  const clean = normalize(text);
  if (!clean || clean.length > 60) return null;
  if (STATUS.test(clean)) return { kind: "status" };

  const words = clean.split(" ");
  let monthsBack = 1;
  let sawVerb = false;
  for (let i = 0; i < words.length; ) {
    const word = words[i];
    if (FILLER.has(word)) {
      i += 1;
      continue;
    }
    if (!sawVerb && VERB.test(word)) {
      sawVerb = true;
      i += 1;
      continue;
    }
    const range = sawVerb ? monthsFrom(words.slice(i)) : null;
    if (!range) return null;
    monthsBack = range.months;
    i += range.used;
  }
  return sawVerb ? { kind: "request", monthsBack } : null;
}

export interface SyncSnapshot {
  /** From bank_sync_settings; null when the home computer never connected. */
  agentSeenAt: string | null;
  hasLogins: boolean;
  /** The newest run of the household, if any. */
  lastRun: { status: "queued" | "running" | "done" | "failed"; dry_run: boolean; output: string; created_at: string; finished_at: string | null } | null;
}

export function agentOnline(snapshot: SyncSnapshot, now: number): boolean {
  return snapshot.agentSeenAt !== null && now - Date.parse(snapshot.agentSeenAt) < AGENT_ONLINE_WITHIN_MS;
}

function rangeLabel(months: number): string {
  if (months === 1) return "חודש";
  if (months === 2) return "חודשיים";
  if (months === 6) return "חצי שנה";
  if (months === 12) return "שנה";
  return `${months} חודשים`;
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "לפני רגע";
  if (minutes === 1) return "לפני דקה";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  return `ב־${shortDate(todayISO(new Date(iso)))}`;
}

/** Decides whether a request from the bot is queued, and what the bot answers. */
export function planSyncRequest(
  snapshot: SyncSnapshot,
  monthsBack: number,
  now: number,
): { queue: boolean; reply: string } {
  if (snapshot.agentSeenAt === null) {
    return { queue: false, reply: "המחשב בבית עוד לא חובר לסנכרון. ההוראות נמצאות בדף ההסבר." };
  }
  if (!snapshot.hasLogins) {
    return { queue: false, reply: "עוד לא נשמרו פרטי כניסה לבנק או לכרטיס. אפשר לשמור אותם במסך המפתחים." };
  }
  const run = snapshot.lastRun;
  if (run && (run.status === "queued" || run.status === "running")) {
    return {
      queue: false,
      reply:
        run.status === "running"
          ? `סנכרון כבר רץ עכשיו (התחיל ${ago(run.created_at, now)}). אפשר לשאול "מה עם הסנכרון" בעוד כמה דקות.`
          : `כבר יש בקשת סנכרון שמחכה למחשב בבית (${ago(run.created_at, now)}).`,
    };
  }
  if (!agentOnline(snapshot, now)) {
    return {
      queue: false,
      reply: `המחשב בבית לא מחובר עכשיו (נראה לאחרונה ${ago(snapshot.agentSeenAt, now)}). כדאי להדליק אותו ולוודא שהסוכן רץ, ואז לבקש שוב.`,
    };
  }
  return {
    queue: true,
    reply: `ביקשתי מהמחשב בבית סנכרון של ${rangeLabel(monthsBack)} אחורה. זה לוקח בדרך כלל כמה דקות; ההוצאות החדשות יופיעו במסך ההוצאות. אפשר לשאול "מה עם הסנכרון".`,
  };
}

/** The last line of a run's output that says something, for a failed run's reason. */
function lastLine(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.at(-1) ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** The bot's answer to "מה עם הסנכרון". */
export function describeLastRun(snapshot: SyncSnapshot, now: number): string {
  const run = snapshot.lastRun;
  const machine = snapshot.agentSeenAt === null
    ? "המחשב בבית עוד לא חובר."
    : agentOnline(snapshot, now)
      ? "המחשב בבית מחובר."
      : `המחשב בבית לא מחובר (נראה לאחרונה ${ago(snapshot.agentSeenAt, now)}).`;
  if (!run) return `עוד לא היה סנכרון. ${machine}`;

  const kind = run.dry_run ? "ריצת הניסיון" : "הסנכרון";
  switch (run.status) {
    case "queued":
      return `${kind} מחכה למחשב בבית (התבקש ${ago(run.created_at, now)}). ${machine}`;
    case "running":
      return `${kind} רץ עכשיו (התחיל ${ago(run.created_at, now)}).`;
    case "done":
      return `${kind} האחרון הסתיים בהצלחה ${ago(run.finished_at ?? run.created_at, now)}.${run.dry_run ? "" : " ההוצאות החדשות נמצאות במסך ההוצאות."}`;
    case "failed": {
      const reason = lastLine(run.output);
      return `${kind} האחרון נכשל ${ago(run.finished_at ?? run.created_at, now)}.${reason ? `\n${reason}` : ""}\nהפלט המלא נמצא במסך המפתחים.`;
    }
  }
}
