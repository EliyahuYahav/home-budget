// Single place where environment variables are read. See .env.example.

// NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
// they must be referenced as literal process.env.NEXT_PUBLIC_* expressions.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return supabaseUrl !== "" && supabaseAnonKey !== "";
}

/** Server-only. Without it the chat falls back to the rule-based parser. */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
