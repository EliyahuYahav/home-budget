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
  /** Set for a savings line that has a goal. */
  goal?: GoalStatus;
}

/** A savings goal ("summer holiday, 8,000, by June"), as it stands at the end of one month. */
export interface GoalStatus {
  target: number;
  /** The month it is wanted by ("YYYY-MM"), when one was given. */
  due: string | null;
  /** Everything put aside so far, with what was saved before the app. */
  saved: number;
  /** target - saved, never negative. */
  left: number;
  /** saved / target, 0..1. */
  ratio: number;
  /**
   * What each month still has to bring to arrive on time: `left` over the months to the due
   * month, counting this month only while nothing was put aside in it. null with no due month,
   * and once the goal is reached.
   */
  neededPerMonth: number | null;
  /** The due month has passed and the goal is not reached. */
  late: boolean;
}

/**
 * @param savedBefore Put aside in this line in the months before `month`.
 * @param savedThisMonth Put aside in it during `month`.
 */
export function goalStatus(category: Category, month: string, savedBefore: number, savedThisMonth: number): GoalStatus | null {
  const target = category.goal_amount ?? 0;
  if (category.kind !== "saving" || target <= 0) return null;
  const due = category.goal_due ? monthOf(category.goal_due) : null;
  const saved = (category.fund_opening ?? 0) + savedBefore + savedThisMonth;
  const left = Math.max(target - saved, 0);

  let neededPerMonth: number | null = null;
  if (due && left > 0 && due >= month) {
    const [dueYear, dueMonth] = due.split("-").map(Number);
    const [year, monthNumber] = month.split("-").map(Number);
    const monthsAfter = (dueYear - year) * 12 + (dueMonth - monthNumber);
    // A month that already had its deposit is not counted on for another.
    neededPerMonth = left / Math.max(monthsAfter + (savedThisMonth > 0 ? 0 : 1), 1);
  }
  return {
    target,
    due,
    saved: round2(saved),
    left: round2(left),
    ratio: Math.min(saved / target, 1),
    neededPerMonth: neededPerMonth === null ? null : round2(neededPerMonth),
    late: due !== null && left > 0 && due < month,
  };
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

/** Where a month's cash withdrawals went. */
export interface CashWallet {
  /** Everything taken out of the bank in cash. */
  withdrawn: number;
  /** Bills paid in cash, taken off the withdrawals without being written down. */
  bills: { categoryId: string; name: string; amount: number }[];
  /** Purchases written down as paid in cash, as far as the withdrawals cover them. */
  purchases: number;
  /** What nobody said where it went. It still counts as spending, under the cash category. */
  undocumented: number;
}

/**
 * A withdrawal is not spending: it only moves money from the bank to the wallet. The spending
 * is what the cash pays for, so:
 *
 * - A bill marked as paid in cash (rent) takes its monthly amount from the month's
 *   withdrawals by itself, as an expense in its own category, unless something was already
 *   written down under it this month. Without enough withdrawn yet, it takes what there is,
 *   and the rest stays reserved as an unpaid bill.
 * - A purchase written down as paid in cash takes its amount off the withdrawals too.
 *   Beyond what was withdrawn it stays as it is: that cash came from elsewhere.
 * - Whatever is left of the withdrawals stays under the cash category, still counted as
 *   spending, so money nobody accounted for does not vanish from the month.
 *
 * Withdrawals are used oldest first. `covered` says how much of each (by id) was taken off.
 */
export function settleCash(
  transactions: Transaction[],
  categories: Category[],
): { transactions: Transaction[]; covered: Map<string, number>; wallet: CashWallet } {
  const covered = new Map<string, number>();
  const cashIds = new Set(categories.filter(isCashCategory).map((c) => c.id));
  const isWithdrawal = (t: Transaction) =>
    t.type === "expense" && t.category_id !== null && cashIds.has(t.category_id);

  const withdrawals = transactions
    .filter(isWithdrawal)
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at));
  const withdrawn = round2(withdrawals.reduce((sum, w) => sum + w.amount, 0));
  const wallet: CashWallet = { withdrawn, bills: [], purchases: 0, undocumented: withdrawn };

  // Bills first: they are what the cash is drawn for.
  let available = withdrawn;
  const billRows: Transaction[] = [];
  for (const category of categories) {
    if (!category.paid_in_cash || category.archived || category.kind !== "expense" || isCashCategory(category)) continue;
    if (category.monthly_budget <= 0 || available <= 0) continue;
    if (transactions.some((t) => t.type === "expense" && t.category_id === category.id)) continue;
    const amount = round2(Math.min(category.monthly_budget, available));
    available = round2(available - amount);
    wallet.bills.push({ categoryId: category.id, name: category.name, amount });
    billRows.push({
      id: `cash-bill:${category.id}`,
      user_id: null,
      type: "expense",
      amount,
      category_id: category.id,
      description: `${category.name} (במזומן)`,
      occurred_on: withdrawals[0].occurred_on,
      source: "manual",
      paid_in_cash: true,
      created_at: withdrawals[0].created_at,
    });
  }

  let purchases = 0;
  for (const t of transactions) {
    if (t.type === "expense" && t.paid_in_cash && !isWithdrawal(t)) purchases += t.amount;
  }
  const billsTotal = withdrawn - available;
  let pool = round2(billsTotal + purchases);
  if (cashIds.size === 0 || pool === 0) return { transactions, covered, wallet };

  for (const withdrawal of withdrawals) {
    if (pool <= 0) break;
    const taken = Math.min(withdrawal.amount, pool);
    covered.set(withdrawal.id, round2(taken));
    pool = round2(pool - taken);
  }
  const coveredTotal = [...covered.values()].reduce((sum, n) => sum + n, 0);
  wallet.purchases = round2(coveredTotal - billsTotal);
  wallet.undocumented = round2(withdrawn - coveredTotal);

  const settled: Transaction[] = [];
  for (const t of transactions) {
    const taken = covered.get(t.id);
    if (taken === undefined) settled.push(t);
    else if (t.amount - taken > 0.004) settled.push({ ...t, amount: round2(t.amount - taken) });
  }
  return { transactions: [...settled, ...billRows], covered, wallet };
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
  /** Put aside before this month in each savings line that has a goal, by category id. */
  goalSaved?: Record<string, number>;
  /** Shown beside the summary; the sums above already account for it. */
  cash?: CashWallet;
}): MonthSummary {
  const { month, today, transactions, recurringIncomes } = input;
  // The cash category holds what is left of the withdrawals: spending, but not a budget line.
  const categories = input.categories.filter((c) => !c.archived && !isCashCategory(c));
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
    const goal = goalStatus(category, month, input.goalSaved?.[category.id] ?? 0, categorySpent);
    // Reaching a savings target is the goal, so savings lines are never flagged.
    if (category.kind === "expense") {
      if (ratio === null ? categorySpent > 0 : ratio > 1) status = "over";
      else if (ratio !== null && ratio >= WARNING_RATIO) status = "warning";
    } else if (fund && fund.shortfall > 0) {
      status = "over";
    }
    return { category, spent: round2(categorySpent), ratio: fund ? null : ratio, status, ...(fund ? { fund } : {}), ...(goal ? { goal } : {}) };
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
