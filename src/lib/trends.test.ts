import { describe, expect, it } from "vitest";
import { dailySpending } from "./budget";
import { dayLabel } from "./dates";
import { categoryTotals, changeFrom, monthlyTotals, projectedSpending } from "./trends";
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
  source: "manual",
  created_at: `${date}T10:00:00Z`,
  ...over,
});

const categories = [
  category("savings", { kind: "saving" }),
  category("rent", { is_fixed: true }),
  category("groceries"),
  category("fun"),
];

describe("monthlyTotals", () => {
  const transactions = [
    tx(500, "groceries", "2026-09-03"),
    tx(1000, "savings", "2026-09-10"),
    tx(300, null, "2026-10-02"),
    tx(200, "fun", "2026-10-05"),
    tx(800, null, "2026-10-07", { type: "income" }),
    tx(999, "fun", "2026-07-01"),
  ];
  const totals = monthlyTotals({
    months: ["2026-08", "2026-09", "2026-10"],
    transactions,
    categories,
    recurringIncomes: [{ id: "i", name: "salary", amount: 10000 }],
  });

  it("separates spending, savings and income per month", () => {
    expect(totals[1]).toEqual({ month: "2026-09", income: 10000, spent: 500, saved: 1000, hasData: true });
    expect(totals[2]).toEqual({ month: "2026-10", income: 10800, spent: 500, saved: 0, hasData: true });
  });

  it("leaves a month with nothing recorded empty instead of crediting fixed income", () => {
    expect(totals[0]).toEqual({ month: "2026-08", income: 0, spent: 0, saved: 0, hasData: false });
  });

  it("ignores transactions outside the requested months", () => {
    expect(totals.reduce((sum, t) => sum + t.spent, 0)).toBe(1000);
  });
});

describe("categoryTotals", () => {
  it("ranks spending by category and leaves out savings and income", () => {
    const result = categoryTotals(
      [
        tx(300, "groceries", "2026-10-01"),
        tx(100, "groceries", "2026-10-02"),
        tx(100, "fun", "2026-10-02"),
        tx(500, "savings", "2026-10-02"),
        tx(900, null, "2026-10-03", { type: "income" }),
      ],
      categories,
    );
    expect(result.map((c) => [c.name, c.spent, c.share])).toEqual([
      ["groceries", 400, 0.8],
      ["fun", 100, 0.2],
    ]);
  });

  it("groups expenses without a category, or with a deleted one, together", () => {
    const result = categoryTotals(
      [tx(50, null, "2026-10-01"), tx(70, "deleted", "2026-10-01")],
      categories,
    );
    expect(result).toEqual([{ id: null, name: "ללא קטגוריה", spent: 120, share: 1 }]);
  });

  it("returns nothing for a month without expenses", () => {
    expect(categoryTotals([], categories)).toEqual([]);
  });
});

describe("changeFrom", () => {
  it("gives the change as a fraction of the previous value", () => {
    expect(changeFrom(1100, 1000)).toBeCloseTo(0.1);
    expect(changeFrom(750, 1000)).toBeCloseTo(-0.25);
  });

  it("has no answer without a previous value", () => {
    expect(changeFrom(500, undefined)).toBeNull();
    expect(changeFrom(500, 0)).toBeNull();
  });
});

describe("projectedSpending", () => {
  const base = { month: "2026-10", spent: 3000, flexibleSpent: 1000, fixedReserve: 500 };

  it("extends the day-to-day pace over the days left and adds unpaid fixed bills", () => {
    // 1000 over 10 days = 100 a day, 21 days left: 3000 + 2100 + 500.
    expect(projectedSpending({ ...base, today: "2026-10-10" })).toBe(5600);
  });

  it("adds nothing for pace on the last day", () => {
    expect(projectedSpending({ ...base, today: "2026-10-31" })).toBe(3500);
  });

  it("waits until day 5 and only projects the current month", () => {
    expect(projectedSpending({ ...base, today: "2026-10-04" })).toBeNull();
    expect(projectedSpending({ ...base, today: "2026-11-10" })).toBeNull();
  });
});

describe("dailySpending", () => {
  it("sums day-to-day expenses per day, without savings, fixed bills or income", () => {
    const days = dailySpending(
      "2026-10",
      [
        tx(60, "fun", "2026-10-01"),
        tx(40, null, "2026-10-01"),
        tx(2700, "rent", "2026-10-01"),
        tx(1000, "savings", "2026-10-02"),
        tx(500, null, "2026-10-02", { type: "income" }),
        tx(25.5, "groceries", "2026-10-31"),
        tx(80, "fun", "2026-09-30"),
      ],
      categories,
    );
    expect(days).toHaveLength(31);
    expect(days[0]).toBe(100);
    expect(days[1]).toBe(0);
    expect(days[30]).toBe(25.5);
    expect(days.reduce((a, b) => a + b, 0)).toBe(125.5);
  });

  it("has one entry per day of a short month", () => {
    expect(dailySpending("2026-02", [], categories)).toHaveLength(28);
  });
});

describe("dayLabel", () => {
  it("names today and yesterday", () => {
    expect(dayLabel("2026-10-12", "2026-10-12")).toBe("היום");
    expect(dayLabel("2026-10-11", "2026-10-12")).toBe("אתמול");
  });

  it("gives the weekday and date for older days, across a month boundary too", () => {
    // 6 October 2026 is a Tuesday, 3 October a Saturday.
    expect(dayLabel("2026-10-06", "2026-10-12")).toBe("יום שלישי 6.10");
    expect(dayLabel("2026-10-03", "2026-10-12")).toBe("שבת 3.10");
    expect(dayLabel("2026-09-30", "2026-10-01")).toBe("אתמול");
  });
});
