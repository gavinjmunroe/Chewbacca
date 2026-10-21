import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchDancersByIntent } from "@/lib/ai/matching";
import type { DancerProfile } from "@/types/database";

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

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { query } = body;
  if (!query) return NextResponse.json({ error: "Query required" }, { status: 400 });
  if (query.length > 500) return NextResponse.json({ error: "Query too long" }, { status: 400 });

  const { data: dancers } = await supabase
    .from("dancer_profiles")
    .select("id, styles, verification_tier, availability_status, experience_years, travel_willingness")
    .limit(100);

  if (!dancers?.length) {
    return NextResponse.json({ ids: [], explanation: "No dancers found in database." });
  }

  try {
    const result = await searchDancersByIntent(query, dancers as DancerProfile[]);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "AI search failed" }, { status: 500 });
  }
}
