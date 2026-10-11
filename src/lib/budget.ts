import { daysInMonth, daysLeftInMonth } from "./dates";
import type { Category, RecurringIncome, Transaction } from "./types";

export interface CategoryStatus {
  category: Category;
  spent: number;
  /** spent / budget; null when the category has no budget. */
  ratio: number | null;
  status: "ok" | "warning" | "over";
}

export interface MonthSummary {
  fixedIncome: number;
  extraIncome: number;
  /** Money the month starts with. Falls back to the planned budget when no income is defined. */
  income: number;
  incomeIsEstimated: boolean;
  savingsTarget: number;
  saved: number;
  /** Set aside for savings before anything is spendable: the larger of target and actual. */
  savingsReserved: number;
  spent: number;
  uncategorizedSpent: number;
  /** income - savingsReserved - spent */
  remaining: number;
  /** Unpaid part of fixed bills (rent, internet...) still expected this month. */
  fixedReserve: number;
  /** remaining - fixedReserve: what is actually free for day-to-day spending. */
  flexibleRemaining: number;
  daysLeft: number;
  /** flexibleRemaining spread over the days left, never negative. */
  safeToSpendToday: number;
  categories: CategoryStatus[];
}

/** Share of a budget at which a category is flagged before it is exceeded. */
export const WARNING_RATIO = 0.8;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeMonth(input: {
  month: string;
  today: string;
  categories: Category[];
  transactions: Transaction[];
  recurringIncomes: RecurringIncome[];
}): MonthSummary {
  const { month, today, transactions, recurringIncomes } = input;
  const categories = input.categories.filter((c) => !c.archived);
  const byId = new Map(input.categories.map((c) => [c.id, c]));

  const spentByCategory = new Map<string, number>();
  let extraIncome = 0;
  let spent = 0;
  let saved = 0;
  let uncategorizedSpent = 0;

  for (const t of transactions) {
    if (t.type === "income") {
      extraIncome += t.amount;
      continue;
    }
    const category = t.category_id ? byId.get(t.category_id) : undefined;
    if (!category) {
      uncategorizedSpent += t.amount;
      spent += t.amount;
      continue;
    }
    spentByCategory.set(category.id, (spentByCategory.get(category.id) ?? 0) + t.amount);
    if (category.kind === "saving") saved += t.amount;
    else spent += t.amount;
  }

  const fixedIncome = recurringIncomes.reduce((sum, i) => sum + i.amount, 0);
  const plannedTotal = categories.reduce((sum, c) => sum + c.monthly_budget, 0);
  const incomeIsEstimated = fixedIncome + extraIncome === 0;
  const income = incomeIsEstimated ? plannedTotal : fixedIncome + extraIncome;

  const savingsTarget = categories
    .filter((c) => c.kind === "saving")
    .reduce((sum, c) => sum + c.monthly_budget, 0);
  const savingsReserved = Math.max(savingsTarget, saved);

  const fixedReserve = categories
    .filter((c) => c.kind === "expense" && c.is_fixed)
    .reduce((sum, c) => sum + Math.max(c.monthly_budget - (spentByCategory.get(c.id) ?? 0), 0), 0);

  const remaining = income - savingsReserved - spent;
  const flexibleRemaining = remaining - fixedReserve;
  const daysLeft = daysLeftInMonth(month, today);
  const safeToSpendToday = daysLeft > 0 ? Math.max(flexibleRemaining, 0) / daysLeft : 0;

  const statuses: CategoryStatus[] = categories.map((category) => {
    const categorySpent = spentByCategory.get(category.id) ?? 0;
    const ratio = category.monthly_budget > 0 ? categorySpent / category.monthly_budget : null;
    let status: CategoryStatus["status"] = "ok";
    // Reaching a savings target is the goal, so savings lines are never flagged.
    if (category.kind === "expense") {
      if (ratio === null ? categorySpent > 0 : ratio > 1) status = "over";
      else if (ratio !== null && ratio >= WARNING_RATIO) status = "warning";
    }
    return { category, spent: round2(categorySpent), ratio, status };
  });

  return {
    fixedIncome: round2(fixedIncome),
    extraIncome: round2(extraIncome),
    income: round2(income),
    incomeIsEstimated,
    savingsTarget: round2(savingsTarget),
    saved: round2(saved),
    savingsReserved: round2(savingsReserved),
    spent: round2(spent),
    uncategorizedSpent: round2(uncategorizedSpent),
    remaining: round2(remaining),
    fixedReserve: round2(fixedReserve),
    flexibleRemaining: round2(flexibleRemaining),
    daysLeft,
    safeToSpendToday: round2(safeToSpendToday),
    categories: statuses,
  };
}

/**
 * Day-to-day spending for each day of the month (index 0 is the 1st): expenses
 * outside savings and fixed bills, which is what the daily allowance covers.
 */
export function dailySpending(
  month: string,
  transactions: Transaction[],
  categories: Category[],
): number[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const days = new Array<number>(daysInMonth(month)).fill(0);
  for (const t of transactions) {
    if (t.type !== "expense" || !t.occurred_on.startsWith(month)) continue;
    const category = t.category_id ? byId.get(t.category_id) : undefined;
    if (category && (category.kind === "saving" || category.is_fixed)) continue;
    days[Number(t.occurred_on.slice(8, 10)) - 1] += t.amount;
  }
  return days.map(round2);
}

export function formatILS(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₪${Math.abs(rounded).toLocaleString("en-US")}`;
}
