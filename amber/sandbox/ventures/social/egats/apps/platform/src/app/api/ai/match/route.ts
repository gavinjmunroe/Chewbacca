import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { matchDancersToJob } from "@/lib/ai/matching";
import type { DancerProfile, Job } from "@/types/database";

// --- In-memory rate limiter ---
const rateLimiter = new Map<string, { count: number; reset: number }>();
function checkRateLimit(key: string, limit = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(key);
  if (!entry || now > entry.reset) {
    rateLimiter.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!checkRateLimit(user.id)) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
  }

  const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { jobId } = body;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Verify this recruiter owns the job
  if (job.recruiter_id !== recruiter.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: dancers } = await supabase
    .from("dancer_profiles")
    .select("id, styles, verification_tier, availability_status, experience_years, travel_willingness, total_bookings, avg_rating, profile:profiles(display_name)")
    .gte("verification_tier", job.min_verification_tier)
    .eq("availability_status", "available")
    .limit(50);

  if (!dancers?.length) {
    return NextResponse.json({ matches: [], message: "No available dancers found matching minimum criteria." });
  }

  try {
    const matches = await matchDancersToJob(job as Job, dancers as unknown as DancerProfile[]);
    const sorted = matches.sort((a, b) => b.score - a.score);
    return NextResponse.json({ matches: sorted });
  } catch {
    return NextResponse.json({ error: "AI matching failed" }, { status: 500 });
  }
}
