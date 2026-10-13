// The Claude API key a household's bot runs on: the one it saved in the settings, or none.
// The site has no key of its own for the bot, so nobody's messages are paid for by whoever
// runs it. Server-only.
import type { AppContext } from "./data";
import { openSecret } from "./secret-box";

export interface ClaudeKey {
  /** null: the household has not saved a key, and the built-in parser answers. */
  apiKey: string | null;
  /** The last characters of the saved key, to tell keys apart. */
  hint: string | null;
  /** A key is saved but this server cannot open it (SECRETS_KEY changed or is missing). */
  unreadable: boolean;
}

export async function resolveClaudeKey(ctx: AppContext): Promise<ClaudeKey> {
  const { data, error } = await ctx.supabase
    .from("household_secrets")
    .select("claude_key, claude_key_hint")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  // A database without the table yet simply has no household keys.
  if (error || !data?.claude_key) return { apiKey: null, hint: null, unreadable: false };

  const apiKey = openSecret(data.claude_key);
  return { apiKey, hint: data.claude_key_hint, unreadable: apiKey === null };
}
