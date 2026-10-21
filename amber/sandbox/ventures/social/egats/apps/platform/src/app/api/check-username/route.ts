import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("u")?.toLowerCase().trim();
  if (!username || !/^[a-z0-9_]{3,30}$/.test(username)) {
    return NextResponse.json({ available: false, error: "Invalid username format" });
  }
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
  return NextResponse.json({ available: !data });
}
