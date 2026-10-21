import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/culture/circles/[id]/join — join a circle
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: circleId } = await params;

    // Check if already a member
    const { data: existing } = await supabase
      .from("culture_circle_members")
      .select("circle_id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Already a member" }, { status: 409 });
    }

    // Insert membership
    const { error: joinError } = await supabase
      .from("culture_circle_members")
      .insert({ circle_id: circleId, user_id: user.id });

    if (joinError) {
      console.error("culture_circle_members insert error:", joinError);
      return NextResponse.json({ error: joinError.message }, { status: 500 });
    }

    // Increment member_count
    await supabase.rpc("increment_circle_members", { circle_id: circleId });

    return NextResponse.json({ message: "Joined successfully" }, { status: 200 });
  } catch (err) {
    console.error("POST /api/culture/circles/[id]/join error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
