import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_CATEGORIES = [
  "harassment",
  "inappropriate_content",
  "fraud",
  "impersonation",
  "underage",
  "other",
] as const;

type ReportCategory = (typeof VALID_CATEGORIES)[number];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { reportedUserId?: string; category?: string; description?: string; relatedBookingId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { reportedUserId, category, description, relatedBookingId } = body;

  if (!reportedUserId || !category || !description) {
    return NextResponse.json(
      { error: "reportedUserId, category, and description are required" },
      { status: 400 }
    );
  }

  if (reportedUserId === user.id) {
    return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  }

  if (!VALID_CATEGORIES.includes(category as ReportCategory)) {
    return NextResponse.json(
      {
        error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (typeof description !== "string" || description.trim().length < 20) {
    return NextResponse.json(
      { error: "description must be at least 20 characters" },
      { status: 400 }
    );
  }

  if (description.trim().length > 2000) {
    return NextResponse.json(
      { error: "description cannot exceed 2000 characters" },
      { status: 400 }
    );
  }

  // Verify the reported user actually exists
  const { data: reportedProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", reportedUserId)
    .single();

  if (!reportedProfile) {
    return NextResponse.json({ error: "Reported user not found" }, { status: 404 });
  }

  // Optionally validate the booking belongs to one of these parties
  if (relatedBookingId) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("dancer:dancer_profiles(user_id), recruiter:recruiter_profiles(user_id)")
      .eq("id", relatedBookingId)
      .single();

    if (!booking) {
      return NextResponse.json({ error: "Related booking not found" }, { status: 404 });
    }

    const dancerUserId = (booking.dancer as unknown as { user_id: string } | null)?.user_id;
    const recruiterUserId = (booking.recruiter as unknown as { user_id: string } | null)?.user_id;
    const partyIds = [dancerUserId, recruiterUserId].filter(Boolean);

    if (!partyIds.includes(user.id) || !partyIds.includes(reportedUserId)) {
      return NextResponse.json(
        { error: "Related booking does not involve both parties" },
        { status: 400 }
      );
    }
  }

  const { data: report, error } = await supabase
    .from("safety_reports")
    .insert({
      reporter_id: user.id,
      reported_user_id: reportedUserId,
      category,
      description: description.trim(),
      related_booking_id: relatedBookingId ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify admins via the create_notification helper function.
  // We look up all admin profiles and send each one a notification.
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin");

  if (admins && admins.length > 0) {
    const notificationInserts = admins.map((admin) => ({
      user_id: admin.id,
      type: "safety_report",
      title: "New Safety Report",
      body: `A new ${category} report has been submitted and requires review.`,
      data: {
        report_id: report.id,
        category,
        reporter_id: user.id,
        reported_user_id: reportedUserId,
      },
    }));

    await supabase.from("notifications").insert(notificationInserts);
  }

  return NextResponse.json(report, { status: 201 });
}
