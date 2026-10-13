import { redirect } from "next/navigation";
import { settleCash, type FundCharge } from "./budget";
import { monthRange } from "./dates";
import { createClient } from "./supabase/server";
import type { Category, ChatMessage, Member, RecurringIncome, Transaction } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AppContext {
  supabase: Supabase;
  userId: string;
  displayName: string;
  household: { id: string; name: string; invite_code: string };
}

/** The signed-in user and their household. Redirects when either is missing. */
export async function requireContext(): Promise<AppContext> {
  const supabase = await createClient();
  // Verified locally against the project signing keys; no round trip to Supabase Auth.
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) redirect("/login");

  const { data: member } = await supabase
    .from("household_members")
    .select("display_name, households (id, name, invite_code)")
    .eq("user_id", userId)
    .maybeSingle();

  // Supabase types a to-one join as an array unless generated types are used.
  const household = (Array.isArray(member?.households) ? member.households[0] : member?.households) as
    | AppContext["household"]
    | undefined;
  if (!member || !household) redirect("/onboarding");

  return { supabase, userId, displayName: member.display_name, household };
}

// Postgres numeric columns arrive as strings; convert once here.
const num = (value: unknown) => Number(value ?? 0);

export async function getCategories(ctx: AppContext): Promise<Category[]> {
  const { data, error } = await ctx.supabase
    .from("categories")
    // Every column, so a database that has not been given the newest ones yet still answers.
    .select("*")
    .eq("household_id", ctx.household.id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    ...c,
    monthly_budget: num(c.monthly_budget),
    fund_start: c.fund_start ?? null,
    fund_opening: num(c.fund_opening),
    goal_amount: c.goal_amount == null ? null : num(c.goal_amount),
    goal_due: c.goal_due ?? null,
  })) as Category[];
}

/**
 * What was put aside before `month` in each savings line that has a goal, by category id:
 * what summarizeMonth needs to show how far each goal has come.
 */
export async function getGoalSaved(ctx: AppContext, categories: Category[], month: string): Promise<Record<string, number>> {
  const goals = categories.filter((c) => c.kind === "saving" && !c.archived && (c.goal_amount ?? 0) > 0);
  if (goals.length === 0) return {};

  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("category_id, amount")
    .eq("household_id", ctx.household.id)
    .eq("type", "expense")
    .in("category_id", goals.map((c) => c.id))
    .lt("occurred_on", monthRange(month).start)
    .limit(1000);
  if (error) throw new Error(error.message);

  const saved: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.category_id as string;
    saved[id] = (saved[id] ?? 0) + num(row.amount);
  }
  return saved;
}

/**
 * What was charged to the funds before `month`, back to the month the oldest of them began:
 * what summarizeMonth needs to know how much each fund holds.
 */
export async function getFundHistory(ctx: AppContext, categories: Category[], month: string): Promise<FundCharge[]> {
  const funds = categories.filter((c) => c.kind === "fund" && !c.archived && c.fund_start);
  const { start } = monthRange(month);
  const earliest = funds.map((c) => c.fund_start as string).sort()[0];
  if (!earliest || earliest >= start) return [];

  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("category_id, amount, occurred_on")
    .eq("household_id", ctx.household.id)
    .eq("type", "expense")
    .in("category_id", funds.map((c) => c.id))
    .gte("occurred_on", earliest)
    .lt("occurred_on", start)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as FundCharge[];
}

export async function getTransactions(ctx: AppContext, month: string): Promise<Transaction[]> {
  const { start, endExclusive } = monthRange(month);
  const { data, error } = await ctx.supabase
    .from("transactions")
    // Every column, so a database that has not been given the newest ones yet still answers.
    .select("*")
    .eq("household_id", ctx.household.id)
    .gte("occurred_on", start)
    .lt("occurred_on", endExclusive)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as Transaction[];
}

export async function getRecurringIncomes(ctx: AppContext): Promise<RecurringIncome[]> {
  const { data, error } = await ctx.supabase
    .from("recurring_incomes")
    .select("id, name, amount")
    .eq("household_id", ctx.household.id)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({ ...i, amount: num(i.amount) }));
}

/** Payers whose end-of-month income is counted for the next month. Empty on a database without the table yet. */
export async function getNextMonthPayers(ctx: AppContext): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("next_month_incomes")
    .select("payer")
    .eq("household_id", ctx.household.id)
    .order("created_at");
  return error ? [] : (data ?? []).map((row) => row.payer as string);
}

export interface BankPayer {
  /** The bank's description of who paid. */
  name: string;
  /** The latest such income. */
  date: string;
  amount: number;
}

/**
 * Who paid into the bank account in the last three days of a month lately: the incomes that
 * could be a salary for the month that begins. An income on the 1st is already in the right
 * month, so it is not offered. One entry per payer, the most recent first.
 */
export async function getRecentBankPayers(ctx: AppContext, since: string): Promise<BankPayer[]> {
  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("description, occurred_on, amount")
    .eq("household_id", ctx.household.id)
    .eq("type", "income")
    .eq("source", "bank")
    .gte("occurred_on", since)
    .order("occurred_on", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  const payers = new Map<string, BankPayer>();
  for (const row of data ?? []) {
    const date = String(row.occurred_on);
    const day = Number(date.slice(8, 10));
    const lastDay = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    if (day < lastDay - 2) continue;
    // An income already counted for the next month carries a note of the day it arrived.
    const name = String(row.description).replace(/ \(נכנס ב־[\d.]+\)$/, "").trim();
    if (name && !payers.has(name)) payers.set(name, { name, date, amount: num(row.amount) });
  }
  return [...payers.values()].slice(0, 5);
}

export async function getMembers(ctx: AppContext): Promise<Member[]> {
  const { data, error } = await ctx.supabase
    .from("household_members")
    .select("user_id, display_name")
    .eq("household_id", ctx.household.id)
    .order("joined_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The latest chat messages, oldest first. */
export async function getChatMessages(ctx: AppContext, limit = 60): Promise<ChatMessage[]> {
  const { data, error } = await ctx.supabase
    .from("chat_messages")
    .select("id, user_id, role, content, created_at")
    .eq("household_id", ctx.household.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function getMonthData(ctx: AppContext, month: string) {
  const [categories, transactions, recurringIncomes] = await Promise.all([
    getCategories(ctx),
    getTransactions(ctx, month),
    getRecurringIncomes(ctx),
  ]);
  const [fundHistory, goalSaved] = await Promise.all([
    getFundHistory(ctx, categories, month),
    getGoalSaved(ctx, categories, month),
  ]);
  // For every total and summary: cash purchases come off the cash withdrawals.
  return {
    categories,
    transactions: settleCash(transactions, categories).transactions,
    recurringIncomes,
    fundHistory,
    goalSaved,
  };
}
