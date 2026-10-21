import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      *,
      recruiter:recruiter_profiles(*, profile:profiles(display_name, avatar_url, location)),
      applications_count:applications(count)
    `)
    .eq("id", id)
    .single();

  if (error || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Auto-close expired jobs
  const now = new Date();
  if (job.application_deadline && new Date(job.application_deadline) < now && job.status === "open") {
    await supabase.from("jobs").update({ status: "closed" }).eq("id", job.id);
    job.status = "closed";
  }

  return NextResponse.json(job);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  // Verify ownership
  const { data: existing } = await supabase
    .from("jobs")
    .select("id, recruiter_id, status")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (existing.recruiter_id !== recruiter.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: string;
    description?: string;
    pay_min?: number | null;
    pay_max?: number | null;
    deadline?: string | null;
    styles_needed?: string[];
    city?: string | null;
    state?: string | null;
    remote_possible?: boolean;
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, pay_min, pay_max, deadline, styles_needed, city, state, remote_possible, status } = body;

  // Validate title
  if (title !== undefined && title.trim().length === 0) {
    return NextResponse.json({ error: "Title cannot be blank" }, { status: 400 });
  }

  // Validate pay range
  if (pay_min !== undefined && pay_max !== undefined && pay_min !== null && pay_max !== null) {
    if (pay_min > pay_max) {
      return NextResponse.json({ error: "pay_min must be <= pay_max" }, { status: 400 });
    }
  }

  // Validate deadline in future
  if (deadline) {
    const d = new Date(deadline);
    if (isNaN(d.getTime()) || d <= new Date()) {
      return NextResponse.json({ error: "Deadline must be a future date" }, { status: 400 });
    }
  }

  // Validate status transitions
  if (status !== undefined) {
    const allowedTransitions: Record<string, string[]> = {
      open: ["closed"],
      closed: ["open"],
    };
    const allowed = allowedTransitions[existing.status] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from "${existing.status}" to "${status}"` },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (pay_min !== undefined) updates.pay_range_min_cents = pay_min !== null ? Math.round(pay_min * 100) : null;
  if (pay_max !== undefined) updates.pay_range_max_cents = pay_max !== null ? Math.round(pay_max * 100) : null;
  if (deadline !== undefined) updates.application_deadline = deadline || null;
  if (styles_needed !== undefined) updates.styles_needed = styles_needed;
  if (city !== undefined) updates.city = city || null;
  if (state !== undefined) updates.state = state || null;
  if (remote_possible !== undefined) updates.remote_possible = remote_possible;
  if (status !== undefined) updates.status = status;

  const { data, error } = await supabase
    .from("jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  // Verify ownership
  const { data: existing } = await supabase
    .from("jobs")
    .select("id, recruiter_id")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (existing.recruiter_id !== recruiter.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check no bookings exist for this job
  const { count: bookingCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id);

  if (bookingCount && bookingCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete a job that has existing bookings" },
      { status: 409 }
    );
  }

  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
