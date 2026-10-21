import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { version?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  await supabase.from("terms_acceptances").upsert({
    user_id: user.id,
    version: body.version ?? "1.0",
    accepted_at: new Date().toISOString(),
  }, { onConflict: "user_id,version" });

  return NextResponse.json({ ok: true });
}
