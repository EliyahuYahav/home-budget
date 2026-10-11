import { redirect } from "next/navigation";
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
    .select("id, name, kind, is_fixed, monthly_budget, sort_order, archived")
    .eq("household_id", ctx.household.id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ ...c, monthly_budget: num(c.monthly_budget) })) as Category[];
}

export async function getTransactions(ctx: AppContext, month: string): Promise<Transaction[]> {
  const { start, endExclusive } = monthRange(month);
  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("id, user_id, type, amount, category_id, description, occurred_on, source, created_at")
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
  return { categories, transactions, recurringIncomes };
}
