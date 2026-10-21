import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VerificationTier } from "@/types/database";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (profile.role === "verifier" || profile.role === "admin") {
    // Verifier/admin: return all pending records (verifier_id IS NULL, not revoked)
    const { data, error } = await supabase
      .from("verification_records")
      .select(
        `*, dancer:dancer_profiles(
          id, verification_tier,
          profile:profiles(display_name, avatar_url, location),
          clips:portfolio_clips(id, title, clip_url, thumbnail_url, styles, is_featured)
        ), camp:camps(name, city, state)`
      )
      .is("verifier_id", null)
      .eq("revoked", false)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  if (profile.role === "dancer") {
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!dancer) return NextResponse.json([]);

    const { data, error } = await supabase
      .from("verification_records")
      .select("*, camp:camps(name, city, state)")
      .eq("dancer_id", dancer.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "dancer") {
    return NextResponse.json(
      { error: "Only dancers can submit verification requests" },
      { status: 403 }
    );
  }

  let body: { campId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { campId } = body;

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id, verification_tier")
    .eq("user_id", user.id)
    .single();

  if (!dancer) return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });

  const currentTier = parseInt(dancer.verification_tier as string, 10);

  if (currentTier >= 2) {
    return NextResponse.json(
      { error: "Already at maximum verification tier (Tier 2)" },
      { status: 400 }
    );
  }

  const tierRequested = (currentTier + 1).toString() as VerificationTier;

  // Check for existing pending submission (verifier_id IS NULL and not revoked)
  const { data: existing } = await supabase
    .from("verification_records")
    .select("id")
    .eq("dancer_id", dancer.id)
    .eq("tier_awarded", tierRequested)
    .is("verifier_id", null)
    .eq("revoked", false)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "You already have a pending verification request for this tier" },
      { status: 400 }
    );
  }

  if (campId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(campId)) return NextResponse.json({ error: "Invalid campId format" }, { status: 400 });

    const { data: camp } = await supabase
      .from("camps")
      .select("id")
      .eq("id", campId)
      .single();
    if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });
  }

  const { data: record, error } = await supabase
    .from("verification_records")
    .insert({
      dancer_id: dancer.id,
      camp_id: campId ?? null,
      tier_awarded: tierRequested,
      revoked: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(record, { status: 201 });
}
