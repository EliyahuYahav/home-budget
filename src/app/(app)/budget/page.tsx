import { addCategory, restoreCategory, saveCategory } from "@/app/actions";
import { ChevronDown, PlusIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { Card, Money, MonthNav, PageTitle, ProgressBar } from "@/components/ui";
import { summarizeMonth, type CategoryStatus } from "@/lib/budget";
import { getMonthData, requireContext } from "@/lib/data";
import { isValidMonth, monthLabel, monthOf, todayISO } from "@/lib/dates";

/** What a fund holds, and what happened to it this month. */
function FundSummary({ row }: { row: CategoryStatus }) {
  const { category, spent } = row;
  const fund = row.fund!;
  return (
    <summary className="cursor-pointer space-y-1 p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{category.name}</span>
        <span>
          <span className="text-sm text-muted">בקרן</span> <Money amount={fund.balance} className="font-bold" />
        </span>
      </div>
      <p className="text-sm text-muted">
        {fund.contribution > 0 ? (
          <>
            <Money amount={fund.contribution} /> כל חודש, <Money amount={fund.contribution * 12} /> בשנה
          </>
        ) : category.monthly_budget > 0 ? (
          "הקרן עוד לא הייתה פתוחה בחודש הזה"
        ) : (
          "עוד לא נקבע כמה מפרישים כל חודש"
        )}
      </p>
      {fund.paid > 0 && (
        <p className="text-sm text-good">
          החודש שולמו ממנה <Money amount={fund.paid} />
        </p>
      )}
      {fund.shortfall > 0 && (
        <p className="text-sm text-danger">
          {fund.paid > 0 ? "הקרן לא הספיקה: " : ""}
          <Money amount={fund.shortfall} /> מתוך <Money amount={spent} /> ירדו מהחודש עצמו
        </p>
      )}
    </summary>
  );
}

function CategoryRow({ row }: { row: CategoryStatus }) {
  const { category, spent, ratio, status } = row;
  const saving = category.kind === "saving";
  const isFund = category.kind === "fund";
  const left = category.monthly_budget - spent;
  const tone = status === "over" ? "text-danger" : status === "warning" ? "text-warn" : "text-muted";

  return (
    <li>
      <details>
        {row.fund ? (
          <FundSummary row={row} />
        ) : (
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
        )}

        {/* A new form whenever the saved values change: after a save React resets each field
            to the default it was first given, which would show the old choice again. */}
        <form
          key={`${category.name}|${category.monthly_budget}|${category.kind}|${category.is_fixed}|${category.fund_opening}`}
          action={saveCategory}
          className="grid grid-cols-2 gap-3 px-3.5 pb-3.5"
        >
          <input type="hidden" name="id" value={category.id} />
          <label className="space-y-1">
            <span className="text-sm font-semibold">שם</span>
            <input className="field" name="name" defaultValue={category.name} required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">{isFund ? "הפרשה כל חודש" : "תקציב חודשי"}</span>
            <input
              className="field num"
              name="monthlyBudget"
              inputMode="decimal"
              defaultValue={category.monthly_budget}
              required
            />
          </label>
          {isFund && (
            <label className="col-span-2 space-y-1">
              <span className="text-sm font-semibold">כמה כבר היה בצד כשהקרן נפתחה</span>
              <input
                className="field num"
                name="fundOpening"
                inputMode="decimal"
                defaultValue={category.fund_opening ?? 0}
              />
              <span className="block text-sm text-muted">
                הקרן נפתחה ב{monthLabel(monthOf(category.fund_start ?? todayISO()))}. ההפרשה החודשית היא העלות
                השנתית חלקי 12.
              </span>
            </label>
          )}
          <label className="col-span-2 space-y-1">
            <span className="text-sm font-semibold">סוג</span>
            <select className="field" name="kind" defaultValue={category.kind}>
              <option value="expense">הוצאה</option>
              <option value="saving">חיסכון (מופרש בתחילת החודש)</option>
              <option value="fund">קרן להוצאה שנתית (מפרישים כל חודש)</option>
            </select>
          </label>
          {!isFund && (
            <label className="col-span-2 flex items-center gap-2.5">
              <input type="checkbox" className="size-5 accent-accent" name="isFixed" defaultChecked={category.is_fixed} />
              חשבון קבוע (הסכום נשמר בצד עד שהוא משולם)
            </label>
          )}
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

/** The funds for yearly expenses: what they hold matters, not spending against a budget. */
function Funds({ rows, balance, reserved }: { rows: CategoryStatus[]; balance: number; reserved: number }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">קרנות להוצאות שנתיות</h2>
          <p>
            <span className="text-sm text-muted">בקרנות</span> <Money amount={balance} className="font-bold" />
          </p>
        </div>
        <p className="text-sm text-muted">
          <Money amount={reserved} /> מופרשים החודש. חיוב שנרשם בקרן משולם ממה שנצבר בה, ולא מהחודש.
        </p>
      </div>
      <ul className="divide-y divide-line panel">
        {rows.map((row) => (
          <CategoryRow key={row.category.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function Group({ title, note, rows }: { title: string; note: string; rows: CategoryStatus[] }) {
  if (rows.length === 0) return null;
  const planned = rows.reduce((sum, r) => sum + r.category.monthly_budget, 0);
  const actual = rows.reduce((sum, r) => sum + r.spent, 0);
  return (
    <section className="space-y-2" data-tour="budget-group">
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
      <ul className="divide-y divide-line panel">
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
  const funds = summary.categories.filter((r) => r.category.kind === "fund");
  const fixed = summary.categories.filter((r) => r.category.kind === "expense" && r.category.is_fixed);
  const flexible = summary.categories.filter((r) => r.category.kind === "expense" && !r.category.is_fixed);
  const planned = summary.categories.reduce((sum, r) => sum + r.category.monthly_budget, 0);
  // With no income entered, summary.income already equals the planned total.
  const unassigned = summary.income - planned;

  return (
    <>
      <PageTitle>תקציב מול ביצוע</PageTitle>
      <MonthNav month={month} basePath="/budget" />

      <Card tour="budget-summary" className="space-y-1.5">
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
      <Funds rows={funds} balance={summary.fundsBalance} reserved={summary.fundsReserved} />
      <Group
        title="חשבונות קבועים"
        note="הסכום שעוד לא שולם נשמר בצד ולא נכלל במה שמותר להוציא."
        rows={fixed}
      />
      <Group title="הוצאות משתנות" note="לחיצה על שורה פותחת עריכה." rows={flexible} />

      <details className="panel" data-tour="budget-add">
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
              <option value="fund">קרן להוצאה שנתית (מפרישים כל חודש)</option>
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2.5">
            <input type="checkbox" className="size-5 accent-accent" name="isFixed" />
            חשבון קבוע
          </label>
          <p className="col-span-2 text-sm text-muted">
            בקרן, הסכום הוא מה שמפרישים כל חודש: העלות השנתית חלקי 12.
          </p>
          <SubmitButton className="btn col-span-2" pendingLabel="מוסיף…">
            הוספה
          </SubmitButton>
        </form>
      </details>

      {hidden.length > 0 && (
        <details className="panel">
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
