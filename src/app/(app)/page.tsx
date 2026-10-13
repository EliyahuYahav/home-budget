import Link from "next/link";
import { DayStrip } from "@/components/day-strip";
import { ChevronEnd, GearIcon } from "@/components/icons";
import { QuickAdd } from "@/components/quick-add";
import { Card, Money, ProgressBar, SectionTitle } from "@/components/ui";
import { dailySpending, summarizeMonth } from "@/lib/budget";
import { getMonthData, requireContext } from "@/lib/data";
import { daysInMonth, monthLabel, monthOf, shortDate, todayISO } from "@/lib/dates";

export default async function HomePage() {
  const ctx = await requireContext();
  const today = todayISO();
  const month = monthOf(today);
  const data = await getMonthData(ctx, month);
  const summary = summarizeMonth({ month, today, ...data });

  const flagged = summary.categories
    .filter((c) => c.status !== "ok")
    .sort((a, b) => (b.ratio ?? Infinity) - (a.ratio ?? Infinity));
  const overBudget = summary.flexibleRemaining < 0;
  const funds = summary.categories.filter((c) => c.fund);
  const goals = summary.categories.filter((c) => c.goal);
  // What comes off the income before the day-to-day money, in words.
  const setAside = funds.length > 0 ? "חיסכון, קרנות וחשבונות קבועים" : "חיסכון וחשבונות קבועים";

  const days = dailySpending(month, data.transactions, data.categories);
  const flexibleSpent = days.reduce((sum, d) => sum + d, 0);
  // What an even day looks like: everything free for day-to-day spending, spread over the month.
  const plannedPerDay = Math.max(summary.flexibleRemaining + flexibleSpent, 0) / daysInMonth(month);

  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const recent = data.transactions.slice(0, 5);

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-muted">{monthLabel(month)}</p>
          <h1 className="font-display text-5xl font-bold leading-none">שלום, {ctx.displayName}</h1>
        </div>
        <Link
          href="/settings"
          data-tour="settings"
          className="panel flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold"
        >
          <GearIcon className="size-5 text-accent" />
          הגדרות
        </Link>
      </header>

      <section data-tour="today" className={`hero space-y-4 p-5 ${overBudget ? "hero-over" : ""}`}>
        <div>
          <h2 className="text-sm font-semibold tracking-[0.2em] text-hero-ink/75">מותר להוציא היום</h2>
          <p className="num font-display text-[6.5rem] font-bold leading-[0.9]">
            <span className="align-top text-4xl font-normal">₪</span>
            {Math.round(summary.safeToSpendToday).toLocaleString("en-US")}
          </p>
          <p className="mt-2 text-hero-ink/80">
            {overBudget ? (
              <>
                חרגתם ב־<Money amount={-summary.flexibleRemaining} /> ממה שפנוי החודש, אחרי {setAside}.
              </>
            ) : (
              <>
                נשארו <Money amount={summary.flexibleRemaining} className="font-bold" /> פנויים ל־
                {summary.daysLeft} ימים, אחרי {setAside}.
              </>
            )}
          </p>
        </div>
        <DayStrip days={days} todayIndex={Number(today.slice(8, 10)) - 1} plannedPerDay={plannedPerDay} />
      </section>

      <QuickAdd />

      <Card tour="numbers" className="grid grid-cols-3 !p-0 text-center">
        <div className="p-3">
          <p className="text-sm text-muted">{summary.incomeIsEstimated ? "הכנסות (הערכה)" : "הכנסות"}</p>
          <p className="font-display text-3xl font-bold">
            <Money amount={summary.income} />
          </p>
        </div>
        <div className="border-s border-line p-3">
          <p className="text-sm text-muted">הוצאות</p>
          <p className="font-display text-3xl font-bold">
            <Money amount={summary.spent} />
          </p>
        </div>
        <div className="border-s border-line p-3">
          <p className="text-sm text-muted">נשאר</p>
          <p className={`font-display text-3xl font-bold ${summary.remaining < 0 ? "text-danger" : ""}`}>
            <Money amount={summary.remaining} />
          </p>
        </div>
      </Card>

      {summary.incomeIsEstimated && (
        <p className="rounded-3xl bg-warn-soft p-4 text-[0.95rem]">
          עוד לא נרשמה הכנסה החודש, אז בינתיים החישוב מניח שההכנסה שווה לסך התקציב שתכננתם (
          <Money amount={summary.income} />
          ). המספר יתחלף בהכנסה האמיתית אחרי סנכרון מהבנק, או כשרושמים הכנסה בבוט או{" "}
          <Link href="/settings" className="font-bold underline">
            מגדירים הכנסה קבועה
          </Link>
          .
        </p>
      )}

      <Card className="space-y-2">
        <div className="flex items-baseline justify-between">
          <SectionTitle>חיסכון קודם</SectionTitle>
          <p>
            <Money amount={summary.saved} className="font-bold" /> מתוך{" "}
            <Money amount={summary.savingsTarget} />
          </p>
        </div>
        <ProgressBar
          label="התקדמות החיסכון החודשי"
          status="good"
          ratio={summary.savingsTarget > 0 ? summary.saved / summary.savingsTarget : 0}
        />
        <p className="text-sm text-muted">
          מופרש מההכנסה בתחילת החודש, לפני שמחשבים כמה מותר להוציא.
        </p>
        {goals.length > 0 && (
          <ul className="space-y-2.5 border-t border-line pt-2.5">
            {goals.map(({ category, goal }) => (
              <li key={category.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    {category.name}
                    {goal!.due ? <span className="text-sm text-muted">, עד {monthLabel(goal!.due)}</span> : null}
                  </span>
                  <span>
                    <Money amount={goal!.saved} className="font-bold" />{" "}
                    <span className="text-sm text-muted">
                      מתוך <Money amount={goal!.target} />
                    </span>
                  </span>
                </div>
                <ProgressBar label={`התקדמות ליעד ${category.name}`} status="good" ratio={goal!.ratio} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {funds.length > 0 && (
        <Card className="space-y-2">
          <div className="flex items-baseline justify-between">
            <SectionTitle>קרנות להוצאות שנתיות</SectionTitle>
            <p>
              <span className="text-sm text-muted">בקרנות</span>{" "}
              <Money amount={summary.fundsBalance} className="font-bold" />
            </p>
          </div>
          <ul className="divide-y divide-line">
            {funds.map(({ category, fund }) => (
              <li key={category.id} className="flex items-baseline justify-between gap-2 py-1.5">
                <span>{category.name}</span>
                <span>
                  <Money amount={fund!.balance} className="font-bold" />{" "}
                  <span className="text-sm text-muted">
                    (<Money amount={fund!.contribution} /> בחודש)
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            מופרשים כל חודש לחיובים שמגיעים פעם בשנה, כדי שלא יפילו את החודש שבו הם מגיעים.
          </p>
        </Card>
      )}

      {flagged.length > 0 && (
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between">
            <SectionTitle>דורש תשומת לב</SectionTitle>
            <Link href="/budget" className="text-sm font-bold text-accent">
              לכל התקציב
            </Link>
          </div>
          <ul className="space-y-3">
            {flagged.slice(0, 5).map(({ category, spent, ratio, status }) => (
              <li key={category.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span>{category.name}</span>
                  <span className={`text-sm ${status === "over" ? "text-danger" : "text-warn"}`}>
                    <Money amount={spent} className="font-bold" /> מתוך{" "}
                    <Money amount={category.monthly_budget} />
                  </span>
                </div>
                <ProgressBar label={category.name} ratio={ratio ?? 1} status={status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-1">
        <div className="flex items-baseline justify-between">
          <SectionTitle>נרשם לאחרונה</SectionTitle>
          <Link href="/transactions" className="text-sm font-bold text-accent">
            לכל ההוצאות
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-2 text-muted">עוד לא נרשם כלום החודש. כתבו הוצאה ראשונה בשורה שלמעלה.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((t) => {
              const income = t.type === "income";
              const label = income ? "הכנסה" : (categoryName.get(t.category_id ?? "") ?? "ללא קטגוריה");
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t.description || label}</span>
                    <span className="block truncate text-sm text-muted">
                      {label}, <span className="num">{shortDate(t.occurred_on)}</span>
                    </span>
                  </span>
                  <span className={`num font-bold ${income ? "text-good" : ""}`}>
                    {income ? "+" : ""}
                    <Money amount={t.amount} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Link
        href="/trends"
        className="flex items-center justify-between panel p-4 font-bold"
      >
        <span>סיכום החודש ומגמות</span>
        <ChevronEnd className="text-muted" />
      </Link>
    </>
  );
}
