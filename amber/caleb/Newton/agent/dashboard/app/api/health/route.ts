import { NextRequest, NextResponse } from "next/server";
import { sbGet, sbQuery } from "@/lib/supabase";

interface HealthProfile {
  social: number | null;
  financial: number | null;
  intellectual: number | null;
  spiritual: number | null;
  physical: number | null;
  emotional: number | null;
  overall_score: number | null;
  lowest_dimension: string | null;
  highest_dimension: string | null;
  checkin_streak: number;
  total_checkins: number;
  last_checkin_date: string | null;
}

interface HealthCheckin {
  checkin_date: string;
  social: number | null;
  financial: number | null;
  intellectual: number | null;
  spiritual: number | null;
  physical: number | null;
  emotional: number | null;
  source: string;
  notes: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30");
    const handle =
      searchParams.get("handle") || process.env.CALEB_PHONE || "+15550100002";

    // Fetch health profile from Supabase
    const profile = await sbGet<HealthProfile>(
      "health_profiles",
      `handle=eq.${encodeURIComponent(handle)}`,
    );

    // Fetch check-ins for the date range
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const checkins = await sbQuery<HealthCheckin>(
      "health_checkins",
      `handle=eq.${encodeURIComponent(handle)}&checkin_date=gte.${cutoff.toISOString().split("T")[0]}`,
      { limit: 365, order: "checkin_date.desc" },
    );

    return NextResponse.json({ profile, checkins });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
