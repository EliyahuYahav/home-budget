import { createServerClient } from "@supabase/ssr";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "../env";

/** Supabase client for server components, server actions and route handlers. */
export async function createClient() {
  const cookieStore = await cookies();
  // The auth client compares the session expiry with Date.now(), and pages read
  // today's date. Neither may be captured in a prerendered shell, so wait for a
  // real request. During a request this resolves immediately.
  await io();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
