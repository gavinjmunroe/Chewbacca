import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { applicationIds?: string[]; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { applicationIds, status } = body;

  if (!applicationIds || !Array.isArray(applicationIds) || applicationIds.length === 0) {
    return NextResponse.json({ error: "applicationIds must be a non-empty array" }, { status: 400 });
  }

  const validStatuses = ["pending", "shortlisted", "audition_requested", "booked", "rejected", "withdrawn"];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify this recruiter owns the jobs for these applications
  const { data: recruiterProfile } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!recruiterProfile) {
    return NextResponse.json({ error: "Recruiter profile not found" }, { status: 403 });
  }

  // Fetch applications and verify all belong to jobs owned by this recruiter
  const { data: applications, error: fetchError } = await supabase
    .from("applications")
    .select("id, job:jobs(recruiter_id)")
    .in("id", applicationIds);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const unauthorised = (applications ?? []).filter((a) => {
    const recruiter_id = (a.job as unknown as { recruiter_id: string } | null)?.recruiter_id;
    return recruiter_id !== recruiterProfile.id;
  });

  if (unauthorised.length > 0) {
    return NextResponse.json(
      { error: "One or more applications do not belong to your jobs" },
      { status: 403 }
    );
  }

  // Update all in parallel
  const now = new Date().toISOString();
  const results = await Promise.allSettled(
    applicationIds.map((appId) =>
      supabase
        .from("applications")
        .update({ status, updated_at: now })
        .eq("id", appId)
    )
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.length - successCount;

  return NextResponse.json({
    updated: successCount,
    failed: failCount,
    total: applicationIds.length,
  });
}
