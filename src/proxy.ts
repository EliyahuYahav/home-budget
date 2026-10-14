import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./lib/env";

const PUBLIC_PATHS = ["/login"];

// Refreshes the Supabase session cookie on every request and sends signed-out
// visitors to /login.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Called by the scheduler, never by a signed-in browser: each route there checks a
  // secret of its own.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  if (!isSupabaseConfigured()) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  // The setup instructions are only for a project without keys.
  if (pathname === "/setup") return NextResponse.redirect(new URL("/", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims verifies the token locally (and refreshes it when expired), so a
  // normal request does not wait on a round trip to Supabase Auth.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  // Everything except static assets, the manifest and the generated icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|pwa-icon).*)"],
};
