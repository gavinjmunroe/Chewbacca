import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: dancer, error } = await supabase
    .from("dancer_profiles")
    .select("id, availability_status")
    .eq("user_id", user.id)
    .single();

  if (error || !dancer) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  return NextResponse.json({ availability_status: dancer.availability_status });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { availability_status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { availability_status } = body;
  const valid = ["available", "limited", "unavailable"];
  if (!availability_status || !valid.includes(availability_status)) {
    return NextResponse.json(
      { error: `availability_status must be one of: ${valid.join(", ")}` },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("dancer_profiles")
    .update({ availability_status, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ availability_status });
}
