"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/data";

export interface SyncRun {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  dry_run: boolean;
  output: string;
  created_at: string;
  finished_at: string | null;
}

export interface SyncState {
  /** False until supabase/schema.sql has been run again with the sync tables. */
  schemaReady: boolean;
  /** The home computer's key; null until the agent has run there once. */
  publicKey: JsonWebKey | null;
  agentOnline: boolean;
  agentSeenAt: string | null;
  credentialsSavedAt: string | null;
  runs: SyncRun[];
  /** How much the household has stored, shown before a reset. */
  stored: { transactions: number; chatMessages: number };
}

// The agent reports in every 15 seconds.
const ONLINE_WITHIN_MS = 60_000;

export async function getSyncState(): Promise<SyncState> {
  const ctx = await requireContext();
  const [settings, runs] = await Promise.all([
    ctx.supabase
      .from("bank_sync_settings")
      .select("public_key, credentials_updated_at, agent_seen_at")
      .eq("household_id", ctx.household.id)
      .maybeSingle(),
    ctx.supabase
      .from("bank_sync_runs")
      .select("id, status, dry_run, output, created_at, finished_at")
      .eq("household_id", ctx.household.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const [transactionCount, messageCount] = await Promise.all([
    ctx.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id),
    ctx.supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id),
  ]);
  const stored = { transactions: transactionCount.count ?? 0, chatMessages: messageCount.count ?? 0 };
  if (settings.error || runs.error) {
    return {
      schemaReady: false,
      publicKey: null,
      agentOnline: false,
      agentSeenAt: null,
      credentialsSavedAt: null,
      runs: [],
      stored,
    };
  }

  const seenAt: string | null = settings.data?.agent_seen_at ?? null;
  return {
    schemaReady: true,
    publicKey: (settings.data?.public_key as JsonWebKey | null) ?? null,
    agentOnline: seenAt !== null && Date.now() - Date.parse(seenAt) < ONLINE_WITHIN_MS,
    agentSeenAt: seenAt,
    credentialsSavedAt: settings.data?.credentials_updated_at ?? null,
    runs: (runs.data ?? []) as SyncRun[],
    stored,
  };
}

/** Stores login details already sealed in the browser. The server never sees them in the clear. */
export async function saveBankCredentials(sealed: string): Promise<SyncState> {
  const ctx = await requireContext();
  let parsed: unknown;
  try {
    parsed = JSON.parse(sealed);
  } catch {
    parsed = null;
  }
  const shape = parsed as { v?: unknown; key?: unknown; iv?: unknown; data?: unknown } | null;
  const valid =
    sealed.length <= 20_000 &&
    shape?.v === 1 &&
    [shape.key, shape.iv, shape.data].every((part) => typeof part === "string" && part !== "");
  if (!valid) throw new Error("The login details did not arrive sealed.");

  const { error } = await ctx.supabase
    .from("bank_sync_settings")
    .update({ credentials: sealed, credentials_updated_at: new Date().toISOString() })
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  return getSyncState();
}

export async function clearBankCredentials(): Promise<SyncState> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase
    .from("bank_sync_settings")
    .update({ credentials: null, credentials_updated_at: null })
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  return getSyncState();
}

/** Asks the home computer for a sync. One at a time: a request already waiting is kept. */
export async function requestSync(dryRun: boolean, monthsBack = 1): Promise<SyncState> {
  const months = Number.isInteger(monthsBack) ? Math.min(Math.max(monthsBack, 1), 12) : 1;
  const ctx = await requireContext();
  const { data: active, error: activeError } = await ctx.supabase
    .from("bank_sync_runs")
    .select("id")
    .eq("household_id", ctx.household.id)
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) throw new Error(activeError.message);
  if (active.length === 0) {
    const { error } = await ctx.supabase
      .from("bank_sync_runs")
      // Anything other than an explicit false stays a dry run.
      .insert({
        household_id: ctx.household.id,
        dry_run: dryRun !== false,
        ...(months > 1 ? { months_back: months } : {}),
      });
    if (error) throw new Error(error.message);
  }
  return getSyncState();
}

/** The word the user types to confirm a reset. */
const RESET_WORD = "מחק";

export interface HouseholdBackup {
  exportedAt: string;
  household: string;
  transactions: Record<string, unknown>[];
  chatMessages: Record<string, unknown>[];
}

async function readAll(
  ctx: Awaited<ReturnType<typeof requireContext>>,
  table: "transactions" | "chat_messages",
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  // The API returns at most a thousand rows at a time.
  for (let page = 0; ; page += 1) {
    const { data, error } = await ctx.supabase
      .from(table)
      .select("*")
      .eq("household_id", ctx.household.id)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** Everything a reset would delete, for the browser to save as a file first. */
export async function exportHouseholdData(): Promise<HouseholdBackup> {
  const ctx = await requireContext();
  const [transactions, chatMessages] = await Promise.all([
    readAll(ctx, "transactions"),
    readAll(ctx, "chat_messages"),
  ]);
  return { exportedAt: new Date().toISOString(), household: ctx.household.name, transactions, chatMessages };
}

/**
 * Deletes every expense, income and chat message of the household, to start over from the
 * bank. Categories, budgets, fixed incomes, members and the sync settings stay.
 */
export async function resetHouseholdData(confirmation: string): Promise<SyncState> {
  const ctx = await requireContext();
  if (confirmation !== RESET_WORD) throw new Error("not confirmed");

  const transactions = await ctx.supabase.from("transactions").delete().eq("household_id", ctx.household.id);
  if (transactions.error) throw new Error(transactions.error.message);
  const messages = await ctx.supabase.from("chat_messages").delete().eq("household_id", ctx.household.id);
  if (messages.error) throw new Error(messages.error.message);

  revalidatePath("/", "layout");
  return getSyncState();
}

