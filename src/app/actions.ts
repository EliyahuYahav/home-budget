"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { interpretMessage } from "@/lib/bot";
import { formatILS, summarizeMonth } from "@/lib/budget";
import { getMonthData, requireContext } from "@/lib/data";
import { isValidDate, monthOf, shortDate, todayISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage, ParsedEntry } from "@/lib/types";

export interface FormState {
  error?: string;
  message?: string;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function positiveAmount(form: FormData, key: string): number | null {
  const value = Number(text(form, key).replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function revalidateApp() {
  revalidatePath("/", "layout");
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: text(form, "email"),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: "האימייל או הסיסמה שגויים." };
  redirect("/");
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "הסיסמה צריכה להיות באורך 8 תווים לפחות." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: text(form, "email"), password });
  if (error) return { error: `ההרשמה נכשלה: ${error.message}` };
  // No session means the Supabase project requires confirming the email first.
  if (!data.session) return { message: "נשלח אליך מייל אישור. אחרי האישור אפשר להתחבר." };
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// --------------------------------------------------------------------------
// Household
// --------------------------------------------------------------------------

export async function createHousehold(_prev: FormState, form: FormData): Promise<FormState> {
  const displayName = text(form, "displayName");
  const name = text(form, "householdName") || "הבית שלנו";
  if (!displayName) return { error: "צריך למלא שם." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_household", {
    p_name: name,
    p_display_name: displayName,
  });
  if (error) return { error: `לא הצלחתי ליצור את משק הבית: ${error.message}` };
  redirect("/");
}

export async function joinHousehold(_prev: FormState, form: FormData): Promise<FormState> {
  const displayName = text(form, "displayName");
  const code = text(form, "inviteCode");
  if (!displayName || !code) return { error: "צריך למלא שם וקוד הזמנה." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household", {
    p_code: code,
    p_display_name: displayName,
  });
  if (error) {
    return {
      error: error.message.includes("invalid invite code")
        ? "קוד ההזמנה לא נמצא."
        : `ההצטרפות נכשלה: ${error.message}`,
    };
  }
  redirect("/");
}

export async function updateDisplayName(form: FormData) {
  const ctx = await requireContext();
  const displayName = text(form, "displayName");
  if (!displayName) return;
  const { error } = await ctx.supabase
    .from("household_members")
    .update({ display_name: displayName })
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  revalidateApp();
}

// --------------------------------------------------------------------------
// Transactions
// --------------------------------------------------------------------------

export async function addTransaction(form: FormData) {
  const ctx = await requireContext();
  const amount = positiveAmount(form, "amount");
  if (amount === null) return;
  const type = text(form, "type") === "income" ? "income" : "expense";
  const date = text(form, "date");

  const { error } = await ctx.supabase.from("transactions").insert({
    household_id: ctx.household.id,
    type,
    amount,
    category_id: type === "expense" ? text(form, "categoryId") || null : null,
    description: text(form, "description").slice(0, 200),
    occurred_on: isValidDate(date) ? date : todayISO(),
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function updateTransaction(form: FormData) {
  const ctx = await requireContext();
  const amount = positiveAmount(form, "amount");
  const date = text(form, "date");
  if (amount === null || !isValidDate(date)) return;

  const { error } = await ctx.supabase
    .from("transactions")
    .update({
      amount,
      category_id: text(form, "categoryId") || null,
      description: text(form, "description").slice(0, 200),
      occurred_on: date,
    })
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function deleteTransaction(form: FormData) {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("transactions")
    .delete()
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  revalidateApp();
}

// --------------------------------------------------------------------------
// Budget categories and fixed incomes
// --------------------------------------------------------------------------

export async function saveCategory(form: FormData) {
  const ctx = await requireContext();
  const budget = Number(text(form, "monthlyBudget").replace(/,/g, ""));
  const name = text(form, "name");
  if (!name || !Number.isFinite(budget) || budget < 0) return;

  const { error } = await ctx.supabase
    .from("categories")
    .update({
      name,
      monthly_budget: budget,
      kind: text(form, "kind") === "saving" ? "saving" : "expense",
      is_fixed: form.get("isFixed") === "on",
      archived: form.get("archived") === "on",
    })
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function restoreCategory(form: FormData) {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("categories")
    .update({ archived: false })
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function addCategory(form: FormData) {
  const ctx = await requireContext();
  const budget = Number(text(form, "monthlyBudget").replace(/,/g, "") || "0");
  const name = text(form, "name");
  if (!name || !Number.isFinite(budget) || budget < 0) return;

  const { error } = await ctx.supabase.from("categories").insert({
    household_id: ctx.household.id,
    name,
    monthly_budget: budget,
    kind: text(form, "kind") === "saving" ? "saving" : "expense",
    is_fixed: form.get("isFixed") === "on",
    sort_order: 1000,
  });
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function addRecurringIncome(form: FormData) {
  const ctx = await requireContext();
  const amount = positiveAmount(form, "amount");
  const name = text(form, "name");
  if (amount === null || !name) return;

  const { error } = await ctx.supabase
    .from("recurring_incomes")
    .insert({ household_id: ctx.household.id, name, amount });
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function deleteRecurringIncome(form: FormData) {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("recurring_incomes")
    .delete()
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  revalidateApp();
}

// --------------------------------------------------------------------------
// Chat bot
// --------------------------------------------------------------------------

function describeEntry(entry: ParsedEntry, today: string): string {
  const when = entry.date === today ? "היום" : shortDate(entry.date);
  const what = entry.type === "income" ? "הכנסה" : (entry.category ?? "ללא קטגוריה");
  const detail = entry.description ? ` · ${entry.description}` : "";
  return `${formatILS(entry.amount)} · ${what}${detail} · ${when}`;
}

export async function sendChatMessage(
  message: string,
): Promise<{ userMessage: ChatMessage; botMessage: ChatMessage }> {
  const ctx = await requireContext();
  const content = message.trim().slice(0, 500);
  if (!content) throw new Error("empty message");

  const today = todayISO();
  const month = monthOf(today);
  const before = await getMonthData(ctx, month);
  const active = before.categories.filter((c) => !c.archived);
  const summaryBefore = summarizeMonth({ month, today, ...before });

  const monthContext = [
    `Income: ${summaryBefore.income}${summaryBefore.incomeIsEstimated ? " (estimated from the planned budget; no income was entered)" : ""}`,
    `Savings target: ${summaryBefore.savingsTarget}, saved so far: ${summaryBefore.saved}`,
    `Spent so far: ${summaryBefore.spent}`,
    `Remaining after savings: ${summaryBefore.remaining}`,
    `Free for day-to-day spending after unpaid fixed bills: ${summaryBefore.flexibleRemaining}`,
    `Days left in the month including today: ${summaryBefore.daysLeft}`,
    `Safe to spend today: ${summaryBefore.safeToSpendToday}`,
    "Per category (spent / monthly budget):",
    ...summaryBefore.categories.map(
      (c) => `- ${c.category.name}: ${c.spent} / ${c.category.monthly_budget}`,
    ),
  ].join("\n");

  const interpretation = await interpretMessage({
    text: content,
    categoryNames: active.map((c) => c.name),
    today,
    monthContext,
  });

  const idByName = new Map(active.map((c) => [c.name, c.id]));
  let reply = interpretation.reply;

  if (interpretation.entries.length > 0) {
    const { error } = await ctx.supabase.from("transactions").insert(
      interpretation.entries.map((entry) => ({
        household_id: ctx.household.id,
        type: entry.type,
        amount: entry.amount,
        category_id: entry.category ? (idByName.get(entry.category) ?? null) : null,
        description: entry.description,
        occurred_on: entry.date,
        source: "chat",
      })),
    );
    if (error) throw new Error(error.message);

    // Confirmation is built from the saved data, not from the model's wording.
    const after = await getMonthData(ctx, month);
    const summary = summarizeMonth({ month, today, ...after });
    const lines = [
      interpretation.entries.length === 1 ? "נרשם:" : `נרשמו ${interpretation.entries.length} שורות:`,
      ...interpretation.entries.map((entry) => describeEntry(entry, today)),
    ];

    const touched = new Set(interpretation.entries.map((e) => e.category).filter(Boolean));
    for (const status of summary.categories) {
      if (!touched.has(status.category.name) || status.category.monthly_budget === 0) continue;
      const percent = Math.round((status.ratio ?? 0) * 100);
      const flag = status.status === "over" ? " — חריגה מהתקציב" : status.status === "warning" ? " — מתקרבים לתקרה" : "";
      lines.push(
        `${status.category.name}: ${formatILS(status.spent)} מתוך ${formatILS(status.category.monthly_budget)} (${percent}%)${flag}`,
      );
    }
    if (interpretation.entries.some((e) => e.type === "expense" && e.category === null)) {
      lines.push("לא מצאתי קטגוריה מתאימה לחלק מהשורות. אפשר לבחור אחת במסך ההוצאות.");
    }
    if (interpretation.entries.some((e) => monthOf(e.date) === month)) {
      lines.push(`מותר להוציא היום: ${formatILS(summary.safeToSpendToday)}`);
    }
    reply = lines.join("\n");
  }

  if (!reply) reply = 'אפשר לכתוב לי הוצאה, למשל "סופר 230", או לשאול על החודש.';

  // Explicit timestamps: rows inserted together would otherwise share one
  // created_at and could come back in either order.
  const now = Date.now();
  const { data, error } = await ctx.supabase
    .from("chat_messages")
    .insert([
      { household_id: ctx.household.id, role: "user", content, created_at: new Date(now).toISOString() },
      { household_id: ctx.household.id, role: "bot", content: reply, created_at: new Date(now + 1).toISOString() },
    ])
    .select("id, user_id, role, content, created_at");
  if (error || !data) throw new Error(error?.message ?? "failed to save messages");

  revalidateApp();
  const userMessage = data.find((m) => m.role === "user") as ChatMessage;
  const botMessage = data.find((m) => m.role === "bot") as ChatMessage;
  return { userMessage, botMessage };
}
