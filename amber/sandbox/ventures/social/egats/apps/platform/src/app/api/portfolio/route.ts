import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BUCKET = process.env.NEXT_PUBLIC_STORAGE_BUCKET ?? "portfolio-clips";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify dancer role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Forbidden: dancer role required" }, { status: 403 });
  }

  // Get dancer_id from dancer_profiles
  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancerProfile) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("portfolio_clips")
    .select("*")
    .eq("dancer_id", dancerProfile.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify dancer role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Forbidden: dancer role required" }, { status: 403 });
  }

  let body: { clipUrl?: string; thumbnailUrl?: string; title?: string; description?: string; styles?: string[]; durationSeconds?: number; isFeatured?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { clipUrl, thumbnailUrl, title, description, styles, durationSeconds, isFeatured } = body;

  if (!clipUrl || !title) {
    return NextResponse.json({ error: "clipUrl and title are required" }, { status: 400 });
  }

  // Get dancer_id
  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!dancerProfile) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("portfolio_clips")
    .insert({
      dancer_id: dancerProfile.id,
      clip_url: clipUrl,
      thumbnail_url: thumbnailUrl ?? null,
      title,
      description: description ?? null,
      styles: styles ?? [],
      duration_seconds: durationSeconds ?? null,
      is_featured: isFeatured ?? false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
