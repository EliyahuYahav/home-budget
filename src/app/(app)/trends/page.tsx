import { Card, EmptyNote, Money, MonthNav, PageTitle, SectionTitle } from "@/components/ui";
import { dailySpending, formatILS, settleCash, summarizeMonth } from "@/lib/budget";
import { getCategories, getRecurringIncomes, getTransactions, requireContext } from "@/lib/data";
import { isValidMonth, monthLabel, monthOf, shiftMonth, shortDate, todayISO } from "@/lib/dates";
import {
  averageMonth,
  categoryTotals,
  categoryTrends,
  changeFrom,
  monthlyTotals,
  projectedSpending,
  topPayees,
} from "@/lib/trends";

const MONTHS_SHOWN = 6;
const CATEGORIES_SHOWN = 7;
const TRENDS_SHOWN = 8;
const PAYEES_SHOWN = 8;

/** 8,400 -> "8.4K", so six bar labels fit across a phone. */
function compact(amount: number): string {
  if (amount >= 10000) return `${Math.round(amount / 1000)}K`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(amount));
}

const shortMonth = (month: string) => monthLabel(month).split(" ")[0];

export default async function TrendsPage({ searchParams }: PageProps<"/trends">) {
  const ctx = await requireContext();
  const today = todayISO();
  const requested = (await searchParams).m;
  const month = isValidMonth(requested) ? requested : monthOf(today);
  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(month, i - (MONTHS_SHOWN - 1)));

  // One query per month keeps each well under the API's row limit.
  const [categories, recurringIncomes, ...rawPerMonth] = await Promise.all([
    getCategories(ctx),
    getRecurringIncomes(ctx),
    ...months.map((m) => getTransactions(ctx, m)),
  ]);
  // Cash purchases come off each month's cash withdrawals, as in every other total.
  const perMonth = rawPerMonth.map((rows) => settleCash(rows, categories).transactions);
  const transactions = perMonth[perMonth.length - 1];

  const totals = monthlyTotals({ months, transactions: perMonth.flat(), categories, recurringIncomes });
  const current = totals[totals.length - 1];
  const previous = totals[totals.length - 2];
  const change = previous.hasData ? changeFrom(current.spent, previous.spent) : null;

  const summary = summarizeMonth({ month, today, categories, transactions, recurringIncomes });
  const flexibleSpent = dailySpending(month, transactions, categories).reduce((a, b) => a + b, 0);
  const projected = projectedSpending({
    month,
    today,
    spent: summary.spent,
    flexibleSpent,
    fixedReserve: summary.fixedReserve,
  });
  const spendable = summary.income - summary.savingsReserved;

  const byCategory = categoryTotals(transactions, categories);
  const shown = byCategory.slice(0, CATEGORIES_SHOWN);
  const rest = byCategory.slice(CATEGORIES_SHOWN);
  const restSpent = rest.reduce((sum, c) => sum + c.spent, 0);
  const largestShare = shown[0]?.share ?? 0;

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const biggest = transactions
    .filter((t) => t.type === "expense")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const allTransactions = perMonth.flat();
  const average = averageMonth(totals, month);
  const trends = categoryTrends({ month, months, transactions: allTransactions, categories })
    // A category of a few shekels either way is noise next to the others.
    .filter((trend) => Math.max(trend.current, trend.average) >= 20)
    .slice(0, TRENDS_SHOWN);
  const trendMax = Math.max(...trends.map((trend) => Math.max(trend.current, trend.average)), 1);
  const payees = topPayees(allTransactions, categories, PAYEES_SHOWN);
  const monthsWithData = totals.filter((t) => t.hasData).length;
  const isCurrentMonth = month === monthOf(today);
  const left = summary.income - summary.spent - summary.saved;

  const chartMax = Math.max(...totals.map((t) => Math.max(t.spent, t.income)), 1);
  const hasIncome = totals.some((t) => t.income > 0);
  const overCount = summary.categories.filter((c) => c.status === "over").length;

  return (
    <>
      <PageTitle>מגמות</PageTitle>
      <MonthNav month={month} basePath="/trends" />

      {!current.hasData ? (
        <EmptyNote>עוד לא נרשם כלום ב{monthLabel(month)}.</EmptyNote>
      ) : (
        <>
          <Card tour="trends-summary" className="space-y-3">
            <SectionTitle>סיכום {monthLabel(month)}</SectionTitle>
            <dl className="grid grid-cols-3 text-center">
              <div>
                <dt className="text-sm text-muted">נכנס</dt>
                <dd className="text-lg font-bold">
                  <Money amount={summary.income} />
                </dd>
              </div>
              <div className="border-s border-line">
                <dt className="text-sm text-muted">יצא</dt>
                <dd className="text-lg font-bold">
                  <Money amount={summary.spent} />
                </dd>
              </div>
              <div className="border-s border-line">
                <dt className="text-sm text-muted">נחסך</dt>
                <dd className="text-lg font-bold text-good">
                  <Money amount={summary.saved} />
                </dd>
              </div>
            </dl>
            <ul className="space-y-1.5 border-t border-line pt-3 text-[0.95rem]">
              {summary.incomeIsEstimated && (
                <li className="text-muted">
                  לא הוגדרו הכנסות, אז &quot;נכנס&quot; הוא סך התקציב המתוכנן.
                </li>
              )}
              {change !== null && Math.abs(change) >= 0.01 && (
                <li>
                  הוצאתם {Math.round(Math.abs(change) * 100)}% {change > 0 ? "יותר" : "פחות"} מאשר ב
                  {shortMonth(previous.month)} (<Money amount={previous.spent} />
                  ).
                </li>
              )}
              {projected !== null && (
                <li className={projected > spendable ? "text-danger" : ""}>
                  בקצב הנוכחי תסיימו את החודש עם הוצאות של <Money amount={projected} className="font-bold" />
                  {projected > spendable ? (
                    <>
                      , <Money amount={projected - spendable} /> מעל מה שנשאר אחרי החיסכון.
                    </>
                  ) : (
                    <>
                      , ויישארו <Money amount={spendable - projected} />.
                    </>
                  )}
                </li>
              )}
              {!summary.incomeIsEstimated && summary.income > 0 && (
                <li className={left < 0 ? "text-danger" : ""}>
                  {left >= 0 ? (
                    <>
                      נשארו <Money amount={left} className="font-bold" />, שהם{" "}
                      <span className="num">{Math.round((left / summary.income) * 100)}%</span> מההכנסה, אחרי הוצאות
                      וחיסכון.
                    </>
                  ) : (
                    <>
                      יצא <Money amount={-left} className="font-bold" /> יותר ממה שנכנס.
                    </>
                  )}
                </li>
              )}
              <li>
                {overCount === 0
                  ? "אף קטגוריה לא חרגה מהתקציב."
                  : overCount === 1
                    ? "קטגוריה אחת חרגה מהתקציב."
                    : `${overCount} קטגוריות חרגו מהתקציב.`}
              </li>
            </ul>
          </Card>

          <Card className="space-y-3">
            <SectionTitle>לאן הלך הכסף</SectionTitle>
            {shown.length === 0 ? (
              <p className="text-muted">אין הוצאות בחודש הזה.</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((c) => (
                  <li key={c.id ?? "none"} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span>{c.name}</span>
                      <span>
                        <Money amount={c.spent} className="font-bold" />{" "}
                        <span className="num text-sm text-muted">{Math.round(c.share * 100)}%</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-line" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max((c.share / largestShare) * 100, 2)}%` }}
                      />
                    </div>
                  </li>
                ))}
                {rest.length > 0 && (
                  <li className="flex items-baseline justify-between gap-2 text-muted">
                    <span>עוד {rest.length} קטגוריות</span>
                    <Money amount={restSpent} className="font-bold" />
                  </li>
                )}
              </ul>
            )}
          </Card>

          {biggest.length > 0 && (
            <Card className="space-y-1">
              <SectionTitle>ההוצאות הגדולות</SectionTitle>
              <ul className="divide-y divide-line">
                {biggest.map((t) => {
                  const label = categoryName.get(t.category_id ?? "") ?? "ללא קטגוריה";
                  return (
                    <li key={t.id} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{t.description || label}</span>
                        <span className="block truncate text-sm text-muted">
                          {label}, <span className="num">{shortDate(t.occurred_on)}</span>
                        </span>
                      </span>
                      <Money amount={t.amount} className="font-bold" />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      {trends.length > 0 && (
        <Card className="space-y-3">
          <div>
            <SectionTitle>מול חודש רגיל</SectionTitle>
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="inline-block h-3 w-0.5 bg-ink" aria-hidden="true" />
              הקו מסמן את הממוצע של {monthsWithData - 1 === 1 ? "החודש הקודם" : `${monthsWithData - 1} החודשים האחרים`}
              {isCurrentMonth ? "; החודש הנוכחי עוד לא נגמר" : ""}
            </p>
          </div>
          <ul className="space-y-3">
            {trends.map((trend) => {
              const over = trend.current > trend.average;
              return (
                <li key={trend.id ?? "none"} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{trend.name}</span>
                    <span>
                      <Money amount={trend.current} className={`font-bold ${over ? "text-warn" : ""}`} />{" "}
                      <span className="text-sm text-muted">
                        לרוב <Money amount={trend.average} />
                      </span>
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-line" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
                      style={{ width: `${(trend.current / trendMax) * 100}%` }}
                    />
                    <div
                      className="absolute -top-1 h-4 w-0.5 bg-ink"
                      style={{ insetInlineStart: `${(trend.average / trendMax) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {average && (
        <Card className="space-y-3">
          <SectionTitle>
            חודש ממוצע{average.months > 1 ? ` (לפי ${average.months} חודשים)` : " (לפי חודש אחד)"}
          </SectionTitle>
          <dl className="grid grid-cols-3 text-center">
            <div>
              <dt className="text-sm text-muted">נכנס</dt>
              <dd className="text-lg font-bold">
                <Money amount={average.income} />
              </dd>
            </div>
            <div className="border-s border-line">
              <dt className="text-sm text-muted">יצא</dt>
              <dd className="text-lg font-bold">
                <Money amount={average.spent} />
              </dd>
            </div>
            <div className="border-s border-line">
              <dt className="text-sm text-muted">נשאר</dt>
              <dd className={`text-lg font-bold ${average.left < 0 ? "text-danger" : "text-good"}`}>
                <Money amount={average.left} />
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted">
            בלי {monthLabel(month)}. &quot;נשאר&quot; הוא מה שנכנס פחות הוצאות וחיסכון.
          </p>
        </Card>
      )}

      {payees.length > 0 && monthsWithData > 1 && (
        <Card className="space-y-1">
          <SectionTitle>לאן הלך הכי הרבה בחצי השנה</SectionTitle>
          <ul className="divide-y divide-line">
            {payees.map((payee) => (
              <li key={payee.name} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{payee.name}</span>
                  <span className="block text-sm text-muted">
                    {payee.times === 1 ? "פעם אחת" : `${payee.times} פעמים`}
                  </span>
                </span>
                <Money amount={payee.spent} className="font-bold" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card tour="trends-chart" className="space-y-3">
        <div>
          <SectionTitle>הוצאות בחצי השנה האחרונה</SectionTitle>
          {hasIncome && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="inline-block h-0.5 w-5 bg-ink" aria-hidden="true" />
              הקו מסמן את ההכנסות באותו חודש
            </p>
          )}
        </div>
        <div className="flex h-44 items-stretch gap-2" aria-hidden="true">
          {totals.map((t) => (
            <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="num text-sm font-bold">{t.hasData ? compact(t.spent) : ""}</span>
              <div className="relative w-full flex-1">
                {t.hasData && (
                  <>
                    <div
                      className={`absolute inset-x-1.5 bottom-0 rounded-t ${
                        t.month === month ? "bg-accent" : "bg-accent/45"
                      }`}
                      style={{ height: `${Math.max((t.spent / chartMax) * 100, 1)}%` }}
                    />
                    {t.income > 0 && (
                      <div
                        className="absolute inset-x-0 h-0.5 bg-ink"
                        style={{ bottom: `${(t.income / chartMax) * 100}%` }}
                      />
                    )}
                  </>
                )}
              </div>
              <span className={`text-sm ${t.month === month ? "font-bold" : "text-muted"}`}>
                {shortMonth(t.month)}
              </span>
            </div>
          ))}
        </div>
        <table className="sr-only">
          <caption>הוצאות והכנסות לפי חודש</caption>
          <thead>
            <tr>
              <th>חודש</th>
              <th>הוצאות</th>
              <th>הכנסות</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.month}>
                <th>{monthLabel(t.month)}</th>
                <td>{t.hasData ? formatILS(t.spent) : "אין נתונים"}</td>
                <td>{t.hasData ? formatILS(t.income) : "אין נתונים"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totals.filter((t) => t.hasData).length < 2 && (
          <p className="text-sm text-muted">ההשוואה תתמלא ככל שיצטברו חודשים של שימוש.</p>
        )}
      </Card>
    </>
  );
}
