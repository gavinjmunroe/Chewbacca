import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  const { data, error } = await supabase
    .from("job_templates")
    .select("id, name, data, created_at")
    .eq("recruiter_id", recruiter.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  let body: { name?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, data: templateData } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Template name is required" }, { status: 400 });
  if (!templateData || typeof templateData !== "object") {
    return NextResponse.json({ error: "Template data is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("job_templates")
    .insert({
      recruiter_id: recruiter.id,
      name: name.trim(),
      data: templateData,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!recruiter) return NextResponse.json({ error: "Recruiter profile required" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query parameter required" }, { status: 400 });

  const { error } = await supabase
    .from("job_templates")
    .delete()
    .eq("id", id)
    .eq("recruiter_id", recruiter.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
