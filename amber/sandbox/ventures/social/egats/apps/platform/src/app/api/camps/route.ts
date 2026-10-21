import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("camps")
    .select("*")
    .in("status", ["upcoming", "open"])
    .eq("is_published", true)
    .order("start_date", { ascending: true })
    .limit(50);

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

  const required = ["name", "city", "start_date", "registration_deadline", "max_capacity"];
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }

  if (
    body.start_date &&
    body.registration_deadline &&
    new Date(body.start_date as string) < new Date(body.registration_deadline as string)
  ) {
    return NextResponse.json(
      { error: "start_date must be on or after registration_deadline" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("camps")
    .insert({
      ...body,
      organizer_id: user.id,
      current_registered: 0,
      is_published: false,
      is_sold_out: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
