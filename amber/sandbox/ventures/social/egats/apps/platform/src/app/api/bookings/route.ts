import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  let query = supabase.from("bookings").select("*, dancer:dancer_profiles(*, profile:profiles(display_name,avatar_url)), recruiter:recruiter_profiles(company_name)");

  if (profile?.role === "dancer") {
    const { data: dancer } = await supabase.from("dancer_profiles").select("id").eq("user_id", user.id).single();
    if (dancer) query = query.eq("dancer_id", dancer.id);
  } else {
    const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
    if (recruiter) query = query.eq("recruiter_id", recruiter.id);
  }

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { applicationId?: string; roleTitle?: string; startDate?: string; endDate?: string; totalPayCents?: number; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { applicationId, roleTitle, startDate, endDate, totalPayCents, notes } = body;

  const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  const { data: app } = await supabase.from("applications").select("*, job:jobs(recruiter_id)").eq("id", applicationId).single();
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  // Verify this recruiter owns the job
  if (app.job?.recruiter_id !== recruiter.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return NextResponse.json({ error: "Start date cannot be after end date" }, { status: 400 });
  }
  if (totalPayCents !== undefined && totalPayCents < 0) {
    return NextResponse.json({ error: "Total pay cannot be negative" }, { status: 400 });
  }

  // Prevent duplicate bookings for same application
  const { data: existingBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (existingBooking) {
    return NextResponse.json({ error: "A booking already exists for this application" }, { status: 409 });
  }

  const platformFeeCents = totalPayCents ? Math.round(totalPayCents * parseFloat(process.env.PLATFORM_FEE_RATE ?? "0.05")) : null;

  const { data, error } = await supabase.from("bookings").insert({
    job_id: app.job_id,
    application_id: applicationId,
    dancer_id: app.dancer_id,
    recruiter_id: recruiter.id,
    status: "confirmed",
    role_title: roleTitle || app.job?.title,
    start_date: startDate,
    end_date: endDate,
    total_pay_cents: totalPayCents,
    platform_fee_cents: platformFeeCents,
    notes,
  }).select().single();

  if (error) {
    let message = error.message;
    if (message.includes("duplicate key value violates")) message = "You've already submitted this.";
    else if (message.includes("foreign key constraint")) message = "Invalid reference: the related item no longer exists.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Update application status
  await supabase.from("applications").update({ status: "booked" }).eq("id", applicationId);

  // Notify dancer of new booking
  try {
    const dancerProfileId = (data as { dancer_id: string }).dancer_id;
    const { data: dancerProfile } = await supabase
      .from("dancer_profiles")
      .select("user_id")
      .eq("id", dancerProfileId)
      .single();
    if (dancerProfile) {
      await supabase.from("notifications").insert({
        user_id: dancerProfile.user_id,
        type: "booking_created",
        title: "New Booking Request",
        body: "You have a new booking request.",
        data: { booking_id: (data as { id: string }).id },
      });
    }
  } catch { /* non-critical */ }

  // TODO: Send booking confirmation email
  // const { data: dancerProfile } = await supabase
  //   .from("dancer_profiles")
  //   .select("profile:profiles(email)")
  //   .eq("id", data.dancer_id)
  //   .single();
  // const dancerEmail = dancerProfile?.profile?.email;
  // if (dancerEmail) {
  //   await sendNotificationEmail({
  //     to: dancerEmail,
  //     subject: 'Booking Confirmed',
  //     body: `Your booking for "${data.role_title}" has been confirmed.`,
  //   });
  // }

  void logAuditEvent(supabase, "booking.created", user.id, {
    booking_id: (data as { id: string }).id,
    application_id: applicationId,
  });

  return NextResponse.json(data, { status: 201 });
}
