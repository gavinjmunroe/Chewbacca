import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/api/auth/login", "/onboarding", "/api/cron"];
const COOKIE = "fiduciary_session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Always allow the landing page and static assets
  if (pathname === "/" || PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
