import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { calcMonthlyAllocation, runDeterministicProjection, calcRetirementSummary, generateAlerts } from "@/lib/finance-engine";
import { runMonteCarlo } from "@/lib/monte-carlo";
import { FinancialProfile, Scenario } from "@/lib/types";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let profile: FinancialProfile, mode: "deterministic" | "monte_carlo", scenario: Scenario;
  try {
    ({ profile, mode, scenario } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!profile || typeof profile.baseSalary !== "number") {
    return NextResponse.json({ error: "Valid profile required" }, { status: 400 });
  }

  const allocation = calcMonthlyAllocation(profile);
  const alerts = generateAlerts(profile, allocation);

  if (mode === "monte_carlo") {
    const monteCarlo = runMonteCarlo(profile, scenario ?? "baseline");
    return NextResponse.json({ allocation, alerts, monteCarlo });
  }

  const projection = runDeterministicProjection(profile);
  const retirement = calcRetirementSummary(projection, profile.retirementMarginalRate);
  return NextResponse.json({ allocation, projection, retirement, alerts });
}
