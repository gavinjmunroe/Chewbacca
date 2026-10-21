import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/culture/circles — fetch all circles
export async function GET() {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("culture_circles")
      .select("id, name, description, cover_url, member_count, created_by, created_at")
      .order("member_count", { ascending: false })
      .limit(50);

    if (error) {
      console.error("culture_circles fetch error:", error);
      return NextResponse.json({ circles: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ circles: data ?? [] });
  } catch (err) {
    console.error("GET /api/culture/circles error:", err);
    return NextResponse.json({ circles: [], error: "Internal server error" }, { status: 500 });
  }
}
