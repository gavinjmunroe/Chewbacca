import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status } = body;
  const VALID_STATUSES = ["confirmed", "in_progress", "completed", "cancelled", "pending"];
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }

  // Fetch the booking to verify the user is a party to it
  const { data: booking } = await supabase
    .from("bookings")
    .select(`
      id, status,
      dancer:dancer_profiles(user_id),
      recruiter:recruiter_profiles(user_id)
    `)
    .eq("id", id)
    .single();

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const dancerProfile = (booking.dancer as unknown as { user_id: string } | { user_id: string }[] | null);
  const recruiterProfile = (booking.recruiter as unknown as { user_id: string } | { user_id: string }[] | null);
  const isDancer = (Array.isArray(dancerProfile) ? dancerProfile[0] : dancerProfile)?.user_id === user.id;
  const isRecruiter = (Array.isArray(recruiterProfile) ? recruiterProfile[0] : recruiterProfile)?.user_id === user.id;

  if (!isDancer && !isRecruiter) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Enforce allowed transitions per role
  if (isRecruiter && !(booking.status === "confirmed" && status === "completed")) {
    return NextResponse.json(
      { error: "Recruiters can only mark a confirmed booking as completed" },
      { status: 403 }
    );
  }

  if (isDancer && !["confirmed"].includes(booking.status)) {
    return NextResponse.json(
      { error: "No pending action available for this booking" },
      { status: 403 }
    );
  }

  if (isDancer && !["confirmed", "cancelled"].includes(status)) {
    return NextResponse.json(
      { error: "Dancers can only accept (confirm) or decline (cancel) bookings" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logAuditEvent(supabase, "booking.status_changed", user.id, {
    booking_id: id,
    new_status: status,
    previous_status: booking.status,
  });

  return NextResponse.json(data);
}
