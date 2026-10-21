import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Delete read notifications older than 30 days for the current user
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("notifications")
    .delete({ count: "exact" })
    .eq("user_id", user.id)
    .eq("read", true)
    .lt("created_at", thirtyDaysAgo);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count });
}
