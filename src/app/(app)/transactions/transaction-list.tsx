"use client";

import { useMemo, useState } from "react";
import { addTransaction, deleteTransaction, updateTransaction } from "@/app/actions";
import { formatILS } from "@/lib/budget";
import { shortDate } from "@/lib/dates";
import type { Category, Transaction } from "@/lib/types";

const UNCATEGORIZED = "none";

export function TransactionList({
  transactions,
  categories,
  memberNames,
  defaultDate,
}: {
  transactions: Transaction[];
  categories: Category[];
  memberNames: Record<string, string>;
  defaultDate: string;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [newType, setNewType] = useState<"expense" | "income">("expense");

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const selectable = categories.filter((c) => !c.archived);

  const visible = transactions.filter((t) => {
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

  const sumOf = (type: Transaction["type"]) =>
    visible.filter((t) => t.type === type).reduce((sum, t) => sum + t.amount, 0);
  const expenseTotal = sumOf("expense");
  const incomeTotal = sumOf("income");

  return (
    <div className="space-y-4">
      <details className="rounded-2xl border border-line bg-card p-4">
        <summary className="cursor-pointer font-semibold">הוספה ידנית</summary>
        <form action={addTransaction} className="mt-3 grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">סוג</span>
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
            <span className="text-sm font-medium">סכום</span>
            <input className="field num" name="amount" inputMode="decimal" required />
          </label>
          {newType === "expense" && (
            <label className="col-span-2 space-y-1">
              <span className="text-sm font-medium">קטגוריה</span>
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
            <span className="text-sm font-medium">תאריך</span>
            <input className="field" name="date" type="date" defaultValue={defaultDate} required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">תיאור</span>
            <input className="field" name="description" maxLength={200} />
          </label>
          <button className="btn col-span-2">הוספה</button>
        </form>
      </details>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="sr-only">חיפוש</span>
          <input
            className="field"
            type="search"
            placeholder="חיפוש"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="space-y-1">
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

      <p className="text-sm text-muted">
        {visible.length} שורות · הוצאות <span className="num">{formatILS(expenseTotal)}</span>
        {incomeTotal > 0 && (
          <>
            {" "}
            · הכנסות <span className="num">{formatILS(incomeTotal)}</span>
          </>
        )}
      </p>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          {transactions.length === 0
            ? "עוד לא נרשם כלום בחודש הזה."
            : "אין שורות שמתאימות לחיפוש."}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {visible.map((t) => {
            const income = t.type === "income";
            const label = income ? "הכנסה" : (categoryName.get(t.category_id ?? "") ?? "ללא קטגוריה");
            return (
              <li key={t.id}>
                <details>
                  <summary className="flex cursor-pointer items-center gap-3 p-3">
                    <span className="num w-10 shrink-0 text-sm text-muted">
                      {shortDate(t.occurred_on)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.description || label}</span>
                      <span className="block truncate text-xs text-muted">
                        {label}
                        {t.user_id && memberNames[t.user_id] ? ` · ${memberNames[t.user_id]}` : ""}
                      </span>
                    </span>
                    <span className={`num font-semibold ${income ? "text-accent" : ""}`}>
                      {income ? "+" : ""}
                      {formatILS(t.amount)}
                    </span>
                  </summary>

                  <form action={updateTransaction} className="grid grid-cols-2 gap-3 px-3 pb-3">
                    <input type="hidden" name="id" value={t.id} />
                    <label className="space-y-1">
                      <span className="text-sm font-medium">סכום</span>
                      <input
                        className="field num"
                        name="amount"
                        inputMode="decimal"
                        defaultValue={t.amount}
                        required
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">תאריך</span>
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
                        <span className="text-sm font-medium">קטגוריה</span>
                        <select className="field" name="categoryId" defaultValue={t.category_id ?? ""}>
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
                      <span className="text-sm font-medium">תיאור</span>
                      <input
                        className="field"
                        name="description"
                        maxLength={200}
                        defaultValue={t.description}
                      />
                    </label>
                    <button className="btn">שמירה</button>
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
      )}
    </div>
  );
}
