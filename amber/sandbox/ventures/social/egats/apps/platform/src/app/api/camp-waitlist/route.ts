import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST: Add dancer to waitlist
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Dancer role only
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Only dancers can join a waitlist" }, { status: 403 });
  }

  let body: { campId?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!body.campId) return NextResponse.json({ error: "campId is required" }, { status: 400 });

  const { campId } = body;

  // Get dancer profile
  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });

  // Check if already registered for this camp
  const { data: existingReg } = await supabase
    .from("camp_registrations")
    .select("id")
    .eq("camp_id", campId)
    .eq("dancer_id", dancer.id)
    .maybeSingle();
  if (existingReg) {
    return NextResponse.json({ error: "You're already registered for this camp" }, { status: 409 });
  }

  // Check if already on waitlist
  const { data: existingWaitlist } = await supabase
    .from("camp_waitlist")
    .select("id, position")
    .eq("camp_id", campId)
    .eq("dancer_id", dancer.id)
    .maybeSingle();
  if (existingWaitlist) {
    return NextResponse.json({ error: "You're already on the waitlist", position: existingWaitlist.position }, { status: 409 });
  }

  // Get next position by counting existing entries + 1
  const { count } = await supabase
    .from("camp_waitlist")
    .select("*", { count: "exact", head: true })
    .eq("camp_id", campId);
  const position = (count ?? 0) + 1;

  const { data: entry, error: insertError } = await supabase
    .from("camp_waitlist")
    .insert({ camp_id: campId, dancer_id: dancer.id, position })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(entry, { status: 201 });
}

// DELETE: Remove from waitlist
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campId = searchParams.get("campId");
  if (!campId) return NextResponse.json({ error: "campId is required" }, { status: 400 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });

  const { error } = await supabase
    .from("camp_waitlist")
    .delete()
    .eq("camp_id", campId)
    .eq("dancer_id", dancer.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// GET: Get current user's waitlist position for a camp
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campId = searchParams.get("campId");
  if (!campId) return NextResponse.json({ error: "campId is required" }, { status: 400 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ onWaitlist: false, position: null });

  const { data: entry } = await supabase
    .from("camp_waitlist")
    .select("id, position, created_at")
    .eq("camp_id", campId)
    .eq("dancer_id", dancer.id)
    .maybeSingle();

  if (!entry) return NextResponse.json({ onWaitlist: false, position: null });

  return NextResponse.json({ onWaitlist: true, position: entry.position, createdAt: entry.created_at });
}
