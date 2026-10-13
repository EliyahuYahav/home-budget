// The monthly report: what a household's month looked like, as an email and as a short
// message. buildReport gathers the numbers; the render functions only lay them out.
import { formatILS, summarizeMonth, type FundCharge } from "./budget";
import { monthLabel, shiftMonth, shortDate } from "./dates";
import { averageMonth, categoryTotals, changeFrom, monthlyTotals, topPayees, type Averages, type PayeeTotal } from "./trends";
import type { Category, RecurringIncome, Transaction } from "./types";

/** How many months the report looks back over, the reported one included. */
export const REPORT_MONTHS = 6;

export interface MonthlyReport {
  month: string;
  householdName: string;
  /** Where the app lives, without a trailing slash. Empty when unknown. */
  siteUrl: string;
  income: number;
  /** No income was recorded, so `income` is the planned budget and `left` means little. */
  incomeIsEstimated: boolean;
  spent: number;
  saved: number;
  /** Put into the funds for yearly expenses. */
  fundsReserved: number;
  /** income - spent - saved - fundsReserved */
  left: number;
  /** Spending against the month before, as a fraction (0.1 is 10% more). */
  change: number | null;
  previousSpent: number | null;
  average: Averages | null;
  /** Oldest first; the last one is the reported month. */
  history: { month: string; spent: number; hasData: boolean }[];
  /** Where the money went, largest first. `budget` is 0 for a line without one. */
  categories: { name: string; spent: number; budget: number; status: "ok" | "warning" | "over" | "none" }[];
  /** Spending in the categories beyond those listed. */
  otherSpent: number;
  over: { name: string; spent: number; budget: number }[];
  goals: { name: string; saved: number; target: number; due: string | null; ratio: number }[];
  funds: { name: string; balance: number; paid: number }[];
  biggest: { description: string; category: string; amount: number; date: string }[];
  payees: PayeeTotal[];
  uncategorized: number;
}

const CATEGORIES_SHOWN = 8;

/**
 * @param perMonth The transactions of each of `months` (oldest first, the reported month
 *   last), with cash already settled.
 */
export function buildReport(input: {
  month: string;
  householdName: string;
  siteUrl: string;
  categories: Category[];
  recurringIncomes: RecurringIncome[];
  perMonth: Transaction[][];
  fundHistory?: FundCharge[];
  goalSaved?: Record<string, number>;
}): MonthlyReport {
  const { month, categories, recurringIncomes, perMonth } = input;
  const months = perMonth.map((_, i) => shiftMonth(month, i - (perMonth.length - 1)));
  const transactions = perMonth[perMonth.length - 1] ?? [];

  // Seen from the day after the month ended.
  const summary = summarizeMonth({
    month,
    today: `${shiftMonth(month, 1)}-01`,
    categories,
    transactions,
    recurringIncomes,
    fundHistory: input.fundHistory,
    goalSaved: input.goalSaved,
  });
  // A bill a fund paid is not the month's spending, here as in the summary. The reported
  // month takes the summary's own figure, which also knows what a fund could not cover.
  const fundIds = new Set(categories.filter((c) => c.kind === "fund" && !c.archived).map((c) => c.id));
  const totals = monthlyTotals({
    months,
    transactions: perMonth.flat().filter((t) => !(t.category_id && fundIds.has(t.category_id))),
    categories,
    recurringIncomes,
  }).map((t) => (t.month === month ? { ...t, spent: summary.spent } : t));
  const previous = totals[totals.length - 2];

  const statusByName = new Map(summary.categories.map((c) => [c.category.name, c]));
  const byCategory = categoryTotals(transactions, categories).filter((c) => {
    // A fund's charges were paid from the fund, not from the month.
    const row = c.id ? statusByName.get(c.name) : undefined;
    return !row?.fund;
  });
  const shown = byCategory.slice(0, CATEGORIES_SHOWN);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const savingIds = new Set(categories.filter((c) => c.kind === "saving").map((c) => c.id));

  return {
    month,
    householdName: input.householdName,
    siteUrl: input.siteUrl.replace(/\/+$/, ""),
    income: summary.income,
    incomeIsEstimated: summary.incomeIsEstimated,
    spent: summary.spent,
    saved: summary.saved,
    fundsReserved: summary.fundsReserved,
    left: Math.round((summary.income - summary.spent - summary.saved - summary.fundsReserved) * 100) / 100,
    change: previous?.hasData ? changeFrom(summary.spent, previous.spent) : null,
    previousSpent: previous?.hasData ? previous.spent : null,
    average: averageMonth(totals, month),
    history: totals.map((t) => ({ month: t.month, spent: t.spent, hasData: t.hasData })),
    categories: shown.map((c) => {
      const row = c.id ? statusByName.get(c.name) : undefined;
      const budget = row?.category.monthly_budget ?? 0;
      return { name: c.name, spent: c.spent, budget, status: row && budget > 0 ? row.status : "none" };
    }),
    otherSpent: byCategory.slice(CATEGORIES_SHOWN).reduce((sum, c) => sum + c.spent, 0),
    over: summary.categories
      .filter((c) => c.status === "over" && !c.fund && c.category.monthly_budget > 0)
      .map((c) => ({ name: c.category.name, spent: c.spent, budget: c.category.monthly_budget }))
      .sort((a, b) => b.spent - b.budget - (a.spent - a.budget)),
    goals: summary.categories
      .filter((c) => c.goal)
      .map((c) => ({
        name: c.category.name,
        saved: c.goal!.saved,
        target: c.goal!.target,
        due: c.goal!.due,
        ratio: c.goal!.ratio,
      })),
    funds: summary.categories
      .filter((c) => c.fund)
      .map((c) => ({ name: c.category.name, balance: c.fund!.balance, paid: c.fund!.paid })),
    biggest: transactions
      // Money put into savings is not an expense to look back on.
      .filter((t) => t.type === "expense" && !(t.category_id && savingIds.has(t.category_id)))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((t) => ({
        description: t.description,
        category: categoryName.get(t.category_id ?? "") ?? "ללא קטגוריה",
        amount: t.amount,
        date: t.occurred_on,
      })),
    payees: topPayees(transactions, categories, 5),
    uncategorized: summary.uncategorizedSpent,
  };
}

/** Nothing was recorded in the month, so there is nothing to report. */
export function isEmptyReport(report: MonthlyReport): boolean {
  return report.spent === 0 && report.saved === 0 && report.biggest.length === 0;
}

const MONTH_NAMES = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
const shortMonth = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
const percent = (fraction: number) => `${Math.round(Math.abs(fraction) * 100)}%`;

/** The month in one sentence, the same in the email and in the short message. */
function verdict(report: MonthlyReport): string {
  if (report.incomeIsEstimated) return `הוצאתם ${formatILS(report.spent)}`;
  return report.left >= 0
    ? `סיימתם את החודש עם ${formatILS(report.left)} ביד`
    : `הוצאתם ${formatILS(-report.left)} יותר ממה שנכנס`;
}

function comparison(report: MonthlyReport): string[] {
  const lines: string[] = [];
  if (report.change !== null && report.previousSpent !== null && Math.abs(report.change) >= 0.01) {
    lines.push(
      `${percent(report.change)} ${report.change > 0 ? "יותר" : "פחות"} מאשר ב${monthLabel(shiftMonth(report.month, -1)).split(" ")[0]} (${formatILS(report.previousSpent)})`,
    );
  }
  if (report.average && report.average.months >= 2 && report.average.spent > 0) {
    const against = (report.spent - report.average.spent) / report.average.spent;
    if (Math.abs(against) >= 0.01) {
      lines.push(
        `${percent(against)} ${against > 0 ? "מעל הממוצע" : "מתחת לממוצע"} של ${report.average.months} החודשים שלפניו (${formatILS(report.average.spent)})`,
      );
    }
  }
  return lines;
}

/** A short version, for a chat message. */
export function renderReportText(report: MonthlyReport): string {
  const lines = [`הדוח של ${monthLabel(report.month)}`, `${verdict(report)}.`, ""];
  if (!report.incomeIsEstimated) lines.push(`נכנס: ${formatILS(report.income)}`);
  lines.push(`יצא: ${formatILS(report.spent)}`, `נחסך: ${formatILS(report.saved)}`);
  if (report.fundsReserved > 0) lines.push(`הופרש לקרנות: ${formatILS(report.fundsReserved)}`);
  const compared = comparison(report);
  if (compared.length > 0) lines.push("", ...compared.map((line) => `ההוצאות: ${line}`));
  if (report.categories.length > 0) {
    lines.push("", "לאן הלך הכסף:");
    for (const c of report.categories.slice(0, 5)) {
      lines.push(`• ${c.name}: ${formatILS(c.spent)}${c.budget > 0 ? ` מתוך ${formatILS(c.budget)}` : ""}`);
    }
  }
  if (report.over.length > 0) {
    lines.push("", "חריגות מהתקציב:");
    for (const c of report.over.slice(0, 5)) lines.push(`• ${c.name}: ${formatILS(c.spent - c.budget)} מעל`);
  }
  for (const g of report.goals) {
    lines.push("", `${g.name}: ${formatILS(g.saved)} מתוך ${formatILS(g.target)} (${percent(g.ratio)})`);
  }
  if (report.siteUrl) lines.push("", `הפירוט המלא: ${report.siteUrl}/trends?m=${report.month}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The email. Mail programs ignore style sheets and most layout CSS, so it is tables with
// every style written on the element, and no images or scripts.
// ---------------------------------------------------------------------------

const C = {
  bg: "#f3efee",
  card: "#ffffff",
  ink: "#25233f",
  muted: "#65637f",
  line: "#ebe7f0",
  accent: "#5a5cd0",
  accentSoft: "#e9e8fb",
  good: "#23805c",
  goodSoft: "#ddf1e8",
  warn: "#a2650f",
  warnBar: "#e0a23d",
  danger: "#c7453f",
  dangerSoft: "#fbe5e2",
  track: "#efecf4",
};
const FONT = "'Heebo','Segoe UI',Arial,Helvetica,sans-serif";

/** Text from the household's own data must not be read as HTML by the mail program. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (amount: number) => `<span dir="ltr" style="white-space:nowrap">${formatILS(amount)}</span>`;

function card(title: string, body: string): string {
  return `<tr><td style="padding:0 0 14px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:20px">
<tr><td style="padding:20px 22px">
<div style="font-size:17px;font-weight:700;color:${C.ink};padding-bottom:12px">${title}</div>
${body}
</td></tr></table></td></tr>`;
}

/** A bar filled to `ratio` (0..1), drawn with two table cells. */
function bar(ratio: number, color: string): string {
  const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  const cells =
    filled >= 100
      ? `<td style="background:${color};border-radius:4px;height:8px;line-height:8px;font-size:0">&nbsp;</td>`
      : filled <= 0
        ? `<td style="height:8px;line-height:8px;font-size:0">&nbsp;</td>`
        : `<td width="${filled}%" style="background:${color};border-radius:4px;height:8px;line-height:8px;font-size:0">&nbsp;</td><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.track};border-radius:4px"><tr>${cells}</tr></table>`;
}

function row(right: string, left: string, sub = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:15px;color:${C.ink};padding:0 0 5px 0">${right}</td>
<td align="left" style="font-size:15px;color:${C.ink};padding:0 0 5px 0;white-space:nowrap">${left}</td>
</tr></table>${sub}`;
}

function stat(label: string, value: string, color: string): string {
  return `<td width="33%" align="center" style="padding:14px 4px">
<div style="font-size:13px;color:${C.muted}">${label}</div>
<div style="font-size:22px;font-weight:700;color:${color};padding-top:2px">${value}</div></td>`;
}

function historyChart(report: MonthlyReport): string {
  const max = Math.max(...report.history.map((h) => h.spent), 1);
  const HEIGHT = 96;
  const columns = report.history
    .map((h) => {
      const current = h.month === report.month;
      const height = h.hasData ? Math.max(Math.round((h.spent / max) * HEIGHT), 3) : 2;
      return `<td align="center" valign="bottom" width="${Math.floor(100 / report.history.length)}%" style="padding:0 5px">
<div style="font-size:11px;color:${current ? C.ink : C.muted};font-weight:${current ? 700 : 400};padding-bottom:4px">${h.hasData ? money(h.spent) : "&nbsp;"}</div>
<div style="height:${height}px;line-height:${height}px;font-size:0;background:${current ? C.accent : "#cfcdf3"};border-radius:6px 6px 0 0">&nbsp;</div>
<div style="font-size:12px;color:${current ? C.ink : C.muted};font-weight:${current ? 700 : 400};padding-top:6px">${shortMonth(h.month)}</div>
</td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${columns}</tr></table>`;
}

const BAR_COLOR = { ok: C.accent, none: C.accent, warning: C.warnBar, over: C.danger };

export function renderReportEmail(report: MonthlyReport): { subject: string; html: string; text: string } {
  const label = monthLabel(report.month);
  const subject = `הדוח של ${label}: ${verdict(report)}`;
  const good = report.incomeIsEstimated || report.left >= 0;
  const sections: string[] = [];

  // The month at a glance.
  const compared = comparison(report);
  sections.push(`<tr><td style="padding:0 0 14px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#dcd5f7" style="background:#dcd5f7;background:linear-gradient(135deg,#fbd3c4 0%,#dcd5f7 52%,#c9def6 100%);border-radius:24px">
<tr><td style="padding:26px 24px 22px 24px">
<div style="font-size:13px;letter-spacing:2px;color:${C.muted};font-weight:600">${escapeHtml(report.householdName)}</div>
<div style="font-size:30px;font-weight:800;color:${C.ink};line-height:1.15;padding-top:2px">${label}</div>
<div style="font-size:19px;color:${good ? C.ink : C.danger};font-weight:600;padding-top:14px;line-height:1.4">${verdict(report)}.</div>
${compared.length > 0 ? `<div style="font-size:14px;color:${C.muted};padding-top:6px;line-height:1.6">${compared.map((line) => `ההוצאות ${line}`).join("<br>")}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.72);border-radius:16px;margin-top:18px"><tr>
${stat(report.incomeIsEstimated ? "תקציב מתוכנן" : "נכנס", money(report.income), C.ink)}
${stat("יצא", money(report.spent), C.ink)}
${stat("נחסך", money(report.saved), C.good)}
</tr></table>
</td></tr></table></td></tr>`);

  if (report.history.filter((h) => h.hasData).length >= 2) {
    sections.push(card("ההוצאות בחודשים האחרונים", historyChart(report)));
  }

  if (report.categories.length > 0) {
    const max = Math.max(...report.categories.map((c) => c.spent), 1);
    const rows = report.categories
      .map((c) => {
        // With a budget the bar is the share of it that was used; without one, the size next to the largest line.
        const ratio = c.budget > 0 ? c.spent / c.budget : c.spent / max;
        const amount = `<b>${money(c.spent)}</b>${c.budget > 0 ? ` <span style="font-size:13px;color:${C.muted}">מתוך ${money(c.budget)}</span>` : ""}`;
        return `<div style="padding-bottom:12px">${row(escapeHtml(c.name), amount, bar(ratio, BAR_COLOR[c.status]))}</div>`;
      })
      .join("");
    const other =
      report.otherSpent > 0
        ? `<div style="font-size:13px;color:${C.muted}">ועוד ${money(report.otherSpent)} בשאר הקטגוריות.</div>`
        : "";
    sections.push(card("לאן הלך הכסף", rows + other));
  }

  if (report.over.length > 0) {
    const rows = report.over
      .slice(0, 6)
      .map(
        (c) =>
          `<tr><td style="font-size:15px;color:${C.ink};padding:5px 0">${escapeHtml(c.name)}</td><td align="left" style="font-size:15px;color:${C.danger};font-weight:700;padding:5px 0;white-space:nowrap">${money(c.spent - c.budget)} מעל</td></tr>`,
      )
      .join("");
    sections.push(
      card(
        "חריגות מהתקציב",
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.dangerSoft};border-radius:14px"><tr><td style="padding:8px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`,
      ),
    );
  } else if (report.categories.some((c) => c.budget > 0)) {
    sections.push(
      card(
        "התקציב",
        `<div style="background:${C.goodSoft};border-radius:14px;padding:12px 14px;font-size:15px;color:${C.good};font-weight:600">אף קטגוריה לא חרגה מהתקציב החודש.</div>`,
      ),
    );
  }

  if (report.goals.length > 0 || report.funds.length > 0) {
    const goals = report.goals
      .map((g) => {
        const title = `${escapeHtml(g.name)}${g.due ? ` <span style="font-size:13px;color:${C.muted}">עד ${monthLabel(g.due)}</span>` : ""}`;
        const amount = `<b>${money(g.saved)}</b> <span style="font-size:13px;color:${C.muted}">מתוך ${money(g.target)}</span>`;
        return `<div style="padding-bottom:12px">${row(title, amount, bar(g.ratio, C.good))}</div>`;
      })
      .join("");
    const funds = report.funds
      .map((f) =>
        row(
          `${escapeHtml(f.name)}${f.paid > 0 ? ` <span style="font-size:13px;color:${C.muted}">שולמו ממנה ${money(f.paid)}</span>` : ""}`,
          `<b>${money(f.balance)}</b> <span style="font-size:13px;color:${C.muted}">בקרן</span>`,
        ),
      )
      .join("");
    sections.push(card("חיסכון וקרנות", goals + funds));
  }

  if (report.biggest.length > 0) {
    const rows = report.biggest
      .map(
        (t) => `<tr>
<td style="padding:7px 0;border-top:1px solid ${C.line}"><div style="font-size:15px;color:${C.ink}">${escapeHtml(t.description || t.category)}</div>
<div style="font-size:13px;color:${C.muted}">${escapeHtml(t.category)}, <span dir="ltr">${shortDate(t.date)}</span></div></td>
<td align="left" valign="top" style="padding:7px 0;border-top:1px solid ${C.line};font-size:15px;font-weight:700;color:${C.ink};white-space:nowrap">${money(t.amount)}</td></tr>`,
      )
      .join("");
    sections.push(card("ההוצאות הגדולות", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`));
  }

  if (report.payees.length > 0) {
    const rows = report.payees
      .map(
        (p) => `<tr>
<td style="padding:6px 0;font-size:15px;color:${C.ink}">${escapeHtml(p.name)} <span style="font-size:13px;color:${C.muted}">${p.times > 1 ? `${p.times} פעמים` : "פעם אחת"}</span></td>
<td align="left" style="padding:6px 0;font-size:15px;font-weight:700;color:${C.ink};white-space:nowrap">${money(p.spent)}</td></tr>`,
      )
      .join("");
    sections.push(card("איפה קניתם הכי הרבה", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`));
  }

  if (report.uncategorized > 0) {
    sections.push(
      `<tr><td style="padding:0 0 14px 0"><div style="background:#fbeed8;border-radius:16px;padding:14px 18px;font-size:14px;color:${C.warn};line-height:1.5">${money(report.uncategorized)} מההוצאות עדיין בלי קטגוריה. שיוך שלהן במסך ההוצאות ייתן תמונה מדויקת יותר.</div></td></tr>`,
    );
  }

  const link = report.siteUrl
    ? `<tr><td align="center" style="padding:6px 0 18px 0"><a href="${escapeHtml(report.siteUrl)}/trends?m=${report.month}" style="display:inline-block;background:${C.accent};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:13px 30px;border-radius:999px">לפירוט המלא באפליקציה</a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${verdict(report)}. יצא ${formatILS(report.spent)}, נחסך ${formatILS(report.saved)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:22px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px;font-family:${FONT};text-align:right;direction:rtl">
${sections.join("\n")}
${link}
<tr><td align="center" style="font-size:12px;color:${C.muted};line-height:1.6;padding:0 10px 10px 10px">הדוח נשלח פעם בחודש מתקציב הבית. אפשר לכבות אותו במסך ההגדרות.</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  return { subject, html, text: renderReportText(report) };
}
