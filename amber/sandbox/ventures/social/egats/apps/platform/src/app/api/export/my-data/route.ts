import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [profile, applications, bookings, reviews, notifications, clips, verifications] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("applications").select("*").eq("dancer_id", user.id),
    supabase.from("bookings").select("*").or(`dancer_id.eq.${user.id},recruiter_id.eq.${user.id}`),
    supabase.from("reviews").select("*").or(`reviewer_id.eq.${user.id},reviewed_id.eq.${user.id}`),
    supabase.from("notifications").select("*").eq("user_id", user.id).limit(200),
    supabase.from("portfolio_clips").select("*").eq("dancer_id", user.id),
    supabase.from("verification_records").select("*").eq("dancer_id", user.id),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    email: user.email,
    profile: profile.data,
    applications: applications.data ?? [],
    bookings: bookings.data ?? [],
    reviews: reviews.data ?? [],
    notifications: notifications.data ?? [],
    portfolioClips: clips.data ?? [],
    verificationHistory: verifications.data ?? [],
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="egats-my-data-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}
