import { addCategory, restoreCategory, saveCategory } from "@/app/actions";
import { ChevronDown, PlusIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
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
        <summary className="cursor-pointer space-y-1.5 p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{category.name}</span>
            <span>
              <Money amount={spent} className="font-bold" />{" "}
              <span className="text-sm text-muted">
                מתוך <Money amount={category.monthly_budget} />
              </span>
            </span>
          </div>
          <ProgressBar
            label={category.name}
            ratio={ratio ?? (spent > 0 ? 1 : 0)}
            status={saving ? "good" : status}
          />
          <p className={`text-sm ${tone}`}>
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

        <form action={saveCategory} className="grid grid-cols-2 gap-3 px-3.5 pb-3.5">
          <input type="hidden" name="id" value={category.id} />
          <label className="space-y-1">
            <span className="text-sm font-semibold">שם</span>
            <input className="field" name="name" defaultValue={category.name} required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">תקציב חודשי</span>
            <input
              className="field num"
              name="monthlyBudget"
              inputMode="decimal"
              defaultValue={category.monthly_budget}
              required
            />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-sm font-semibold">סוג</span>
            <select className="field" name="kind" defaultValue={category.kind}>
              <option value="expense">הוצאה</option>
              <option value="saving">חיסכון (מופרש בתחילת החודש)</option>
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2.5">
            <input type="checkbox" className="size-5 accent-accent" name="isFixed" defaultChecked={category.is_fixed} />
            חשבון קבוע (הסכום נשמר בצד עד שהוא משולם)
          </label>
          <label className="col-span-2 flex items-center gap-2.5">
            <input type="checkbox" className="size-5 accent-accent" name="archived" />
            להסתיר את הקטגוריה (ההוצאות שנרשמו בה נשמרות)
          </label>
          <SubmitButton className="btn col-span-2">שמירה</SubmitButton>
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
      <div className="px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <p>
            <Money amount={actual} className="font-bold" />{" "}
            <span className="text-sm text-muted">
              מתוך <Money amount={planned} />
            </span>
          </p>
        </div>
        <p className="text-sm text-muted">{note}</p>
      </div>
      <ul className="divide-y divide-line rounded-3xl bg-card shadow-card">
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
  const data = await getMonthData(ctx, month);
  const summary = summarizeMonth({ month, today, ...data });
  const hidden = data.categories.filter((c) => c.archived);

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

      <Card className="space-y-1.5">
        <div className="flex justify-between">
          <span>הכנסות החודש{summary.incomeIsEstimated ? " (הערכה)" : ""}</span>
          <Money amount={summary.income} className="font-bold" />
        </div>
        <div className="flex justify-between">
          <span>סך התקציב המתוכנן</span>
          <Money amount={planned} className="font-bold" />
        </div>
        {!summary.incomeIsEstimated && (
          <div
            className={`flex justify-between border-t border-line pt-1.5 font-bold ${unassigned < 0 ? "text-danger" : ""}`}
          >
            <span>{unassigned < 0 ? "התקציב גבוה מההכנסות ב־" : "עוד לא קיבל תפקיד"}</span>
            <Money amount={Math.abs(unassigned)} />
          </div>
        )}
        {summary.uncategorizedSpent > 0 && (
          <div className="flex justify-between text-warn">
            <span>הוצאות ללא קטגוריה</span>
            <Money amount={summary.uncategorizedSpent} className="font-bold" />
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

      <details className="rounded-3xl bg-card shadow-card">
        <summary className="flex cursor-pointer items-center gap-3 p-4 font-bold">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
            <PlusIcon className="size-5" />
          </span>
          <span className="flex-1">קטגוריה חדשה</span>
          <ChevronDown className="chevron text-muted" />
        </summary>
        <form action={addCategory} className="grid grid-cols-2 gap-3 px-4 pb-4">
          <label className="space-y-1">
            <span className="text-sm font-semibold">שם</span>
            <input className="field" name="name" required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">תקציב חודשי</span>
            <input className="field num" name="monthlyBudget" inputMode="decimal" defaultValue={0} />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-sm font-semibold">סוג</span>
            <select className="field" name="kind" defaultValue="expense">
              <option value="expense">הוצאה</option>
              <option value="saving">חיסכון (מופרש בתחילת החודש)</option>
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2.5">
            <input type="checkbox" className="size-5 accent-accent" name="isFixed" />
            חשבון קבוע
          </label>
          <SubmitButton className="btn col-span-2" pendingLabel="מוסיף…">
            הוספה
          </SubmitButton>
        </form>
      </details>

      {hidden.length > 0 && (
        <details className="rounded-3xl bg-card shadow-card">
          <summary className="flex cursor-pointer items-center gap-3 p-4 font-bold">
            <span className="flex-1">קטגוריות מוסתרות ({hidden.length})</span>
            <ChevronDown className="chevron text-muted" />
          </summary>
          <ul className="divide-y divide-line px-4 pb-2">
            {hidden.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-2 py-2">
                <span>{category.name}</span>
                <form action={restoreCategory}>
                  <input type="hidden" name="id" value={category.id} />
                  <SubmitButton className="btn btn-quiet min-h-0 px-3 py-1.5 text-sm" pendingLabel="מחזיר…">
                    להחזיר
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
