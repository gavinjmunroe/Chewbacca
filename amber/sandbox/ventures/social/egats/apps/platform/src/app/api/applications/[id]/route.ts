import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });
  const validStatuses = ["pending", "shortlisted", "audition_requested", "booked", "rejected", "withdrawn"];
  if (!validStatuses.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  // Fetch the application with job and dancer info
  const { data: app } = await supabase.from("applications")
    .select("id, dancer_id, user_id, job_id, status, job:jobs(recruiter_id)")
    .eq("id", id)
    .single();

  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  // Dancers can only withdraw their own pending applications
  if (status === "withdrawn") {
    if (app.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden: you can only withdraw your own application" }, { status: 403 });
    }
    if ((app as unknown as { status: string }).status !== "pending") {
      return NextResponse.json({ error: "Only pending applications can be withdrawn" }, { status: 400 });
    }
  } else {
    // All other status changes require the job's recruiter
    const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
    if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });
    if ((app.job as unknown as { recruiter_id: string } | null)?.recruiter_id !== recruiter.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "shortlisted") updates.shortlisted_at = new Date().toISOString();

  const { data, error } = await supabase.from("applications").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify dancer of status change
  const statusMessages: Record<string, string> = {
    shortlisted: "You've been shortlisted for a job!",
    audition_requested: "An audition has been requested for your application.",
    booked: "Congratulations! You've been booked for a job.",
    rejected: "Your application was not selected for this role.",
  };
  if (statusMessages[status]) {
    const appData = app as unknown as { dancer_id: string; job_id: string };
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("user_id")
      .eq("id", appData.dancer_id)
      .single();
    if (dancer) {
      await supabase.from("notifications").insert({
        user_id: dancer.user_id,
        type: "application_update",
        title: "Application Update",
        body: statusMessages[status],
        data: {
          application_id: id,
          job_id: appData.job_id,
          status,
        },
      });
    }
  }

  void logAuditEvent(supabase, "application.status_changed", user.id, {
    application_id: id,
    new_status: status,
  });

  return NextResponse.json(data);
}
