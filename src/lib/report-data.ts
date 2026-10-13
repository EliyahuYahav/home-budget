// Reads what the monthly report is built from. Kept apart from report.ts, which is pure.
import { settleCash } from "./budget";
import { getCategories, getFundHistory, getGoalSaved, getRecurringIncomes, getTransactions, type AppContext } from "./data";
import { shiftMonth } from "./dates";
import { siteUrl } from "./email";
import { buildReport, REPORT_MONTHS, type MonthlyReport } from "./report";

export async function collectReport(ctx: AppContext, month: string): Promise<MonthlyReport> {
  const months = Array.from({ length: REPORT_MONTHS }, (_, i) => shiftMonth(month, i - (REPORT_MONTHS - 1)));
  // One query per month keeps each well under the API's row limit.
  const [categories, recurringIncomes, ...rawPerMonth] = await Promise.all([
    getCategories(ctx),
    getRecurringIncomes(ctx),
    ...months.map((m) => getTransactions(ctx, m)),
  ]);
  const [fundHistory, goalSaved] = await Promise.all([
    getFundHistory(ctx, categories, month),
    getGoalSaved(ctx, categories, month),
  ]);
  return buildReport({
    month,
    householdName: ctx.household.name,
    siteUrl: siteUrl(),
    categories,
    recurringIncomes,
    perMonth: rawPerMonth.map((rows) => settleCash(rows, categories).transactions),
    fundHistory,
    goalSaved,
  });
}
