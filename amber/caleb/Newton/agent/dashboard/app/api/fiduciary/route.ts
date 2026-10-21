import { NextResponse } from "next/server";
import { sbGet } from "@/lib/supabase";

export async function GET() {
  try {
    const handle = process.env.CALEB_PHONE || "+15550100002";

    // Load health profile for financial dimension
    const health = await sbGet<{
      financial: number | null;
      overall_score: number | null;
    }>("health_profiles", `handle=eq.${encodeURIComponent(handle)}`);

    const financialScore =
      health && typeof health.financial === "number" ? health.financial : 5;

    // Build financial snapshot from available data
    // In production this would pull from bank APIs, but for now we use
    // the financial health dimension + known income sources from Caleb's context
    return NextResponse.json({
      financial_health_score: financialScore,
      income_sources: [
        { name: "AINA Tech", amount: 1500, type: "W-2" },
        { name: "Blue Modern Advisory", amount: 2000, type: "consulting" },
        { name: "Beamlink", amount: 1000, type: "consulting" },
        { name: "Pallas Care", amount: 1200, type: "consulting" },
      ],
      monthly_burn: 2800,
      runway_months: Math.round((5700 / 2800) * 3),
      debt_total: 0,
      savings_rate: Math.round(((5700 - 2800) / 5700) * 100),
      risk_signals:
        financialScore < 6
          ? [
              {
                signal: "Financial health dimension below average",
                severity: "medium" as const,
              },
              {
                signal: "Multiple income sources increase tax complexity",
                severity: "low" as const,
              },
            ]
          : [
              {
                signal: "Multiple income sources increase tax complexity",
                severity: "low" as const,
              },
            ],
      opportunities: [
        {
          opportunity: "Open a Roth IRA with $50/month auto-invest",
          impact: "Tax-free growth on $600/year, compound over 40 years",
        },
        {
          opportunity: "Set up quarterly estimated tax payments",
          impact: "Avoid penalties on consulting income (1099)",
        },
        {
          opportunity: "Track consulting hours for tax deductions",
          impact: "Home office, equipment, software all deductible",
        },
      ],
    });
  } catch (err) {
    console.error("[fiduciary]", err);
    return NextResponse.json({
      financial_health_score: 5,
      income_sources: [],
      monthly_burn: 0,
      runway_months: 0,
      debt_total: 0,
      savings_rate: 0,
      risk_signals: [],
      opportunities: [],
    });
  }
}
