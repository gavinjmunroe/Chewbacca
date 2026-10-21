import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  let applications: any[] | null = null;

  if (profile?.role === "dancer") {
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (dancer) {
      const { data } = await supabase
        .from("applications")
        .select(`
          id, status, cover_note, ai_match_score, created_at, updated_at,
          job:jobs(title, role_type, city, state),
          recruiter:recruiter_profiles(company_name)
        `)
        .eq("dancer_id", dancer.id)
        .order("created_at", { ascending: false });
      applications = data;
    }
  } else {
    const { data: recruiter } = await supabase
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (recruiter) {
      const { data } = await supabase
        .from("applications")
        .select(`
          id, status, cover_note, ai_match_score, created_at, updated_at,
          job:jobs(title, role_type, city, state),
          dancer:dancer_profiles(profile:profiles(display_name))
        `)
        .in(
          "job_id",
          (
            await supabase
              .from("jobs")
              .select("id")
              .eq("recruiter_id", recruiter.id)
          ).data?.map((j: any) => j.id) ?? []
        )
        .order("created_at", { ascending: false });
      applications = data;
    }
  }

  if (!applications?.length) {
    return new NextResponse("No applications to export", { status: 404 });
  }

  const rows = applications.map(a => ({
    id: a.id,
    status: a.status,
    job_title: (a.job as any)?.title ?? "",
    role_type: (a.job as any)?.role_type ?? "",
    location: (a.job as any)?.city
      ? `${(a.job as any).city}${(a.job as any).state ? `, ${(a.job as any).state}` : ""}`
      : "",
    dancer: (a.dancer as any)?.profile?.display_name ?? "",
    recruiter: (a.recruiter as any)?.company_name ?? "",
    ai_match_score: a.ai_match_score ?? "",
    cover_note: a.cover_note ?? "",
    created_at: a.created_at,
    updated_at: a.updated_at,
  }));

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? "")).join(","))
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="egats-applications-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
