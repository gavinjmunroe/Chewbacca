import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { email, source } = body as { email?: string; source?: string };

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase.from("waitlist").insert({
      email: trimmed,
      source: source ?? "landing",
      created_at: new Date().toISOString(),
    });

    if (error) {
      // Unique constraint violation — already on the list
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, alreadyExists: true });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[waitlist] error:", message);
    return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
  }
}
