import Link from "next/link";
import { Card, Money, ProgressBar } from "@/components/ui";
import { summarizeMonth } from "@/lib/budget";
import { getMonthData, requireContext } from "@/lib/data";
import { monthLabel, monthOf, todayISO } from "@/lib/dates";

export default async function HomePage() {
  const ctx = await requireContext();
  const today = todayISO();
  const month = monthOf(today);
  const summary = summarizeMonth({ month, today, ...(await getMonthData(ctx, month)) });

  const flagged = summary.categories
    .filter((c) => c.status !== "ok")
    .sort((a, b) => (b.ratio ?? Infinity) - (a.ratio ?? Infinity));
  const overBudget = summary.flexibleRemaining < 0;

  return (
    <>
      <header>
        <p className="text-sm text-muted">{monthLabel(month)}</p>
        <h1 className="text-xl font-bold">שלום, {ctx.displayName}</h1>
      </header>

      <Card className={overBudget ? "border-danger" : ""}>
        <p className="text-sm text-muted">מותר להוציא היום</p>
        <p className={`mt-1 text-5xl font-bold ${overBudget ? "text-danger" : "text-accent"}`}>
          <Money amount={summary.safeToSpendToday} />
        </p>
        <p className="mt-2 text-sm text-muted">
          {overBudget ? (
            <>
              חרגתם ב־<Money amount={-summary.flexibleRemaining} /> ממה שפנוי החודש, אחרי חיסכון
              וחשבונות קבועים.
            </>
          ) : (
            <>
              נשארו <Money amount={summary.flexibleRemaining} /> פנויים ל־{summary.daysLeft} ימים,
              אחרי חיסכון וחשבונות קבועים.
            </>
          )}
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted">הכנסות</p>
          <p className="mt-1 font-bold">
            <Money amount={summary.income} />
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted">הוצאות</p>
          <p className="mt-1 font-bold">
            <Money amount={summary.spent} />
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted">נשאר</p>
          <p className={`mt-1 font-bold ${summary.remaining < 0 ? "text-danger" : ""}`}>
            <Money amount={summary.remaining} />
          </p>
        </Card>
      </div>

      {summary.incomeIsEstimated && (
        <p className="rounded-xl bg-warn-soft p-3 text-sm">
          עדיין לא הוגדרו הכנסות, אז החישוב נשען על סך התקציב המתוכנן.{" "}
          <Link href="/settings" className="font-semibold underline">
            להגדרת הכנסות
          </Link>
        </p>
      )}

      <Card className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">חיסכון קודם</h2>
          <p className="text-sm">
            <Money amount={summary.saved} /> מתוך <Money amount={summary.savingsTarget} />
          </p>
        </div>
        <ProgressBar
          label="התקדמות החיסכון החודשי"
          ratio={summary.savingsTarget > 0 ? summary.saved / summary.savingsTarget : 0}
        />
        <p className="text-sm text-muted">
          הסכום הזה מופרש מההכנסה בתחילת החודש, לפני שמחשבים כמה מותר להוציא.
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">דורש תשומת לב</h2>
          <Link href="/budget" className="text-sm text-accent underline">
            לכל התקציב
          </Link>
        </div>
        {flagged.length === 0 ? (
          <p className="text-sm text-muted">כל הקטגוריות בתוך התקציב.</p>
        ) : (
          <ul className="space-y-3">
            {flagged.slice(0, 5).map(({ category, spent, ratio, status }) => (
              <li key={category.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{category.name}</span>
                  <span className={status === "over" ? "text-danger" : "text-warn"}>
                    <Money amount={spent} /> מתוך <Money amount={category.monthly_budget} />
                  </span>
                </div>
                <ProgressBar label={category.name} ratio={ratio ?? 1} status={status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link href="/chat" className="btn w-full">
        לרשום הוצאה בבוט
      </Link>
    </>
  );
}
