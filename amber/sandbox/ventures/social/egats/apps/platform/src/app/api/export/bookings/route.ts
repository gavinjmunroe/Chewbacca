import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: bookings } = await supabase
    .from("bookings")
    .select(`
      id, status, start_date, end_date, pay_total_cents, platform_fee_cents, notes, created_at,
      dancer:dancer_profiles(profile:profiles(display_name)),
      recruiter:recruiter_profiles(profile:profiles(display_name)),
      job:jobs(title)
    `)
    .or(`dancer_id.eq.${user.id},recruiter_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (!bookings?.length) {
    return new NextResponse("No bookings to export", { status: 404 });
  }

  const rows = bookings.map(b => ({
    id: b.id,
    status: b.status,
    start_date: b.start_date,
    end_date: b.end_date ?? "",
    pay_total: b.pay_total_cents ? `$${(b.pay_total_cents / 100).toFixed(2)}` : "",
    platform_fee: b.platform_fee_cents ? `$${(b.platform_fee_cents / 100).toFixed(2)}` : "",
    job_title: (b.job as any)?.title ?? "",
    dancer: (b.dancer as any)?.profile?.display_name ?? "",
    recruiter: (b.recruiter as any)?.profile?.display_name ?? "",
    notes: b.notes ?? "",
    created_at: b.created_at,
  }));

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? "")).join(","))
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="egats-bookings-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
