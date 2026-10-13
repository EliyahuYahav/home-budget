// Which Claude API key a household's bot runs on: its own, saved in the settings, or the
// one this deployment was set up with. Server-only.
import type { AppContext } from "./data";
import { openSecret } from "./secret-box";

export interface ClaudeKey {
  /** "household": the household's own key. "shared": the deployment's key. "none": the built-in parser. */
  source: "household" | "shared" | "none";
  apiKey: string | null;
  /** The last characters of the household's saved key, to tell keys apart. */
  hint: string | null;
  /** A key is saved but this server cannot open it (SECRETS_KEY changed or is missing). */
  unreadable: boolean;
}

export async function resolveClaudeKey(ctx: AppContext): Promise<ClaudeKey> {
  const shared = process.env.ANTHROPIC_API_KEY || null;
  const fallback: ClaudeKey = { source: shared ? "shared" : "none", apiKey: shared, hint: null, unreadable: false };

  const { data, error } = await ctx.supabase
    .from("household_secrets")
    .select("claude_key, claude_key_hint")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  // A database without the table yet simply has no household keys.
  if (error || !data?.claude_key) return fallback;

  const apiKey = openSecret(data.claude_key);
  if (!apiKey) return { ...fallback, hint: data.claude_key_hint, unreadable: true };
  return { source: "household", apiKey, hint: data.claude_key_hint, unreadable: false };
}
