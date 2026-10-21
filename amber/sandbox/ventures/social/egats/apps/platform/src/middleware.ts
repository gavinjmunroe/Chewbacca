import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) throw new Error("missing env");

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);

    let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    // Protect all dashboard routes
    if (pathname.startsWith("/dashboard") && !user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Protect all API routes except public auth callbacks
    // Public API paths that must remain accessible without auth:
    const PUBLIC_API_PREFIXES = [
      "/api/auth",          // Supabase auth callbacks
    ];
    const isApiRoute = pathname.startsWith("/api/");
    const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
    if (isApiRoute && !isPublicApi && !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if ((pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password") && user) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return supabaseResponse;
  } catch {
    // Auth unavailable — still serve public pages, protect dashboard
    if (pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
