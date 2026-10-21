import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile required" }, { status: 403 });

  const { data, error } = await supabase
    .from("saved_jobs")
    .select(`
      id,
      created_at,
      job:jobs(
        id,
        title,
        role_type,
        status,
        application_deadline,
        pay_range_min_cents,
        pay_range_max_cents,
        pay_type,
        city,
        state,
        remote_possible,
        start_date,
        head_count,
        styles_needed,
        min_verification_tier,
        total_applications,
        created_at,
        recruiter:recruiter_profiles(company_name, is_verified)
      )
    `)
    .eq("dancer_id", dancer.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile required" }, { status: 403 });

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId } = body;
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) return NextResponse.json({ error: "Invalid jobId format" }, { status: 400 });

  // Check if already saved
  const { data: existing } = await supabase
    .from("saved_jobs")
    .select("id")
    .eq("dancer_id", dancer.id)
    .eq("job_id", jobId)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Job already saved" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("saved_jobs")
    .insert({ dancer_id: dancer.id, job_id: jobId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancer) return NextResponse.json({ error: "Dancer profile required" }, { status: 403 });

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId } = body;
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) return NextResponse.json({ error: "Invalid jobId format" }, { status: 400 });

  // Check if saved
  const { data: existing } = await supabase
    .from("saved_jobs")
    .select("id")
    .eq("dancer_id", dancer.id)
    .eq("job_id", jobId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Job not saved" }, { status: 409 });
  }

  const { error } = await supabase
    .from("saved_jobs")
    .delete()
    .eq("dancer_id", dancer.id)
    .eq("job_id", jobId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
