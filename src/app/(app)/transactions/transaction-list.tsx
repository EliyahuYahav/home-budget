"use client";

import { useMemo, useState } from "react";
import { addTransaction, deleteTransaction, updateTransaction } from "@/app/actions";
import { ChevronDown, PlusIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { EmptyNote } from "@/components/ui";
import { accountOf } from "@/lib/bank-sources";
import { formatILS } from "@/lib/budget";
import { dayLabel } from "@/lib/dates";
import type { Category, Transaction } from "@/lib/types";

const UNCATEGORIZED = "none";

export function TransactionList({
  transactions,
  categories,
  memberNames,
  cashCovered,
  defaultDate,
  today,
}: {
  transactions: Transaction[];
  categories: Category[];
  memberNames: Record<string, string>;
  /** Per cash withdrawal: how much of it was written down as cash purchases. */
  cashCovered: Record<string, number>;
  defaultDate: string;
  today: string;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");

  // The bank accounts and cards this month's rows came from, for telling them apart.
  const accounts = useMemo(() => {
    const found = new Map<string, string>();
    for (const t of transactions) {
      const account = accountOf(t.external_id);
      if (account) found.set(account.key, account.label);
    }
    return [...found].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [transactions]);
  const [newType, setNewType] = useState<"expense" | "income">("expense");

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const selectable = categories.filter((c) => !c.archived);
  const uncategorizedCount = transactions.filter((t) => t.type === "expense" && !t.category_id).length;

  const visible = transactions.filter((t) => {
    if (accountFilter === "manual" && t.external_id) return false;
    if (accountFilter && accountFilter !== "manual" && accountOf(t.external_id)?.key !== accountFilter) return false;
    if (categoryFilter === "income" && t.type !== "income") return false;
    if (categoryFilter === UNCATEGORIZED && (t.type !== "expense" || t.category_id)) return false;
    if (categoryFilter && categoryFilter !== "income" && categoryFilter !== UNCATEGORIZED) {
      if (t.category_id !== categoryFilter) return false;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = `${t.description} ${categoryName.get(t.category_id ?? "") ?? ""} ${t.amount}`;
    return haystack.toLowerCase().includes(needle);
  });

  // A withdrawal counts only for the part not already listed as cash purchases.
  const sumOf = (rows: Transaction[], type: Transaction["type"]) =>
    rows.filter((t) => t.type === type).reduce((sum, t) => sum + t.amount - (cashCovered[t.id] ?? 0), 0);
  const expenseTotal = sumOf(visible, "expense");
  const incomeTotal = sumOf(visible, "income");

  // The rows arrive newest first; keep that order within and between days.
  const byDay: { date: string; rows: Transaction[] }[] = [];
  for (const t of visible) {
    const last = byDay[byDay.length - 1];
    if (last?.date === t.occurred_on) last.rows.push(t);
    else byDay.push({ date: t.occurred_on, rows: [t] });
  }

  return (
    <div className="space-y-4">
      <details className="panel" data-tour="tx-add">
        <summary className="flex cursor-pointer items-center gap-3 p-4 font-bold">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
            <PlusIcon className="size-5" />
          </span>
          <span className="flex-1">הוספה ידנית</span>
          <ChevronDown className="chevron text-muted" />
        </summary>
        <form action={addTransaction} className="grid grid-cols-2 gap-3 px-4 pb-4">
          <label className="space-y-1">
            <span className="text-sm font-semibold">סוג</span>
            <select
              className="field"
              name="type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as "expense" | "income")}
            >
              <option value="expense">הוצאה</option>
              <option value="income">הכנסה חד־פעמית</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">סכום</span>
            <input className="field num" name="amount" inputMode="decimal" required />
          </label>
          {newType === "expense" && (
            <label className="col-span-2 space-y-1">
              <span className="text-sm font-semibold">קטגוריה</span>
              <select className="field" name="categoryId" defaultValue="">
                <option value="">ללא קטגוריה</option>
                {selectable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="text-sm font-semibold">תאריך</span>
            <input className="field" name="date" type="date" defaultValue={defaultDate} required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">תיאור</span>
            <input className="field" name="description" maxLength={200} />
          </label>
          {newType === "expense" && (
            <label className="col-span-2 flex items-center gap-2.5">
              <input type="checkbox" className="size-5 accent-accent" name="paidInCash" />
              שולם במזומן (יורד ממשיכות המזומן של החודש)
            </label>
          )}
          <SubmitButton className="btn col-span-2" pendingLabel="מוסיף…">
            הוספה
          </SubmitButton>
        </form>
      </details>

      <div className="grid grid-cols-2 gap-3" data-tour="tx-filter">
        <label>
          <span className="sr-only">חיפוש</span>
          <input
            className="field"
            type="search"
            placeholder="חיפוש"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">סינון לפי קטגוריה</span>
          <select
            className="field"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">כל הקטגוריות</option>
            <option value="income">הכנסות</option>
            <option value={UNCATEGORIZED}>ללא קטגוריה</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {accounts.length > 0 && (
        <label className="block">
          <span className="sr-only">סינון לפי חשבון</span>
          <select className="field" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">כל החשבונות והכרטיסים</option>
            {accounts.map((account) => (
              <option key={account.key} value={account.key}>
                {account.label}
              </option>
            ))}
            <option value="manual">נרשם ידנית או בבוט</option>
          </select>
        </label>
      )}

      {uncategorizedCount > 0 && categoryFilter !== UNCATEGORIZED && (
        <button
          type="button"
          onClick={() => setCategoryFilter(UNCATEGORIZED)}
          className="w-full rounded-3xl bg-warn-soft p-4 text-start text-[0.95rem]"
        >
          {uncategorizedCount === 1
            ? "הוצאה אחת עדיין בלי קטגוריה."
            : `${uncategorizedCount} הוצאות עדיין בלי קטגוריה.`}{" "}
          <span className="font-bold underline">להציג אותן</span>
        </button>
      )}

      <p className="flex justify-between text-muted">
        <span>
          {visible.length === 1 ? "שורה אחת" : `${visible.length} שורות`}
        </span>
        <span>
          הוצאות <span className="num font-bold text-ink">{formatILS(expenseTotal)}</span>
          {incomeTotal > 0 && (
            <>
              {" "}
              · הכנסות <span className="num font-bold text-good">{formatILS(incomeTotal)}</span>
            </>
          )}
        </span>
      </p>

      {visible.length === 0 ? (
        <EmptyNote>
          {transactions.length === 0
            ? "עוד לא נרשם כלום בחודש הזה. אפשר לכתוב לבוט או להוסיף כאן ידנית."
            : "אין שורות שמתאימות לחיפוש."}
        </EmptyNote>
      ) : (
        byDay.map(({ date, rows }) => (
          <section key={date} className="space-y-1.5" data-tour="tx-list">
            <h2 className="flex items-baseline justify-between px-1 text-sm font-bold text-muted">
              <span>{dayLabel(date, today)}</span>
              {sumOf(rows, "expense") > 0 && (
                <span className="num">{formatILS(sumOf(rows, "expense"))}</span>
              )}
            </h2>
            <ul className="divide-y divide-line panel">
              {rows.map((t) => {
                const income = t.type === "income";
                const label = income
                  ? "הכנסה"
                  : (categoryName.get(t.category_id ?? "") ?? "ללא קטגוריה");
                const missing = !income && !t.category_id;
                const covered = cashCovered[t.id] ?? 0;
                return (
                  <li key={t.id}>
                    <details>
                      <summary className="flex cursor-pointer items-center gap-3 p-3.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{t.description || label}</span>
                          <span
                            className={`block truncate text-sm ${missing ? "text-warn" : "text-muted"}`}
                          >
                            {label}
                            {t.source === "bank"
                              ? `, ${accountOf(t.external_id)?.label ?? "מהבנק"}`
                              : t.user_id && memberNames[t.user_id]
                                ? `, ${memberNames[t.user_id]}`
                                : ""}
                            {t.paid_in_cash ? ", במזומן" : ""}
                          </span>
                          {covered > 0 && (
                            <span className="block text-sm text-muted">
                              מתוך <span className="num">{formatILS(t.amount)}</span>,{" "}
                              <span className="num">{formatILS(covered)}</span> כבר מפורטים כתשלומים במזומן
                            </span>
                          )}
                        </span>
                        <span className={`num text-lg font-bold ${income ? "text-good" : ""}`}>
                          {income ? "+" : ""}
                          {formatILS(t.amount - covered)}
                        </span>
                      </summary>

                      {/* A new form whenever the saved values change. After a save React puts
                          every field back to the default it was first given, so without this the
                          category box went back to the old choice while the row above showed the
                          new one, and saving again wrote the old one back. */}
                      <form
                        key={`${t.amount}|${t.occurred_on}|${t.category_id}|${t.description}|${t.paid_in_cash}`}
                        action={updateTransaction}
                        className="grid grid-cols-2 gap-3 px-3.5 pb-3.5"
                      >
                        <input type="hidden" name="id" value={t.id} />
                        <label className="space-y-1">
                          <span className="text-sm font-semibold">סכום</span>
                          <input
                            className="field num"
                            name="amount"
                            inputMode="decimal"
                            defaultValue={t.amount}
                            required
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm font-semibold">תאריך</span>
                          <input
                            className="field"
                            name="date"
                            type="date"
                            defaultValue={t.occurred_on}
                            required
                          />
                        </label>
                        {!income && (
                          <label className="col-span-2 space-y-1">
                            <span className="text-sm font-semibold">קטגוריה</span>
                            <select
                              className="field"
                              name="categoryId"
                              defaultValue={t.category_id ?? ""}
                            >
                              <option value="">ללא קטגוריה</option>
                              {categories
                                .filter((c) => !c.archived || c.id === t.category_id)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <label className="col-span-2 space-y-1">
                          <span className="text-sm font-semibold">תיאור</span>
                          <input
                            className="field"
                            name="description"
                            maxLength={200}
                            defaultValue={t.description}
                          />
                        </label>
                        {!income && (
                          <label className="col-span-2 flex items-center gap-2.5">
                            <input type="hidden" name="cashField" value="1" />
                            <input
                              type="checkbox"
                              className="size-5 accent-accent"
                              name="paidInCash"
                              defaultChecked={t.paid_in_cash ?? false}
                            />
                            שולם במזומן (יורד ממשיכות המזומן של החודש)
                          </label>
                        )}
                        {!income && (
                          <label className="col-span-2 flex items-center gap-2.5">
                            <input type="checkbox" className="size-5 accent-accent" name="applyToSame" defaultChecked />
                            אותה קטגוריה לכל ההוצאות מאותו מקום שעדיין בלי קטגוריה
                          </label>
                        )}
                        <SubmitButton>שמירה</SubmitButton>
                        <button
                          className="btn btn-danger"
                          formAction={deleteTransaction}
                          formNoValidate
                          onClick={(e) => {
                            if (!window.confirm("למחוק את השורה?")) e.preventDefault();
                          }}
                        >
                          מחיקה
                        </button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
