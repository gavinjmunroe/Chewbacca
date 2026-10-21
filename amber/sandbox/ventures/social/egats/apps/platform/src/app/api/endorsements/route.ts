import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dancerId = searchParams.get("dancerId");
  if (!dancerId) return NextResponse.json({ error: "dancerId is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Endorsements are public, but we track if current user endorsed
  const currentUserId = user?.id ?? null;

  const { data: rows, error } = await supabase
    .from("endorsements")
    .select("id, endorser_id, skill")
    .eq("dancer_id", dancerId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by skill, count, check if current user endorsed
  const skillMap: Record<string, { count: number; endorsedByMe: boolean }> = {};
  for (const row of rows ?? []) {
    if (!skillMap[row.skill]) {
      skillMap[row.skill] = { count: 0, endorsedByMe: false };
    }
    skillMap[row.skill].count += 1;
    if (currentUserId && row.endorser_id === currentUserId) {
      skillMap[row.skill].endorsedByMe = true;
    }
  }

  const result = Object.entries(skillMap)
    .map(([skill, data]) => ({ skill, count: data.count, endorsedByMe: data.endorsedByMe }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { dancerId?: string; skill?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dancerId, skill } = body;
  if (!dancerId || !skill) return NextResponse.json({ error: "dancerId and skill are required" }, { status: 400 });

  // Prevent self-endorsement
  const { data: ownProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (ownProfile?.id === dancerId) {
    return NextResponse.json({ error: "Cannot endorse yourself" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("endorsements")
    .insert({ endorser_id: user.id, dancer_id: dancerId, skill })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already endorsed this skill" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { dancerId?: string; skill?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dancerId, skill } = body;
  if (!dancerId || !skill) return NextResponse.json({ error: "dancerId and skill are required" }, { status: 400 });

  const { error } = await supabase
    .from("endorsements")
    .delete()
    .eq("endorser_id", user.id)
    .eq("dancer_id", dancerId)
    .eq("skill", skill);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
