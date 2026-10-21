import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { jobId?: string; coverNote?: string; submittedClips?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { jobId, coverNote, submittedClips } = body;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const { data: dancer } = await supabase.from("dancer_profiles").select("id").eq("user_id", user.id).single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });

  // Ensure the dancer is not the recruiter who posted this job
  const { data: jobOwner } = await supabase
    .from("jobs")
    .select("recruiter:recruiter_profiles(user_id)")
    .eq("id", jobId)
    .single();
  const recruiterUserId = (jobOwner?.recruiter as unknown as { user_id: string } | null)?.user_id;
  if (recruiterUserId === user.id) {
    return NextResponse.json({ error: "You cannot apply to your own job" }, { status: 400 });
  }

  // Check not already applied
  const { data: existing } = await supabase.from("applications").select("id").eq("job_id", jobId).eq("dancer_id", dancer.id).single();
  if (existing) return NextResponse.json({ error: "Already applied" }, { status: 400 });

  const { data, error } = await supabase.from("applications").insert({
    job_id: jobId,
    dancer_id: dancer.id,
    user_id: user.id,
    cover_note: coverNote,
    submitted_clips: submittedClips || [],
    status: "pending",
  }).select().single();

  if (error) {
    console.error("[API error]", error);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }

  // Bump application count
  try { await supabase.rpc("increment_job_applications", { p_job_id: jobId }); } catch { /* non-critical */ }

  // Notify recruiter of new application
  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("title, recruiter:recruiter_profiles(user_id)")
      .eq("id", jobId)
      .single();
    if (job?.recruiter) {
      const recruiterUserId = (job.recruiter as unknown as { user_id: string }).user_id;
      await supabase.from("notifications").insert({
        user_id: recruiterUserId,
        type: "new_application",
        title: "New Application",
        body: `Someone applied to "${job.title}"`,
        data: { application_id: (data as { id: string }).id, job_id: jobId },
      });
    }
  } catch { /* non-critical */ }

  void logAuditEvent(supabase, "application.created", user.id, {
    application_id: (data as { id: string }).id,
    job_id: jobId,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  let query = supabase.from("applications").select("*, job:jobs(title,role_type,city), dancer:dancer_profiles(id,user_id,stage_name,styles,experience_years,verification_tier,availability_status,height_cm,union_member,represented,represented_by,profile:profiles(display_name,avatar_url))");

  if (profile?.role === "dancer") {
    query = query.eq("user_id", user.id);
  } else if (jobId) {
    // Guard: verify the recruiter owns this job before exposing its applications
    const { data: recruiter } = await supabase
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (recruiter) {
      const { data: job } = await supabase
        .from("jobs")
        .select("recruiter_id")
        .eq("id", jobId)
        .single();

      if (!job || job.recruiter_id !== recruiter.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    query = query.eq("job_id", jobId);

    // For recruiter view: exclude applications from blocked dancers
    const [{ data: iBlocked }, { data: blockedMe }] = await Promise.all([
      supabase.from("blocked_users").select("blocked_id").eq("blocker_id", user.id),
      supabase.from("blocked_users").select("blocker_id").eq("blocked_id", user.id),
    ]);
    const blockedUserIds = new Set<string>();
    for (const row of iBlocked ?? []) blockedUserIds.add(row.blocked_id);
    for (const row of blockedMe ?? []) blockedUserIds.add(row.blocker_id);

    if (blockedUserIds.size > 0) {
      // Get dancer profile IDs for blocked user IDs
      const { data: blockedDancers } = await supabase
        .from("dancer_profiles")
        .select("id")
        .in("user_id", Array.from(blockedUserIds));
      const blockedDancerIds = (blockedDancers ?? []).map((d) => d.id);
      if (blockedDancerIds.length > 0) {
        query = query.not("dancer_id", "in", `(${blockedDancerIds.join(",")})`);
      }
    }
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    console.error("[API error]", error);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
  return NextResponse.json(data);
}
