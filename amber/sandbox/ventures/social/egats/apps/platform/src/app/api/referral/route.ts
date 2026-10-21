import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { referralCode?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!body.referralCode) return NextResponse.json({ error: "referralCode required" }, { status: 400 });

  const { data: referrer } = await supabase
    .from("profiles")
    .select("id")
    .eq("referral_code", body.referralCode)
    .neq("id", user.id) // Can't refer yourself
    .maybeSingle();

  if (!referrer) return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });

  await supabase.from("profiles").update({ referred_by: referrer.id }).eq("id", user.id).is("referred_by", null); // Only set once
  return NextResponse.json({ ok: true });
}
