"use server";

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
  if (settings.error || runs.error) {
    return {
      schemaReady: false,
      publicKey: null,
      agentOnline: false,
      agentSeenAt: null,
      credentialsSavedAt: null,
      runs: [],
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
export async function requestSync(dryRun: boolean): Promise<SyncState> {
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
      .insert({ household_id: ctx.household.id, dry_run: dryRun !== false });
    if (error) throw new Error(error.message);
  }
  return getSyncState();
}
