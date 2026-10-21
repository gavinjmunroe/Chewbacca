import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: camp, error } = await supabase
    .from("camps")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  // Also return registration count
  const { count } = await supabase
    .from("camp_registrations")
    .select("id", { count: "exact", head: true })
    .eq("camp_id", id);

  return NextResponse.json({ ...camp, registration_count: count ?? camp.current_registered });
}

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "verifier"].includes(profile.role)) {
    return NextResponse.json({ error: "Organizer role required" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Prevent overwriting protected fields
  const PROTECTED = ["id", "organizer_id", "created_at", "current_registered"];
  for (const field of PROTECTED) {
    delete body[field];
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("camps")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
