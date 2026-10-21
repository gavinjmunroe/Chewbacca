import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/culture/posts — fetch feed posts joined with profiles
// Query params: page (default 1), limit (default 20, max 50), circle_id, style
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const circleId = searchParams.get("circle_id");
    const style = searchParams.get("style");

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10) || 20;
    const limit = Math.min(Math.max(1, rawLimit), 50);
    const offset = (page - 1) * limit;

    // Count total matching rows
    let countQuery = supabase
      .from("culture_posts")
      .select("id", { count: "exact", head: true });

    if (circleId) countQuery = countQuery.eq("circle_id", circleId);
    if (style) countQuery = countQuery.contains("styles", [style]);

    const { count } = await countQuery;
    const total = count ?? 0;

    let query = supabase
      .from("culture_posts")
      .select(`
        id,
        user_id,
        content,
        media_url,
        styles,
        likes_count,
        comments_count,
        circle_id,
        created_at,
        profiles (
          id,
          display_name,
          avatar_url,
          role
        )
      `)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (circleId) {
      query = query.eq("circle_id", circleId);
    }

    if (style) {
      query = query.contains("styles", [style]);
    }

    const { data, error } = await query;

    if (error) {
      console.error("culture_posts fetch error:", error);
      return NextResponse.json({ posts: [], error: error.message, hasMore: false, total: 0 }, { status: 500 });
    }

    const posts = data ?? [];
    const hasMore = offset + posts.length < total;

    return NextResponse.json({ posts, hasMore, total });
  } catch (err) {
    console.error("GET /api/culture/posts error:", err);
    return NextResponse.json({ posts: [], error: "Internal server error", hasMore: false, total: 0 }, { status: 500 });
  }
}

// POST /api/culture/posts — create a new post
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { content, media_url, styles, circle_id } = body;

    if (!content?.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("culture_posts")
      .insert({
        user_id: user.id,
        content: content.trim(),
        media_url: media_url || null,
        styles: styles || [],
        circle_id: circle_id || null,
        likes_count: 0,
        comments_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("culture_posts insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ post: data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/culture/posts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
