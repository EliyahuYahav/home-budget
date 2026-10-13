import { daysInMonth, daysLeftInMonth, monthOf, shiftMonth } from "./dates";
import type { Category, RecurringIncome, Transaction } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CategoryStatus {
  category: Category;
  spent: number;
  /** spent / budget; null when the category has no budget. */
  ratio: number | null;
  status: "ok" | "warning" | "over";
  /** Set for a fund: `spent` is then what was charged to it this month. */
  fund?: FundStatus;
}

/** A fund for a yearly expense, in one month. */
export interface FundStatus {
  /** In the fund when the month began. */
  before: number;
  /** Put in this month. Nothing before the month the fund began. */
  contribution: number;
  /** This month's charges that the fund paid. */
  paid: number;
  /** This month's charges beyond what the fund held; they count as the month's spending. */
  shortfall: number;
  /** In the fund after this month's contribution and charges. */
  balance: number;
}

/** An expense filed under a fund: all the fund arithmetic needs of a transaction. */
export type FundCharge = Pick<Transaction, "category_id" | "amount" | "occurred_on">;

const isFund = (category: Category) => category.kind === "fund" && !category.archived;

/**
 * Where a fund stands in `month`. Each month from its first, the monthly amount goes in and
 * that month's charges come out. A charge the fund cannot pay in full empties it, and the
 * rest is that month's `shortfall`; the fund does not go below zero and owe it back.
 *
 * The monthly amount is today's for every month: a fund whose amount was changed is
 * recounted as if it had always been the new one.
 *
 * @param chargedByMonth What was charged to this fund in each month ("YYYY-MM").
 */
export function fundStatus(category: Category, month: string, chargedByMonth: Map<string, number>): FundStatus {
  const charged = chargedByMonth.get(month) ?? 0;
  const start = category.fund_start ? monthOf(category.fund_start) : null;
  if (!isFund(category) || !start || month < start) {
    return { before: 0, contribution: 0, paid: 0, shortfall: round2(charged), balance: 0 };
  }

  let before = 0;
  let balance = category.fund_opening ?? 0;
  let shortfall = 0;
  // Far more months than a fund will live; only a guard against a malformed date.
  for (let m = start, i = 0; m <= month && i < 1200; m = shiftMonth(m, 1), i += 1) {
    before = balance;
    const available = before + category.monthly_budget;
    const out = chargedByMonth.get(m) ?? 0;
    shortfall = Math.max(out - available, 0);
    balance = Math.max(available - out, 0);
  }
  return {
    before: round2(before),
    contribution: category.monthly_budget,
    paid: round2(charged - shortfall),
    shortfall: round2(shortfall),
    balance: round2(balance),
  };
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
  /** Put into the funds for yearly expenses this month, before anything is spendable. */
  fundsReserved: number;
  /** In all the funds together, after this month. */
  fundsBalance: number;
  /** Everything that left the month: charges a fund paid are not in it, a fund's shortfall is. */
  spent: number;
  uncategorizedSpent: number;
  /** income - savingsReserved - fundsReserved - spent */
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

/** The category that holds cash withdrawals: any expense category with "מזומן" in its name. */
export function isCashCategory(category: Category): boolean {
  return category.kind === "expense" && category.name.includes("מזומן");
}

/**
 * Cash is counted as spent when it is withdrawn. A purchase later written down as paid in
 * cash is the same money, so its amount comes off the month's withdrawals, oldest first,
 * and the purchase keeps its own category. A withdrawal used up this way drops out.
 * Cash purchases beyond what was withdrawn stay as they are: that cash came from elsewhere.
 *
 * `covered` says how much of each withdrawal (by transaction id) was taken off.
 */
export function settleCash(
  transactions: Transaction[],
  categories: Category[],
): { transactions: Transaction[]; covered: Map<string, number> } {
  const covered = new Map<string, number>();
  const cashIds = new Set(categories.filter(isCashCategory).map((c) => c.id));
  const isWithdrawal = (t: Transaction) =>
    t.type === "expense" && t.category_id !== null && cashIds.has(t.category_id);

  let pool = 0;
  for (const t of transactions) {
    if (t.type === "expense" && t.paid_in_cash && !isWithdrawal(t)) pool += t.amount;
  }
  if (cashIds.size === 0 || pool === 0) return { transactions, covered };

  const withdrawals = transactions
    .filter(isWithdrawal)
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at));
  for (const withdrawal of withdrawals) {
    if (pool <= 0) break;
    const taken = Math.min(withdrawal.amount, pool);
    covered.set(withdrawal.id, round2(taken));
    pool = round2(pool - taken);
  }

  const settled: Transaction[] = [];
  for (const t of transactions) {
    const taken = covered.get(t.id);
    if (taken === undefined) settled.push(t);
    else if (t.amount - taken > 0.004) settled.push({ ...t, amount: round2(t.amount - taken) });
  }
  return { transactions: settled, covered };
}

/** Share of a budget at which a category is flagged before it is exceeded. */
export const WARNING_RATIO = 0.8;

export function summarizeMonth(input: {
  month: string;
  today: string;
  categories: Category[];
  transactions: Transaction[];
  recurringIncomes: RecurringIncome[];
  /** Expenses filed under the funds in the months before this one. */
  fundHistory?: FundCharge[];
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
    // A fund pays its own charges; only what it could not cover is added below.
    else if (!isFund(category)) spent += t.amount;
  }

  const chargedByFund = new Map<string, Map<string, number>>();
  for (const charge of input.fundHistory ?? []) {
    if (!charge.category_id) continue;
    const byMonth = chargedByFund.get(charge.category_id) ?? new Map<string, number>();
    const chargeMonth = monthOf(charge.occurred_on);
    byMonth.set(chargeMonth, (byMonth.get(chargeMonth) ?? 0) + charge.amount);
    chargedByFund.set(charge.category_id, byMonth);
  }
  const funds = new Map<string, FundStatus>();
  let fundsReserved = 0;
  let fundsBalance = 0;
  for (const category of categories.filter(isFund)) {
    // This month's charges come from the month's own rows, where cash is already settled.
    const byMonth = new Map(chargedByFund.get(category.id));
    byMonth.set(month, spentByCategory.get(category.id) ?? 0);
    const fund = fundStatus(category, month, byMonth);
    funds.set(category.id, fund);
    fundsReserved += fund.contribution;
    fundsBalance += fund.balance;
    spent += fund.shortfall;
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

  const remaining = income - savingsReserved - fundsReserved - spent;
  const flexibleRemaining = remaining - fixedReserve;
  const daysLeft = daysLeftInMonth(month, today);
  const safeToSpendToday = daysLeft > 0 ? Math.max(flexibleRemaining, 0) / daysLeft : 0;

  const statuses: CategoryStatus[] = categories.map((category) => {
    const categorySpent = spentByCategory.get(category.id) ?? 0;
    const ratio = category.monthly_budget > 0 ? categorySpent / category.monthly_budget : null;
    let status: CategoryStatus["status"] = "ok";
    const fund = funds.get(category.id);
    // Reaching a savings target is the goal, so savings lines are never flagged.
    if (category.kind === "expense") {
      if (ratio === null ? categorySpent > 0 : ratio > 1) status = "over";
      else if (ratio !== null && ratio >= WARNING_RATIO) status = "warning";
    } else if (fund && fund.shortfall > 0) {
      status = "over";
    }
    return { category, spent: round2(categorySpent), ratio: fund ? null : ratio, status, ...(fund ? { fund } : {}) };
  });

  return {
    fixedIncome: round2(fixedIncome),
    extraIncome: round2(extraIncome),
    income: round2(income),
    incomeIsEstimated,
    savingsTarget: round2(savingsTarget),
    saved: round2(saved),
    savingsReserved: round2(savingsReserved),
    fundsReserved: round2(fundsReserved),
    fundsBalance: round2(fundsBalance),
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
 * outside savings, funds and fixed bills, which is what the daily allowance covers.
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
    if (category && (category.kind === "saving" || isFund(category) || category.is_fixed)) continue;
    days[Number(t.occurred_on.slice(8, 10)) - 1] += t.amount;
  }
  return days.map(round2);
}

export function formatILS(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₪${Math.abs(rounded).toLocaleString("en-US")}`;
}
