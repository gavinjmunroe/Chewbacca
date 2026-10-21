import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sbUpsert, sbGet, sbQuery } from "@/lib/supabase";
import { DIMENSIONS } from "@/lib/health";

const schema = z.object({
  social: z.number().min(0).max(10),
  financial: z.number().min(0).max(10),
  intellectual: z.number().min(0).max(10),
  spiritual: z.number().min(0).max(10),
  physical: z.number().min(0).max(10),
  emotional: z.number().min(0).max(10),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        { error: body.error.flatten() },
        { status: 400 },
      );
    }

    const scores = body.data;
    const handle = process.env.CALEB_PHONE || "+15550100002";
    const today = new Date().toISOString().split("T")[0];
    const overall =
      DIMENSIONS.reduce((sum, d) => sum + scores[d], 0) / DIMENSIONS.length;
    const lowest = DIMENSIONS.reduce((a, b) => (scores[a] < scores[b] ? a : b));
    const highest = DIMENSIONS.reduce((a, b) =>
      scores[a] > scores[b] ? a : b,
    );

    // Upsert today's check-in to Supabase
    await sbUpsert("health_checkins", {
      handle,
      checkin_date: today,
      source: "self_report",
      ...scores,
      notes: scores.notes || null,
    });

    // Recalculate profile from last 7 days
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7);
    const recentCheckins = await sbQuery<Record<string, number | string>>(
      "health_checkins",
      `handle=eq.${encodeURIComponent(handle)}&checkin_date=gte.${pastDate.toISOString().split("T")[0]}`,
      { order: "checkin_date.desc" },
    );

    const avg: Record<string, number | null> = {};
    for (const dim of DIMENSIONS) {
      const vals = recentCheckins
        .map((r) => r[dim] as number)
        .filter((v) => v !== null && v !== undefined);
      avg[dim] =
        vals.length > 0
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) /
            10
          : null;
    }

    const totalCheckins = new Set(recentCheckins.map((r) => r.checkin_date))
      .size;

    const profile = {
      ...avg,
      overall_score: parseFloat(overall.toFixed(1)),
      lowest_dimension: lowest,
      highest_dimension: highest,
      last_checkin_date: today,
      total_checkins: totalCheckins,
    };

    await sbUpsert("health_profiles", {
      handle,
      ...profile,
    });

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    console.error("[checkin]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
