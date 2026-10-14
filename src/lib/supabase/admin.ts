// A Supabase client that row level security does not apply to. It exists for the one place
// where the server acts with no member signed in: the scheduled monthly report, which checks
// a secret of its own before it gets here. Every query made with this client names the
// household it is for. Never import it from a page, an action or anything a browser can reach.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import type { AppContext } from "../data";
import { supabaseUrl } from "../env";

/** null when SUPABASE_SERVICE_ROLE_KEY is not set: the features that need it stay off. */
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !supabaseUrl) return null;
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The context of one member, for code written for a signed-in member (reading the month).
 * null when they are no longer in a household.
 */
export async function memberContext(admin: SupabaseClient, userId: string): Promise<AppContext | null> {
  const { data: member } = await admin
    .from("household_members")
    .select("display_name, households (id, name, invite_code)")
    .eq("user_id", userId)
    .maybeSingle();
  const household = (Array.isArray(member?.households) ? member.households[0] : member?.households) as
    | AppContext["household"]
    | undefined;
  if (!member || !household) return null;
  return { supabase: admin as AppContext["supabase"], userId, displayName: member.display_name, household };
}

/** Compares a secret a caller sent with the expected one, without leaking where they differ. */
export function sameSecret(given: string | null, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
