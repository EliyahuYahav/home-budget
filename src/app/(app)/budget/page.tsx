import { addCategory, saveCategory } from "@/app/actions";
import { Card, Money, MonthNav, PageTitle, ProgressBar } from "@/components/ui";
import { summarizeMonth, type CategoryStatus } from "@/lib/budget";
import { getMonthData, requireContext } from "@/lib/data";
import { isValidMonth, monthOf, todayISO } from "@/lib/dates";

function CategoryRow({ row }: { row: CategoryStatus }) {
  const { category, spent, ratio, status } = row;
  const saving = category.kind === "saving";
  const left = category.monthly_budget - spent;
  const tone = status === "over" ? "text-danger" : status === "warning" ? "text-warn" : "text-muted";

  return (
    <li>
      <details>
        <summary className="cursor-pointer space-y-1.5 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span>{category.name}</span>
            <span className="text-sm">
              <Money amount={spent} /> מתוך <Money amount={category.monthly_budget} />
            </span>
          </div>
          <ProgressBar label={category.name} ratio={ratio ?? (spent > 0 ? 1 : 0)} status={status} />
          <p className={`text-xs ${tone}`}>
            {saving ? (
              left > 0 ? (
                <>
                  נשאר להפריש <Money amount={left} />
                </>
              ) : (
                "היעד החודשי הושג"
              )
            ) : left >= 0 ? (
              <>
                נשאר <Money amount={left} />
              </>
            ) : (
              <>
                חריגה של <Money amount={-left} />
              </>
            )}
          </p>
        </summary>

        <form action={saveCategory} className="grid grid-cols-2 gap-3 px-3 pb-3">
          <input type="hidden" name="id" value={category.id} />
          <label className="space-y-1">
            <span className="text-sm font-medium">שם</span>
            <input className="field" name="name" defaultValue={category.name} required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">תקציב חודשי</span>
            <input
              className="field num"
              name="monthlyBudget"
              inputMode="decimal"
              defaultValue={category.monthly_budget}
              required
            />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-sm font-medium">סוג</span>
            <select className="field" name="kind" defaultValue={category.kind}>
              <option value="expense">הוצאה</option>
              <option value="saving">חיסכון (מופרש בתחילת החודש)</option>
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="isFixed" defaultChecked={category.is_fixed} />
            חשבון קבוע (הסכום נשמר בצד עד שהוא משולם)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="archived" />
            להסתיר את הקטגוריה (ההוצאות שנרשמו בה נשמרות)
          </label>
          <button className="btn col-span-2">שמירה</button>
        </form>
      </details>
    </li>
  );
}

function Group({ title, note, rows }: { title: string; note: string; rows: CategoryStatus[] }) {
  if (rows.length === 0) return null;
  const planned = rows.reduce((sum, r) => sum + r.category.monthly_budget, 0);
  const actual = rows.reduce((sum, r) => sum + r.spent, 0);
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">
          <Money amount={actual} /> מתוך <Money amount={planned} />
        </p>
      </div>
      <p className="text-sm text-muted">{note}</p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {rows.map((row) => (
          <CategoryRow key={row.category.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const ctx = await requireContext();
  const today = todayISO();
  const requested = (await searchParams).m;
  const month = isValidMonth(requested) ? requested : monthOf(today);
  const summary = summarizeMonth({ month, today, ...(await getMonthData(ctx, month)) });

  const savings = summary.categories.filter((r) => r.category.kind === "saving");
  const fixed = summary.categories.filter((r) => r.category.kind === "expense" && r.category.is_fixed);
  const flexible = summary.categories.filter((r) => r.category.kind === "expense" && !r.category.is_fixed);
  const planned = summary.categories.reduce((sum, r) => sum + r.category.monthly_budget, 0);
  // With no income entered, summary.income already equals the planned total.
  const unassigned = summary.income - planned;

  return (
    <>
      <PageTitle>תקציב מול ביצוע</PageTitle>
      <MonthNav month={month} basePath="/budget" />

      <Card className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>הכנסות החודש{summary.incomeIsEstimated ? " (הערכה)" : ""}</span>
          <Money amount={summary.income} />
        </div>
        <div className="flex justify-between">
          <span>סך התקציב המתוכנן</span>
          <Money amount={planned} />
        </div>
        {!summary.incomeIsEstimated && (
          <div
            className={`flex justify-between font-semibold ${unassigned < 0 ? "text-danger" : ""}`}
          >
            <span>{unassigned < 0 ? "התקציב גבוה מההכנסות ב־" : "עוד לא קיבל תפקיד"}</span>
            <Money amount={Math.abs(unassigned)} />
          </div>
        )}
        {summary.uncategorizedSpent > 0 && (
          <div className="flex justify-between text-warn">
            <span>הוצאות ללא קטגוריה</span>
            <Money amount={summary.uncategorizedSpent} />
          </div>
        )}
      </Card>

      <Group
        title="חיסכון קודם"
        note="מופרש מההכנסה בתחילת החודש, לפני כל השאר."
        rows={savings}
      />
      <Group
        title="חשבונות קבועים"
        note="הסכום שעוד לא שולם נשמר בצד ולא נכלל במה שמותר להוציא."
        rows={fixed}
      />
      <Group title="הוצאות משתנות" note="לחיצה על שורה פותחת עריכה." rows={flexible} />

      <details className="rounded-2xl border border-line bg-card p-4">
        <summary className="cursor-pointer font-semibold">קטגוריה חדשה</summary>
        <form action={addCategory} className="mt-3 grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">שם</span>
            <input className="field" name="name" required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">תקציב חודשי</span>
            <input className="field num" name="monthlyBudget" inputMode="decimal" defaultValue={0} />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-sm font-medium">סוג</span>
            <select className="field" name="kind" defaultValue="expense">
              <option value="expense">הוצאה</option>
              <option value="saving">חיסכון (מופרש בתחילת החודש)</option>
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="isFixed" />
            חשבון קבוע
          </label>
          <button className="btn col-span-2">הוספה</button>
        </form>
      </details>
    </>
  );
}
