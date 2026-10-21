import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

export const COOKIE_NAME = "fiduciary_session";
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(s);
};

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "fiduciaryos" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function requireAuth(req: NextRequest): Promise<{ ok: boolean }> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { ok: false };
  try {
    await jwtVerify(token, secret());
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = process.env.FIDUCIARY_PASSWORD_HASH;
  if (!hash) throw new Error("FIDUCIARY_PASSWORD_HASH env var is not set");
  return bcrypt.compare(plain, hash);
}
