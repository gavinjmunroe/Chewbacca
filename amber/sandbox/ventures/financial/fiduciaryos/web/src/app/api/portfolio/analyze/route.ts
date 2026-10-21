import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const PYTHON_API = process.env.FIDUCIARY_PYTHON_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  try {
    const res = await fetch(`${PYTHON_API}/portfolio/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Python backend offline — return graceful degradation
    return NextResponse.json({
      offline: true,
      risk_level: 0,
      risk_alerts: [],
      harvest_candidates: [],
      recommendations: [],
      policy_valid: false,
    }, { status: 200 });
  }
}
