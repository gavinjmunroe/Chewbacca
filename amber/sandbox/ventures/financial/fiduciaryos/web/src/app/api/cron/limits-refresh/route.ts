import { NextRequest, NextResponse } from "next/server";

/**
 * Vercel Cron Job — runs annually (Jan 1) to bust any cached IRS limit values.
 * vercel.json: { "crons": [{ "path": "/api/cron/limits-refresh", "schedule": "0 9 1 1 *" }] }
 *
 * Authorization: Bearer $CRON_SECRET  (set in Vercel environment variables)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TAX_LIMITS_2026 is currently a compile-time constant in src/lib/types.ts.
  // This stub is the hook point for a future dynamic refresh (e.g. fetching from
  // an IRS API or updating a Supabase config row) without changing the cron schedule.
  return NextResponse.json({ ok: true, refreshed: new Date().toISOString() });
}
