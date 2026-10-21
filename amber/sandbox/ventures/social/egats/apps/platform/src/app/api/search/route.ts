import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ dancers: [], jobs: [], camps: [] });
  if (q.length > 100) return NextResponse.json({ error: "Query too long" }, { status: 400 });

  const escaped = q.replace(/[%_]/g, '\\$&');

  const [dancersRes, jobsRes, campsRes] = await Promise.all([
    supabase
      .from("dancer_profiles")
      .select("id, user_id, experience_years, verification_tier, styles, profile:profiles(display_name, avatar_url, location)")
      .or(`profiles.display_name.ilike.%${escaped}%,styles.cs.{${escaped}}`)
      .limit(5),
    supabase
      .from("jobs")
      .select("id, title, location, status, application_deadline, recruiter:recruiter_profiles(company_name, profile:profiles(display_name))")
      .ilike("title", `%${escaped}%`)
      .eq("status", "open")
      .limit(5),
    supabase
      .from("camps")
      .select("id, name, location, start_date, end_date, status")
      .ilike("name", `%${escaped}%`)
      .in("status", ["upcoming", "open"])
      .limit(5),
  ]);

  return NextResponse.json({
    dancers: dancersRes.data ?? [],
    jobs: jobsRes.data ?? [],
    camps: campsRes.data ?? [],
  });
}
