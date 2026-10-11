import { daysInMonth, monthOf } from "./dates";
import type { Category, RecurringIncome, Transaction } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface MonthTotals {
  month: string;
  income: number;
  spent: number;
  saved: number;
  /** False for a month with nothing recorded, so it is not shown as a month of zero spending. */
  hasData: boolean;
}

/**
 * Income, spending and savings for each month in `months`.
 * Fixed incomes are not stored per month, so today's definitions are applied to
 * every month that has any activity.
 */
export function monthlyTotals(input: {
  months: string[];
  transactions: Transaction[];
  categories: Category[];
  recurringIncomes: RecurringIncome[];
}): MonthTotals[] {
  const kindById = new Map(input.categories.map((c) => [c.id, c.kind]));
  const fixedIncome = input.recurringIncomes.reduce((sum, i) => sum + i.amount, 0);
  const totals = new Map<string, MonthTotals>(
    input.months.map((month) => [month, { month, income: 0, spent: 0, saved: 0, hasData: false }]),
  );

  for (const t of input.transactions) {
    const row = totals.get(monthOf(t.occurred_on));
    if (!row) continue;
    row.hasData = true;
    if (t.type === "income") row.income += t.amount;
    else if (t.category_id && kindById.get(t.category_id) === "saving") row.saved += t.amount;
    else row.spent += t.amount;
  }

  return input.months.map((month) => {
    const row = totals.get(month)!;
    return {
      ...row,
      income: round2(row.income + (row.hasData ? fixedIncome : 0)),
      spent: round2(row.spent),
      saved: round2(row.saved),
    };
  });
}

export interface CategoryTotal {
  /** null for expenses without a category. */
  id: string | null;
  name: string;
  spent: number;
  /** Part of the month's spending, 0..1. */
  share: number;
}

/** Where one month's spending went, largest first. Savings are not spending. */
export function categoryTotals(transactions: Transaction[], categories: Category[]): CategoryTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map<string | null, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const category = t.category_id ? byId.get(t.category_id) : undefined;
    if (category?.kind === "saving") continue;
    const key = category ? category.id : null;
    sums.set(key, (sums.get(key) ?? 0) + t.amount);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([id, spent]) => ({
      id,
      name: id ? byId.get(id)!.name : "ללא קטגוריה",
      spent: round2(spent),
      share: total > 0 ? spent / total : 0,
    }))
    .sort((a, b) => b.spent - a.spent);
}

/**
 * Change from the previous month as a fraction (0.12 = 12% more).
 * null when there is nothing to compare with.
 */
export function changeFrom(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous <= 0) return null;
  return (current - previous) / previous;
}

/**
 * Spending expected by the end of the month if day-to-day spending keeps its
 * pace: what was spent so far, plus the same daily rate for the days left, plus
 * fixed bills still unpaid. null before day 5, when a few purchases would
 * swing the estimate too much.
 */
export function projectedSpending(input: {
  month: string;
  today: string;
  spent: number;
  flexibleSpent: number;
  fixedReserve: number;
}): number | null {
  if (monthOf(input.today) !== input.month) return null;
  const day = Number(input.today.slice(8, 10));
  if (day < 5) return null;
  const daysAfterToday = daysInMonth(input.month) - day;
  const dailyRate = input.flexibleSpent / day;
  return round2(input.spent + dailyRate * daysAfterToday + input.fixedReserve);
}
