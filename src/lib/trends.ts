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

export interface Averages {
  /** How many months the averages are over. */
  months: number;
  income: number;
  spent: number;
  /** income - spent - saved: what was left over in an average month. */
  left: number;
}

/**
 * An average month, over the months that have data other than `exclude` (the month being
 * looked at, which is usually still in progress). null when there is no other month.
 */
export function averageMonth(totals: MonthTotals[], exclude: string): Averages | null {
  const rows = totals.filter((row) => row.hasData && row.month !== exclude);
  if (rows.length === 0) return null;
  const mean = (pick: (row: MonthTotals) => number) =>
    round2(rows.reduce((sum, row) => sum + pick(row), 0) / rows.length);
  return {
    months: rows.length,
    income: mean((row) => row.income),
    spent: mean((row) => row.spent),
    left: mean((row) => row.income - row.spent - row.saved),
  };
}

export interface CategoryTrend {
  /** null for expenses without a category. */
  id: string | null;
  name: string;
  /** Spent in the month being looked at. */
  current: number;
  /** Average over the earlier months that have data; a month without the category counts as zero. */
  average: number;
}

/**
 * Each category's spending in `month` next to what it usually is, largest first by
 * whichever of the two is bigger. Empty when there is no earlier month to compare with.
 */
export function categoryTrends(input: {
  month: string;
  months: string[];
  transactions: Transaction[];
  categories: Category[];
}): CategoryTrend[] {
  const byMonth = new Map<string, Transaction[]>(input.months.map((month) => [month, []]));
  for (const t of input.transactions) byMonth.get(monthOf(t.occurred_on))?.push(t);
  const earlier = input.months.filter((month) => month !== input.month && byMonth.get(month)!.length > 0);
  if (earlier.length === 0) return [];

  const rows = new Map<string | null, CategoryTrend>();
  const row = (total: CategoryTotal) => {
    let found = rows.get(total.id);
    if (!found) {
      found = { id: total.id, name: total.name, current: 0, average: 0 };
      rows.set(total.id, found);
    }
    return found;
  };
  for (const total of categoryTotals(byMonth.get(input.month) ?? [], input.categories)) {
    row(total).current = total.spent;
  }
  for (const month of earlier) {
    for (const total of categoryTotals(byMonth.get(month)!, input.categories)) {
      row(total).average += total.spent / earlier.length;
    }
  }
  return [...rows.values()]
    .map((trend) => ({ ...trend, average: round2(trend.average) }))
    .sort((a, b) => Math.max(b.current, b.average) - Math.max(a.current, a.average));
}

export interface PayeeTotal {
  name: string;
  spent: number;
  times: number;
}

/** "שופרסל דיל (תשלום 2 מתוך 6)" and "שופרסל  דיל" are the same payee. */
function payeeName(description: string): string {
  return description
    .replace(/\(תשלום \d+ מתוך \d+\)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where the most money went by name, over all the transactions given. Savings and rows
 * without a description are left out.
 */
export function topPayees(transactions: Transaction[], categories: Category[], limit: number): PayeeTotal[] {
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  const totals = new Map<string, PayeeTotal>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (t.category_id && kindById.get(t.category_id) === "saving") continue;
    const name = payeeName(t.description);
    if (!name) continue;
    const total = totals.get(name) ?? { name, spent: 0, times: 0 };
    total.spent += t.amount;
    total.times += 1;
    totals.set(name, total);
  }
  return [...totals.values()]
    .map((total) => ({ ...total, spent: round2(total.spent) }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, limit);
}
