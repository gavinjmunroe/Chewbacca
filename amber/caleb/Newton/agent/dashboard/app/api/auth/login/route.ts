import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password required." },
        { status: 400 },
      );
    }
    const hash = process.env.PASSWORD_HASH;
    if (!hash) {
      return NextResponse.json(
        { error: "Server misconfigured." },
        { status: 500 },
      );
    }
    const valid = await bcrypt.compare(password.toLowerCase(), hash);
    if (!valid) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    const session = await getSession();
    session.isLoggedIn = true;
    await session.save();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
