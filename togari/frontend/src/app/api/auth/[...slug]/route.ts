/**
 * Lightweight Auth0 stub for the demo.
 *
 * In production, replace this file with `@auth0/nextjs-auth0/server`'s
 * `handleAuth()` once Karthik has provisioned real Auth0 dev-tenant credentials.
 * For now we want the /login -> "Continue with Auth0" -> back-to-app flow to
 * work without crashing on a missing AUTH0_SECRET, so we cookie-stamp the
 * session and bounce back to "/".
 */
import { NextResponse } from "next/server";

const SESSION_COOKIE = "togari_session";
const DEMO_USER = {
  sub: "auth0|demo",
  name: "Kevin Park",
  email: "kevin@48north.com",
  picture: null,
};

type Params = Promise<{ slug: string[] }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const { slug } = await params;
  const action = slug?.[0] ?? "";
  const url = new URL(request.url);

  if (action === "login") {
    const redirectTo = url.searchParams.get("returnTo") || "/";
    const res = NextResponse.redirect(new URL(redirectTo, url));
    res.cookies.set(SESSION_COOKIE, JSON.stringify(DEMO_USER), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }
  if (action === "logout") {
    const res = NextResponse.redirect(new URL("/login", url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  if (action === "me") {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return NextResponse.json({ user: null }, { status: 401 });
    const value = decodeURIComponent(cookie.split("=")[1] ?? "");
    try {
      return NextResponse.json({ user: JSON.parse(value) });
    } catch {
      return NextResponse.json({ user: null }, { status: 401 });
    }
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 404 });
}
