"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Anthropic from "@anthropic-ai/sdk";
import { handleChatMessage } from "@/lib/chat";
import { requireContext } from "@/lib/data";
import { isValidDate, monthLabel, monthOf, shiftMonth, todayISO } from "@/lib/dates";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isEmptyReport, renderReportEmail } from "@/lib/report";
import { collectReport } from "@/lib/report-data";
import { isSecretBoxConfigured, sealSecret } from "@/lib/secret-box";
import { createClient } from "@/lib/supabase/server";
import { isCashWithdrawal, payeeKey } from "../../sync/payee.mjs";
import { isCashCategory } from "@/lib/budget";
import { getCategories } from "@/lib/data";
import type { CategoryKind, ChatMessage } from "@/lib/types";

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
        ? "קוד ההזמנה לא נמצא, או שמשק הבית כבר מלא."
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
// The monthly report
// --------------------------------------------------------------------------

export async function setMonthlyReport(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const enabled = text(form, "enabled") === "on";
  const { error } = await ctx.supabase
    .from("households")
    .update({ monthly_report: enabled })
    .eq("id", ctx.household.id);
  if (error) return { error: `ההגדרה לא נשמרה: ${error.message}` };
  revalidateApp();
  return { message: enabled ? "הדוח יישלח בתחילת כל חודש." : "הדוח החודשי כבוי." };
}

/** Sends the report to whoever asked, and to nobody else: the month that ended, or this one so far. */
export async function sendReportNow(): Promise<FormState> {
  const ctx = await requireContext();
  if (!isEmailConfigured()) return { error: "שליחת מייל עוד לא הוגדרה באתר הזה." };
  const { data: auth } = await ctx.supabase.auth.getClaims();
  const email = auth?.claims.email;
  if (typeof email !== "string" || !email) return { error: "לא מצאתי כתובת מייל בחשבון שלך." };

  const thisMonth = monthOf(todayISO());
  let report = await collectReport(ctx, shiftMonth(thisMonth, -1));
  if (isEmptyReport(report)) report = await collectReport(ctx, thisMonth);
  if (isEmptyReport(report)) return { error: "עוד לא נרשם כלום, אז אין על מה לדווח." };

  try {
    await sendEmail({ to: [email], ...renderReportEmail(report) });
  } catch (error) {
    console.error("sending a report failed", error);
    return { error: "המייל לא נשלח. נסו שוב בעוד כמה דקות." };
  }
  return { message: `הדוח של ${monthLabel(report.month)} נשלח אליך.` };
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
    ...(type === "expense" && form.get("paidInCash") === "on" ? { paid_in_cash: true } : {}),
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
      // The checkbox is only in the form of an expense; other forms leave the column alone.
      ...(form.has("cashField") ? { paid_in_cash: form.get("paidInCash") === "on" } : {}),
    })
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);

  const categoryId = text(form, "categoryId");
  if (categoryId && form.get("applyToSame") === "on") {
    await fileSamePayee(ctx, text(form, "description"), categoryId);
  }
  revalidateApp();
}

/**
 * Files every expense from the same payee that still has no category, in any month, under
 * the category just chosen for one of them. Rows that already have a category are left alone.
 */
async function fileSamePayee(ctx: Awaited<ReturnType<typeof requireContext>>, description: string, categoryId: string) {
  const key = payeeKey(description);
  if (!key) return;
  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("id, description")
    .eq("household_id", ctx.household.id)
    .eq("type", "expense")
    .is("category_id", null)
    .limit(1000);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).filter((row) => payeeKey(row.description) === key).map((row) => row.id as string);
  for (let start = 0; start < ids.length; start += 100) {
    const { error: updateError } = await ctx.supabase
      .from("transactions")
      .update({ category_id: categoryId })
      .in("id", ids.slice(start, start + 100))
      .eq("household_id", ctx.household.id);
    if (updateError) throw new Error(updateError.message);
  }
}

/**
 * Puts the bank's lines right about cash, in every month: what is not an ATM withdrawal leaves
 * the cash category (it becomes uncategorized, to be filed where it belongs), and an ATM
 * withdrawal filed anywhere else moves into it. Lines written by hand are left alone.
 */
export async function moveMisfiledCash() {
  const ctx = await requireContext();
  const cash = (await getCategories(ctx)).filter(isCashCategory);
  if (cash.length === 0) return;
  const cashIds = new Set(cash.map((c) => c.id));
  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("id, description, category_id")
    .eq("household_id", ctx.household.id)
    .eq("source", "bank")
    .eq("type", "expense")
    .limit(5000);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const out = rows.filter((r) => r.category_id && cashIds.has(r.category_id) && !isCashWithdrawal(r.description));
  const into = rows.filter((r) => !(r.category_id && cashIds.has(r.category_id)) && isCashWithdrawal(r.description));
  const moves: [string[], string | null][] = [
    [out.map((r) => r.id as string), null],
    [into.map((r) => r.id as string), cash[0].id],
  ];
  for (const [ids, categoryId] of moves) {
    for (let start = 0; start < ids.length; start += 100) {
      const { error: updateError } = await ctx.supabase
        .from("transactions")
        .update({ category_id: categoryId })
        .in("id", ids.slice(start, start + 100))
        .eq("household_id", ctx.household.id);
      if (updateError) throw new Error(updateError.message);
    }
  }
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

function categoryKind(form: FormData): CategoryKind {
  const kind = text(form, "kind");
  return kind === "saving" || kind === "fund" ? kind : "expense";
}

/** A fund begins in the month it is opened. */
const fundStartNow = () => `${monthOf(todayISO())}-01`;

export async function saveCategory(form: FormData) {
  const ctx = await requireContext();
  const budget = Number(text(form, "monthlyBudget").replace(/,/g, ""));
  const name = text(form, "name");
  if (!name || !Number.isFinite(budget) || budget < 0) return;
  const kind = categoryKind(form);

  const { data: current, error: readError } = await ctx.supabase
    .from("categories")
    .select("*")
    .eq("id", text(form, "id"))
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) return;

  // The fund and goal columns are written only where they are used, so the other kinds still
  // save on a database that has not been given those columns yet.
  let fund: { fund_start?: string | null; fund_opening?: number; goal_amount?: number | null; goal_due?: string | null } = {};
  const opening = Number(text(form, "opening").replace(/,/g, "") || "0");
  if (!Number.isFinite(opening) || opening < 0) return;
  if (kind === "fund") {
    fund = { fund_opening: opening };
    if (current.kind !== "fund" || !current.fund_start) fund.fund_start = fundStartNow();
  } else if (current.kind === "fund") {
    fund = { fund_start: null, fund_opening: 0 };
  }
  if (kind === "saving") {
    const goal = Number(text(form, "goalAmount").replace(/,/g, "") || "0");
    if (!Number.isFinite(goal) || goal < 0) return;
    const due = text(form, "goalDue");
    if (goal > 0) {
      fund = { ...fund, goal_amount: goal, goal_due: /^\d{4}-\d{2}$/.test(due) ? `${due}-01` : null, fund_opening: opening };
    } else if (current.goal_amount != null) {
      fund = { ...fund, goal_amount: null, goal_due: null, fund_opening: 0 };
    }
  } else if (current.goal_amount != null) {
    fund = { ...fund, goal_amount: null, goal_due: null };
  }

  // Written only when it is on or was on, for a database without the column yet.
  const paidInCash = kind === "expense" && form.get("paidInCash") === "on";
  const cash = paidInCash || current.paid_in_cash ? { paid_in_cash: paidInCash } : {};

  const { error } = await ctx.supabase
    .from("categories")
    .update({
      name,
      monthly_budget: budget,
      kind,
      is_fixed: kind === "expense" && form.get("isFixed") === "on",
      archived: form.get("archived") === "on",
      ...fund,
      ...cash,
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
  const kind = categoryKind(form);

  const { error } = await ctx.supabase.from("categories").insert({
    household_id: ctx.household.id,
    name,
    monthly_budget: budget,
    kind,
    is_fixed: kind === "expense" && form.get("isFixed") === "on",
    sort_order: 1000,
    ...(kind === "fund" ? { fund_start: fundStartNow() } : {}),
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

/** Marks a payer (a piece of the bank's description) as paying next month's income. */
export async function addNextMonthPayer(form: FormData) {
  const ctx = await requireContext();
  const payer = text(form, "payer").slice(0, 100);
  if (payer.length < 2) return;
  const { error } = await ctx.supabase
    .from("next_month_incomes")
    .upsert({ household_id: ctx.household.id, payer }, { onConflict: "household_id,payer", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  revalidateApp();
}

export async function removeNextMonthPayer(form: FormData) {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("next_month_incomes")
    .delete()
    .eq("household_id", ctx.household.id)
    .eq("payer", text(form, "payer"));
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
// The household's own Claude API key
// --------------------------------------------------------------------------

export async function saveClaudeKey(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const apiKey = text(form, "apiKey");
  if (!isSecretBoxConfigured()) return { error: "שמירת מפתחות לא הוגדרה באתר הזה (חסר SECRETS_KEY)." };
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
    return { error: "זה לא נראה כמו מפתח של Claude. מפתח מתחיל ב־sk-ant-." };
  }

  // One cheap request, so a mistyped or revoked key is caught now and not in the middle of a chat.
  try {
    await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 1 });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { error: "Anthropic דחתה את המפתח. בדקו שהעתקתם אותו במלואו ושהוא פעיל." };
    }
    return { error: "לא הצלחתי לבדוק את המפתח מול Anthropic. נסו שוב בעוד רגע." };
  }

  const { error } = await ctx.supabase.from("household_secrets").upsert({
    household_id: ctx.household.id,
    claude_key: sealSecret(apiKey),
    claude_key_hint: apiKey.slice(-4),
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: `המפתח לא נשמר: ${error.message}` };
  revalidateApp();
  return { message: "המפתח נבדק ונשמר. הבוט עובד עכשיו על החשבון שלכם." };
}

export async function removeClaudeKey(): Promise<FormState> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("household_secrets")
    .update({ claude_key: null, claude_key_hint: null, updated_at: new Date().toISOString() })
    .eq("household_id", ctx.household.id);
  if (error) return { error: `המפתח לא הוסר: ${error.message}` };
  revalidateApp();
  return { message: "המפתח הוסר." };
}

// --------------------------------------------------------------------------
// Chat bot
// --------------------------------------------------------------------------

export async function sendChatMessage(
  message: string,
): Promise<{ userMessage: ChatMessage; botMessage: ChatMessage; entryIds: string[] }> {
  const ctx = await requireContext();
  const result = await handleChatMessage(ctx, message);
  revalidateApp();
  return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deletes rows the bot has just logged, when it understood the message wrongly. */
export async function undoChatEntries(ids: string[]): Promise<ChatMessage> {
  const ctx = await requireContext();
  const valid = ids.filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 20);
  if (valid.length === 0) throw new Error("nothing to undo");

  const { data: removed, error } = await ctx.supabase
    .from("transactions")
    .delete()
    .in("id", valid)
    .eq("household_id", ctx.household.id)
    .eq("source", "chat")
    .select("id");
  if (error) throw new Error(error.message);

  const count = removed?.length ?? 0;
  const content =
    count === 0
      ? "לא נמצאו שורות לביטול. ייתכן שכבר נמחקו."
      : count === 1
        ? "בוטל. השורה נמחקה."
        : `בוטל. ${count} שורות נמחקו.`;
  const { data, error: messageError } = await ctx.supabase
    .from("chat_messages")
    .insert({ household_id: ctx.household.id, role: "bot", content })
    .select("id, user_id, role, content, created_at")
    .single();
  if (messageError || !data) throw new Error(messageError?.message ?? "failed to save message");

  revalidateApp();
  return data as ChatMessage;
}
