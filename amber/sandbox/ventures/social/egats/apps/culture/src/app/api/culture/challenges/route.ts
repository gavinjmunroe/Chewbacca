import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/culture/challenges — fetch challenges
// Query params:
//   ?active=true  — filter to only challenges where end_date is in the future (or null)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("active") === "true";

    let query = supabase
      .from("culture_challenges")
      .select("id, title, description, prize, end_date, entry_count, created_at")
      .order("end_date", { ascending: true })
      .limit(20);

    if (activeOnly) {
      // Filter challenges that haven't ended yet
      query = query.or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("culture_challenges fetch error:", error);
      return NextResponse.json({ challenges: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ challenges: data ?? [] });
  } catch (err) {
    console.error("GET /api/culture/challenges error:", err);
    return NextResponse.json({ challenges: [], error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/culture/challenges — admin only, create a new challenge
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Only admins can create challenges
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
    }

    let body: {
      title?: string;
      description?: string;
      prize?: string;
      end_date?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { title, description, prize, end_date } = body;
    if (!title || !description) {
      return NextResponse.json({ error: "title and description are required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("culture_challenges")
      .insert({
        title,
        description,
        prize: prize ?? null,
        end_date: end_date ?? null,
        entry_count: 0,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/culture/challenges error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
