import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; dancerIds?: string[]; jobId?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, dancerIds, jobId, notes } = body;
  if (!name || !dancerIds?.length) return NextResponse.json({ error: "name and dancerIds required" }, { status: 400 });

  const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  const { data, error } = await supabase.from("shortlists").insert({
    recruiter_id: recruiter.id,
    name,
    dancer_ids: dancerIds,
    job_id: jobId || null,
    notes: notes || null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
  if (!recruiter) return NextResponse.json({ data: [] });

  const { data, error } = await supabase.from("shortlists")
    .select("*, job:jobs(title)")
    .eq("recruiter_id", recruiter.id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
