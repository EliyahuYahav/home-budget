import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReport, escapeHtml, isEmptyReport, renderReportEmail, renderReportText } from "./report";
import type { Category, Transaction } from "./types";

const category = (id: string, over: Partial<Category> = {}): Category => ({
  id,
  name: id,
  kind: "expense",
  is_fixed: false,
  monthly_budget: 0,
  sort_order: 0,
  archived: false,
  ...over,
});

let nextId = 0;
const tx = (amount: number, categoryId: string | null, date: string, over: Partial<Transaction> = {}): Transaction => ({
  id: String(nextId++),
  user_id: "u1",
  type: "expense",
  amount,
  category_id: categoryId,
  description: "",
  occurred_on: date,
  source: "bank",
  created_at: `${date}T10:00:00Z`,
  ...over,
});

const categories = [
  category("חסכונות", { kind: "saving", monthly_budget: 1200 }),
  category("חופשה בקיץ", { kind: "saving", monthly_budget: 500, goal_amount: 8000, goal_due: "2027-06-01", fund_opening: 1000 }),
  category("ביטוח רכב", { kind: "fund", monthly_budget: 250, fund_start: "2026-06-01", fund_opening: 500 }),
  category("שכירות", { is_fixed: true, monthly_budget: 2700 }),
  category("סופר", { monthly_budget: 1800 }),
  category("אוכל בחוץ", { monthly_budget: 500 }),
  category("דלק", { monthly_budget: 300 }),
  category("בילויים", { monthly_budget: 300 }),
  category("ביגוד", { monthly_budget: 400 }),
  category("מתנות"),
];

const september: Transaction[] = [
  tx(11800, null, "2026-09-01", { type: "income", description: "משכורת" }),
  tx(1200, "חסכונות", "2026-09-02"),
  tx(500, "חופשה בקיץ", "2026-09-02"),
  tx(2700, "שכירות", "2026-09-03", { description: "שכירות" }),
  tx(640, "סופר", "2026-09-04", { description: "שופרסל דיל" }),
  tx(580, "סופר", "2026-09-12", { description: "שופרסל דיל" }),
  tx(710, "סופר", "2026-09-21", { description: "רמי לוי" }),
  tx(320, "אוכל בחוץ", "2026-09-08", { description: "קפה גן" }),
  tx(410, "אוכל בחוץ", "2026-09-19", { description: "מסעדת <הים>" }),
  tx(260, "דלק", "2026-09-10", { description: "פז" }),
  tx(180, "בילויים", "2026-09-14", { description: "סינמה סיטי" }),
  tx(350, "מתנות", "2026-09-17", { description: "מתנה לחתונה" }),
  tx(1400, "ביטוח רכב", "2026-09-20", { description: "ביטוח ישיר" }),
  tx(215, null, "2026-09-25", { description: "העברה בביט" }),
];
const earlier = (month: string, groceries: number): Transaction[] => [
  tx(11800, null, `${month}-01`, { type: "income" }),
  tx(1200, "חסכונות", `${month}-02`),
  tx(500, "חופשה בקיץ", `${month}-02`),
  tx(2700, "שכירות", `${month}-03`),
  tx(groceries, "סופר", `${month}-10`),
  tx(450, "אוכל בחוץ", `${month}-15`),
];

const input = () => ({
  month: "2026-09",
  householdName: "משפחת ישראלי",
  siteUrl: "https://example.test/",
  categories,
  recurringIncomes: [],
  perMonth: [[], [], earlier("2026-06", 1500), earlier("2026-07", 1700), earlier("2026-08", 2100), september],
  goalSaved: { "חופשה בקיץ": 1500 },
});

describe("buildReport", () => {
  const report = buildReport(input());

  it("sums the month the way the app does", () => {
    // 6,365 on ordinary lines; the fund held 1,500 against a 1,400 bill, so none of it counts.
    expect(report).toMatchObject({ income: 11800, spent: 6365, saved: 1700, fundsReserved: 250, left: 3485 });
    expect(report.incomeIsEstimated).toBe(false);
    expect(report.uncategorized).toBe(215);
  });

  it("compares with the month before and with the average", () => {
    expect(report.previousSpent).toBe(5250);
    expect(report.change).toBeCloseTo((6365 - 5250) / 5250);
    expect(report.average?.months).toBe(3);
    expect(report.history.map((h) => h.hasData)).toEqual([false, false, true, true, true, true]);
  });

  it("lists where the money went without the fund's own bill", () => {
    expect(report.categories[0]).toEqual({ name: "שכירות", spent: 2700, budget: 2700, status: "warning" });
    expect(report.categories.map((c) => c.name)).not.toContain("ביטוח רכב");
    expect(report.over).toEqual([
      { name: "אוכל בחוץ", spent: 730, budget: 500 },
      { name: "סופר", spent: 1930, budget: 1800 },
    ]);
    expect(report.funds).toEqual([{ name: "ביטוח רכב", balance: 100, paid: 1400 }]);
    expect(report.goals).toEqual([{ name: "חופשה בקיץ", saved: 3000, target: 8000, due: "2027-06", ratio: 0.375 }]);
    expect(report.biggest[0]).toMatchObject({ amount: 2700, category: "שכירות" });
  });

  it("knows a month with nothing in it", () => {
    expect(isEmptyReport(report)).toBe(false);
    expect(isEmptyReport(buildReport({ ...input(), perMonth: [[]] }))).toBe(true);
  });
});

describe("renderReportEmail", () => {
  const email = renderReportEmail(buildReport(input()));

  it("says how the month ended in the subject", () => {
    expect(email.subject).toBe("הדוח של ספטמבר 2026: סיימתם את החודש עם ₪3,485 ביד");
  });

  it("does not let a description be read as HTML", () => {
    expect(email.html).toContain("מסעדת &lt;הים&gt;");
    expect(email.html).not.toContain("<הים>");
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("loads nothing from outside and links only to the app", () => {
    expect(email.html).not.toMatch(/<script|<img|<link|@import|url\(/i);
    const links = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["https://example.test/trends?m=2026-09"]);
  });

  it("has a short version for a chat message", () => {
    const text = renderReportText(buildReport(input()));
    expect(text).toContain("יצא: ₪6,365");
    expect(text).toContain("• אוכל בחוץ: ₪230 מעל");
    expect(text).toContain("https://example.test/trends?m=2026-09");
  });

  it("reports a month that ended below zero", () => {
    const report = buildReport({ ...input(), perMonth: [september.filter((t) => t.type !== "income").concat(tx(5000, null, "2026-09-01", { type: "income" }))] });
    expect(renderReportEmail(report).subject).toContain("יותר ממה שנכנס");
  });

  if (process.env.REPORT_PREVIEW) writeFileSync(process.env.REPORT_PREVIEW, email.html);
});
