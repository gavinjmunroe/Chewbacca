import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format");

  if (format === "exclude") {
    // Return a flat list of user IDs to exclude (users I blocked + users who blocked me)
    const [{ data: iBlocked }, { data: blockedMe }] = await Promise.all([
      supabase
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", user.id),
      supabase
        .from("blocked_users")
        .select("blocker_id")
        .eq("blocked_id", user.id),
    ]);

    const excludeIds = new Set<string>();
    for (const row of iBlocked ?? []) excludeIds.add(row.blocked_id);
    for (const row of blockedMe ?? []) excludeIds.add(row.blocker_id);

    return NextResponse.json({ excludeIds: Array.from(excludeIds) });
  }

  const { data, error } = await supabase
    .from("blocked_users")
    .select(
      `
      blocked_id,
      created_at,
      blocked_profile:profiles!blocked_users_blocked_id_fkey (
        id,
        display_name,
        avatar_url,
        role
      )
    `
    )
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (userId === user.id) {
    return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  }

  // Verify target user exists
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("blocked_users")
    .insert({ blocker_id: user.id, blocked_id: userId })
    .select()
    .single();

  if (error) {
    // Unique violation means already blocked
    if (error.code === "23505") {
      return NextResponse.json({ error: "User is already blocked" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("blocked_users")
    .delete({ count: "exact" })
    .eq("blocker_id", user.id)
    .eq("blocked_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (count === 0) return NextResponse.json({ error: "Block not found" }, { status: 404 });

  return NextResponse.json({ success: true });
}
