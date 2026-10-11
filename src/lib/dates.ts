// All "today" / "this month" decisions use Israel time, not the server's clock.
const TIME_ZONE = "Asia/Jerusalem";

/** Today's date in Israel as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

/** YYYY-MM for a YYYY-MM-DD date. */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export function isValidMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First day of the month and first day of the next one, for range queries. */
export function monthRange(month: string): { start: string; endExclusive: string } {
  return { start: `${month}-01`, endExclusive: `${shiftMonth(month, 1)}-01` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftDate(dateISO: string, deltaDays: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Days left in the month counting today; 0 for a past month, the full month for a future one. */
export function daysLeftInMonth(month: string, today: string): number {
  const current = monthOf(today);
  if (month < current) return 0;
  if (month > current) return daysInMonth(month);
  return daysInMonth(month) - Number(today.slice(8, 10)) + 1;
}

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${HEBREW_MONTHS[m - 1]} ${y}`;
}

/** 2026-10-11 -> 11.10 */
export function shortDate(dateISO: string): string {
  return `${Number(dateISO.slice(8, 10))}.${Number(dateISO.slice(5, 7))}`;
}
