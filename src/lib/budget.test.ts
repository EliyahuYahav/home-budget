import { describe, expect, it } from "vitest";
import { dailySpending, formatILS, fundStatus, goalStatus, settleCash, summarizeMonth } from "./budget";
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
const tx = (amount: number, categoryId: string | null, over: Partial<Transaction> = {}): Transaction => ({
  id: String(nextId++),
  user_id: "u1",
  type: "expense",
  amount,
  category_id: categoryId,
  description: "",
  occurred_on: "2026-10-05",
  source: "manual",
  created_at: "2026-10-05T10:00:00Z",
  ...over,
});

const categories = [
  category("savings", { kind: "saving", monthly_budget: 2000 }),
  category("rent", { is_fixed: true, monthly_budget: 2700 }),
  category("groceries", { monthly_budget: 1800 }),
  category("fun", { monthly_budget: 300 }),
];

describe("summarizeMonth", () => {
  it("sets savings aside first and reserves unpaid fixed bills", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11", // 21 days left including today
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(900, "groceries"), tx(100, "fun")],
    });

    expect(summary.income).toBe(12000);
    expect(summary.savingsReserved).toBe(2000);
    expect(summary.spent).toBe(1000);
    expect(summary.remaining).toBe(9000);
    expect(summary.fixedReserve).toBe(2700); // rent not paid yet
    expect(summary.flexibleRemaining).toBe(6300);
    expect(summary.daysLeft).toBe(21);
    expect(summary.safeToSpendToday).toBe(300);
  });

  it("does not count a paid fixed bill twice", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(2700, "rent")],
    });
    expect(summary.fixedReserve).toBe(0);
    expect(summary.flexibleRemaining).toBe(12000 - 2000 - 2700);
  });

  it("moving money to savings uses the reserve instead of reducing spendable money", () => {
    const base = { month: "2026-10", today: "2026-10-11", categories };
    const incomes = [{ id: "i1", name: "salary", amount: 12000 }];
    const before = summarizeMonth({ ...base, recurringIncomes: incomes, transactions: [] });
    const after = summarizeMonth({ ...base, recurringIncomes: incomes, transactions: [tx(2000, "savings")] });

    expect(after.saved).toBe(2000);
    expect(after.spent).toBe(0);
    expect(after.flexibleRemaining).toBe(before.flexibleRemaining);
  });

  it("saving more than the target reduces what is left to spend", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(2500, "savings")],
    });
    expect(summary.savingsReserved).toBe(2500);
    expect(summary.remaining).toBe(9500);
  });

  it("adds one-off income on top of fixed income", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(1500, null, { type: "income" })],
    });
    expect(summary.extraIncome).toBe(1500);
    expect(summary.income).toBe(13500);
    expect(summary.spent).toBe(0);
  });

  it("falls back to the planned budget when no income is entered", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [],
      transactions: [],
    });
    expect(summary.incomeIsEstimated).toBe(true);
    expect(summary.income).toBe(6800);
  });

  it("flags categories at 80% and over budget, but never savings", () => {
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [],
      transactions: [tx(1440, "groceries"), tx(301, "fun"), tx(2500, "savings")],
    });
    const status = Object.fromEntries(summary.categories.map((c) => [c.category.id, c.status]));
    expect(status.groceries).toBe("warning");
    expect(status.fun).toBe("over");
    expect(status.savings).toBe("ok");
    expect(status.rent).toBe("ok");
  });

  it("counts uncategorized and archived-category spending as spent", () => {
    const withArchived = [...categories, category("old", { archived: true, monthly_budget: 500 })];
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories: withArchived,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(50, null), tx(70, "old")],
    });
    expect(summary.uncategorizedSpent).toBe(50);
    expect(summary.spent).toBe(120);
    expect(summary.categories.some((c) => c.category.id === "old")).toBe(false);
  });

  it("never shows a negative daily amount, and nothing for a finished month", () => {
    const overspent = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 3000 }],
      transactions: [tx(2000, "fun")],
    });
    expect(overspent.flexibleRemaining).toBeLessThan(0);
    expect(overspent.safeToSpendToday).toBe(0);

    const past = summarizeMonth({
      month: "2026-09",
      today: "2026-10-11",
      categories,
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [],
    });
    expect(past.daysLeft).toBe(0);
    expect(past.safeToSpendToday).toBe(0);
  });
});

describe("formatILS", () => {
  it("rounds to whole shekels with thousands separators", () => {
    expect(formatILS(1234.5)).toBe("₪1,235");
    expect(formatILS(-80)).toBe("-₪80");
    expect(formatILS(0)).toBe("₪0");
  });
});

describe("settleCash", () => {
  const withCash = [...categories, category("cash", { name: "מזומן", monthly_budget: 800 })];

  it("takes a cash purchase off the withdrawal and keeps the purchase in its own category", () => {
    const withdrawal = tx(300, "cash");
    const purchase = tx(120, "groceries", { paid_in_cash: true });
    const { transactions, covered } = settleCash([withdrawal, purchase], withCash);
    expect(transactions.map((t) => [t.category_id, t.amount])).toEqual([
      ["cash", 180],
      ["groceries", 120],
    ]);
    expect(covered.get(withdrawal.id)).toBe(120);
    // The same money is counted once.
    const summary = summarizeMonth({ month: "2026-10", today: "2026-10-10", categories: withCash, transactions, recurringIncomes: [] });
    expect(summary.spent).toBe(300);
  });

  it("uses up the oldest withdrawal first and drops one that is fully spent", () => {
    const first = tx(100, "cash", { occurred_on: "2026-10-02" });
    const second = tx(200, "cash", { occurred_on: "2026-10-08" });
    const purchase = tx(150, "fun", { paid_in_cash: true });
    const { transactions, covered } = settleCash([second, purchase, first], withCash);
    expect(transactions.map((t) => [t.category_id, t.amount])).toEqual([
      ["cash", 150],
      ["fun", 150],
    ]);
    expect(covered.get(first.id)).toBe(100);
    expect(covered.get(second.id)).toBe(50);
  });

  it("leaves cash purchases beyond the withdrawals as they are", () => {
    const withdrawal = tx(50, "cash");
    const purchase = tx(80, "groceries", { paid_in_cash: true });
    const { transactions } = settleCash([withdrawal, purchase], withCash);
    expect(transactions.map((t) => [t.category_id, t.amount])).toEqual([["groceries", 80]]);
  });

  it("changes nothing without cash purchases, or without a cash category", () => {
    const rows = [tx(300, "cash"), tx(120, "groceries")];
    expect(settleCash(rows, withCash).transactions).toBe(rows);
    const flagged = [tx(120, "groceries", { paid_in_cash: true })];
    expect(settleCash(flagged, categories).transactions).toBe(flagged);
  });

  it("does not take a withdrawal off itself or touch income", () => {
    const withdrawal = tx(300, "cash", { paid_in_cash: true });
    const income = tx(500, null, { type: "income" });
    const { transactions } = settleCash([withdrawal, income], withCash);
    expect(transactions.map((t) => t.amount)).toEqual([300, 500]);
  });
});

describe("funds for yearly expenses", () => {
  const insurance = category("insurance", {
    kind: "fund",
    monthly_budget: 250,
    fund_start: "2026-06-01",
    fund_opening: 500,
  });
  const charged = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it("gathers the monthly amount from the month the fund began", () => {
    // June to October is five months: 500 + 5 x 250.
    expect(fundStatus(insurance, "2026-10", charged({}))).toEqual({
      before: 1500,
      contribution: 250,
      paid: 0,
      shortfall: 0,
      balance: 1750,
    });
    expect(fundStatus(insurance, "2026-06", charged({})).balance).toBe(750);
  });

  it("pays a charge from what has gathered", () => {
    const fund = fundStatus(insurance, "2026-10", charged({ "2026-10": 1600 }));
    expect(fund).toMatchObject({ paid: 1600, shortfall: 0, balance: 150 });
    // A charge in an earlier month is already out of the fund.
    expect(fundStatus(insurance, "2026-10", charged({ "2026-08": 1000 })).balance).toBe(750);
  });

  it("leaves to the month what the fund cannot pay, and starts again from nothing", () => {
    const fund = fundStatus(insurance, "2026-10", charged({ "2026-10": 3000 }));
    expect(fund).toMatchObject({ paid: 1750, shortfall: 1250, balance: 0 });
    // The month after an emptied fund holds one contribution, not a debt.
    expect(fundStatus(insurance, "2026-11", charged({ "2026-10": 3000 })).balance).toBe(250);
  });

  it("is an ordinary expense before the fund began", () => {
    expect(fundStatus(insurance, "2026-05", charged({ "2026-05": 400 }))).toEqual({
      before: 0,
      contribution: 0,
      paid: 0,
      shortfall: 400,
      balance: 0,
    });
  });

  it("sets the contribution aside and keeps a paid charge out of the month", () => {
    const input = {
      month: "2026-10",
      today: "2026-10-11",
      categories: [...categories, insurance],
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      fundHistory: [{ category_id: "insurance", amount: 1000, occurred_on: "2026-08-20" }],
    };
    const quiet = summarizeMonth({ ...input, transactions: [tx(900, "groceries")] });
    expect(quiet.fundsReserved).toBe(250);
    expect(quiet.fundsBalance).toBe(750);
    expect(quiet.remaining).toBe(12000 - 2000 - 250 - 900);

    // 700 of the fund's 750 pays the bill: the month is exactly where it was.
    const paid = summarizeMonth({ ...input, transactions: [tx(900, "groceries"), tx(700, "insurance")] });
    expect(paid.spent).toBe(900);
    expect(paid.remaining).toBe(quiet.remaining);
    expect(paid.fundsBalance).toBe(50);
    const row = paid.categories.find((c) => c.category.id === "insurance")!;
    expect(row).toMatchObject({ spent: 700, ratio: null, status: "ok" });

    // 1,000 is 250 more than the fund holds; only that comes off the month.
    const short = summarizeMonth({ ...input, transactions: [tx(900, "groceries"), tx(1000, "insurance")] });
    expect(short.spent).toBe(1150);
    expect(short.categories.find((c) => c.category.id === "insurance")!.status).toBe("over");
  });

  it("keeps a fund's charge out of the day-to-day spending", () => {
    const days = dailySpending("2026-10", [tx(900, "groceries"), tx(700, "insurance")], [...categories, insurance]);
    expect(days[4]).toBe(900);
  });

  it("counts a hidden fund's charges as ordinary spending", () => {
    const hidden = { ...insurance, archived: true };
    const summary = summarizeMonth({
      month: "2026-10",
      today: "2026-10-11",
      categories: [...categories, hidden],
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(700, "insurance")],
    });
    expect(summary.fundsReserved).toBe(0);
    expect(summary.spent).toBe(700);
  });
});

describe("savings goals", () => {
  const holiday = category("holiday", {
    kind: "saving",
    monthly_budget: 500,
    goal_amount: 8000,
    goal_due: "2027-06-01",
    fund_opening: 1000,
  });

  it("adds up what was saved before the app, in earlier months and this month", () => {
    const goal = goalStatus(holiday, "2026-10", 1500, 500)!;
    expect(goal).toMatchObject({ target: 8000, due: "2027-06", saved: 3000, left: 5000, late: false });
    expect(goal.ratio).toBeCloseTo(0.375);
    // This month's deposit is in: eight months are left, November to June.
    expect(goal.neededPerMonth).toBe(625);
  });

  it("counts this month while nothing was put aside in it", () => {
    // 6,300 left over nine months, October to June.
    expect(goalStatus(holiday, "2026-10", 700, 0)!.neededPerMonth).toBe(700);
  });

  it("is reached, late, or without a date", () => {
    expect(goalStatus(holiday, "2026-10", 7000, 500)).toMatchObject({ left: 0, ratio: 1, neededPerMonth: null, late: false });
    expect(goalStatus(holiday, "2027-07", 2000, 0)).toMatchObject({ left: 5000, neededPerMonth: null, late: true });
    expect(goalStatus({ ...holiday, goal_due: null }, "2026-10", 0, 0)).toMatchObject({ due: null, neededPerMonth: null, late: false });
  });

  it("exists only for a savings line that was given a goal", () => {
    expect(goalStatus({ ...holiday, goal_amount: null }, "2026-10", 0, 0)).toBeNull();
    expect(goalStatus({ ...holiday, kind: "expense" }, "2026-10", 0, 0)).toBeNull();
  });

  it("rides on the month's summary without changing its sums", () => {
    const input = {
      month: "2026-10",
      today: "2026-10-11",
      recurringIncomes: [{ id: "i1", name: "salary", amount: 12000 }],
      transactions: [tx(500, "holiday")],
    };
    const plain = summarizeMonth({ ...input, categories: [...categories, { ...holiday, goal_amount: null }] });
    const withGoal = summarizeMonth({ ...input, categories: [...categories, holiday], goalSaved: { holiday: 1500 } });
    expect(withGoal.remaining).toBe(plain.remaining);
    expect(withGoal.categories.find((c) => c.category.id === "holiday")!.goal).toMatchObject({ saved: 3000 });
    expect(plain.categories.find((c) => c.category.id === "holiday")!.goal).toBeUndefined();
  });
});

describe("the cash wallet", () => {
  const cash = category("cash", { name: "מזומן", monthly_budget: 4000 });
  const rent = category("rent", { is_fixed: true, monthly_budget: 2700, paid_in_cash: true });
  const cats = [category("groceries", { monthly_budget: 1800 }), rent, cash];

  it("pays a cash bill from the withdrawals by itself, and leaves the rest undocumented", () => {
    const withdrawal = tx(3000, "cash", { occurred_on: "2026-10-02" });
    const { transactions, wallet } = settleCash([withdrawal], cats);
    expect(transactions.map((t) => [t.category_id, t.amount])).toEqual([
      ["cash", 300],
      ["rent", 2700],
    ]);
    expect(wallet).toEqual({
      withdrawn: 3000,
      bills: [{ categoryId: "rent", name: "rent", amount: 2700 }],
      purchases: 0,
      undocumented: 300,
      misfiled: { count: 0, amount: 0, example: "" },
      stray: { count: 0, amount: 0 },
    });
  });

  it("takes only what was withdrawn, and keeps the rest of the bill reserved", () => {
    const { transactions } = settleCash([tx(1000, "cash")], cats);
    const summary = summarizeMonth({ month: "2026-10", today: "2026-10-10", categories: cats, transactions, recurringIncomes: [] });
    expect(summary.categories.find((c) => c.category.id === "rent")!.spent).toBe(1000);
    expect(summary.fixedReserve).toBe(1700);
    // Nothing withdrawn yet: the rent is simply unpaid.
    expect(settleCash([], cats).wallet.bills).toEqual([]);
  });

  it("leaves a bill alone once something was written down under it", () => {
    const { wallet } = settleCash([tx(3000, "cash"), tx(2700, "rent")], cats);
    expect(wallet.bills).toEqual([]);
    expect(wallet.undocumented).toBe(3000);
  });

  it("covers the bill before cash purchases, and splits the rest", () => {
    const { wallet } = settleCash([tx(3000, "cash"), tx(200, "groceries", { paid_in_cash: true })], cats);
    expect(wallet).toMatchObject({ withdrawn: 3000, purchases: 200, undocumented: 100 });
  });

  it("keeps the cash category out of the budget, but its leftover in the spending", () => {
    const { transactions } = settleCash([tx(3000, "cash")], cats);
    const summary = summarizeMonth({ month: "2026-10", today: "2026-10-10", categories: cats, transactions, recurringIncomes: [] });
    expect(summary.categories.map((c) => c.category.id)).not.toContain("cash");
    expect(summary.spent).toBe(3000);
    // The cash category's old budget is not part of the plan either.
    expect(summary.income).toBe(1800 + 2700);
  });

  it("points out bank lines filed as cash that are not ATM withdrawals", () => {
    const card = tx(5324, "cash", { source: "bank", description: "חיוב לכרטיס ויזה 5241" });
    const atm = tx(3200, "cash", { source: "bank", description: "מש' מכספומט דיסקונט 10/09" });
    const byHand = tx(500, "cash", { source: "chat", description: "משכתי" });
    expect(settleCash([card, atm, byHand], cats).wallet.misfiled).toEqual({
      count: 1,
      amount: 5324,
      example: "חיוב לכרטיס ויזה 5241",
    });
  });

  it("points out ATM withdrawals filed somewhere else", () => {
    const elsewhere = tx(400, null, { source: "bank", description: "מש' מכספומט דיסקונט 02/10" });
    expect(settleCash([elsewhere], cats).wallet.stray).toEqual({ count: 1, amount: 400 });
  });
});
