import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalBookings },
    { count: newUsersThisWeek },
    { count: appsThisWeek },
    { count: appsLastWeek },
    { count: verificationApproved },
    { count: verificationTotal },
  ] = await Promise.all([
    supabase.from("bookings").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
    supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
    supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", twoWeeksAgo).lt("created_at", oneWeekAgo),
    supabase.from("verification_records").select("*", { count: "exact", head: true }).not("verifier_id", "is", null).eq("revoked", false),
    supabase.from("verification_records").select("*", { count: "exact", head: true }).not("verifier_id", "is", null),
  ]);

  return NextResponse.json({
    totalBookings,
    newUsersThisWeek,
    appsThisWeek,
    appsLastWeek,
    appsGrowthPct: appsLastWeek ? Math.round(((appsThisWeek! - appsLastWeek!) / appsLastWeek!) * 100) : null,
    verificationApprovalRate: verificationTotal ? Math.round((verificationApproved! / verificationTotal!) * 100) : null,
  });
}
