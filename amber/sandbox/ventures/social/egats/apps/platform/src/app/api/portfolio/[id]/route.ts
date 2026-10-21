import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify dancer role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Forbidden: dancer role required" }, { status: 403 });
  }

  // Get dancer_id
  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancerProfile) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  // Verify ownership
  const { data: clip } = await supabase
    .from("portfolio_clips")
    .select("id, dancer_id")
    .eq("id", id)
    .single();

  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  if (clip.dancer_id !== dancerProfile.id) {
    return NextResponse.json({ error: "Forbidden: you do not own this clip" }, { status: 403 });
  }

  let body: { isFeatured?: boolean; displayOrder?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.isFeatured !== undefined) updates.is_featured = body.isFeatured;
  if (body.displayOrder !== undefined) updates.display_order = body.displayOrder;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("portfolio_clips")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify dancer role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Forbidden: dancer role required" }, { status: 403 });
  }

  // Get dancer_id
  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancerProfile) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  // Verify ownership before deleting
  const { data: clip } = await supabase
    .from("portfolio_clips")
    .select("id, dancer_id")
    .eq("id", id)
    .single();

  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  if (clip.dancer_id !== dancerProfile.id) {
    return NextResponse.json({ error: "Forbidden: you do not own this clip" }, { status: 403 });
  }

  const { error } = await supabase
    .from("portfolio_clips")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
