import { NextResponse } from "next/server";
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
}

interface Checkin {
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

export async function GET() {
  try {
    const handle = process.env.CALEB_PHONE || "+15550100002";

    const [profile, checkins] = await Promise.all([
      sbGet<HealthProfile>(
        "health_profiles",
        `handle=eq.${encodeURIComponent(handle)}`,
      ),
      sbQuery<Checkin>(
        "health_checkins",
        `handle=eq.${encodeURIComponent(handle)}`,
        { limit: 90, order: "checkin_date.desc" },
      ),
    ]);

    // Build emotional trend from check-ins
    const sorted = [...checkins].reverse();
    const emotional_trend = sorted
      .filter((c) => typeof c.emotional === "number")
      .map((c) => ({
        date: (c.checkin_date || "").slice(5, 10),
        score: c.emotional as number,
      }));

    const spiritual_trend = sorted
      .filter((c) => typeof c.spiritual === "number")
      .map((c) => ({
        date: (c.checkin_date || "").slice(5, 10),
        score: c.spiritual as number,
      }));

    // Detect risk signals across all 6 dimensions
    const dims = [
      "social",
      "financial",
      "intellectual",
      "spiritual",
      "physical",
      "emotional",
    ] as const;

    const risk_signals: Array<{
      signal: string;
      severity: "low" | "medium" | "high";
      dimension: string;
    }> = [];
    const positive_signals: Array<{ signal: string; dimension: string }> = [];

    if (profile) {
      for (const dim of dims) {
        const score = profile[dim];
        if (typeof score !== "number") continue;
        if (score <= 3) {
          risk_signals.push({
            signal: `${dim.charAt(0).toUpperCase() + dim.slice(1)} is critically low (${score}/10)`,
            severity: "high",
            dimension: dim,
          });
        } else if (score <= 5) {
          risk_signals.push({
            signal: `${dim.charAt(0).toUpperCase() + dim.slice(1)} needs attention (${score}/10)`,
            severity: "medium",
            dimension: dim,
          });
        } else if (score >= 8) {
          positive_signals.push({
            signal: `${dim.charAt(0).toUpperCase() + dim.slice(1)} is strong (${score}/10)`,
            dimension: dim,
          });
        }
      }

      // Trend-based signals: look for declining patterns
      if (emotional_trend.length >= 5) {
        const recent5 = emotional_trend.slice(-5);
        const avg = recent5.reduce((s, c) => s + c.score, 0) / 5;
        const prior5 = emotional_trend.slice(-10, -5);
        if (prior5.length >= 3) {
          const priorAvg =
            prior5.reduce((s, c) => s + c.score, 0) / prior5.length;
          if (avg < priorAvg - 1.5) {
            risk_signals.push({
              signal: `Emotional trend declining: ${priorAvg.toFixed(1)} -> ${avg.toFixed(1)} over last 10 entries`,
              severity: "high",
              dimension: "emotional",
            });
          } else if (avg < priorAvg - 0.5) {
            risk_signals.push({
              signal: `Emotional trend slightly declining`,
              severity: "low",
              dimension: "emotional",
            });
          } else if (avg > priorAvg + 1) {
            positive_signals.push({
              signal: `Emotional trend improving: ${priorAvg.toFixed(1)} -> ${avg.toFixed(1)}`,
              dimension: "emotional",
            });
          }
        }
      }
    }

    // Social withdrawal: low social score + declining message frequency
    const social_withdrawal_risk =
      profile && typeof profile.social === "number" && profile.social <= 4;

    // Cognitive pattern notes from check-in sources
    const cognitive_notes: string[] = [];
    const reflectionCheckins = checkins.filter(
      (c) => c.source === "reflection",
    );
    if (reflectionCheckins.length > 0) {
      cognitive_notes.push(
        `${reflectionCheckins.length} automated health signals captured from conversations`,
      );
    }
    const selfReports = checkins.filter((c) => c.source === "self_report");
    if (selfReports.length > 0) {
      cognitive_notes.push(
        `${selfReports.length} self-reported check-ins logged`,
      );
    }
    if (checkins.length > 0 && checkins[0].notes) {
      cognitive_notes.push(`Last check-in note: "${checkins[0].notes}"`);
    }

    return NextResponse.json({
      current_emotional:
        profile && typeof profile.emotional === "number"
          ? profile.emotional
          : 5,
      current_spiritual:
        profile && typeof profile.spiritual === "number"
          ? profile.spiritual
          : 5,
      emotional_trend,
      spiritual_trend,
      risk_signals,
      positive_signals,
      social_withdrawal_risk: social_withdrawal_risk || false,
      cognitive_notes,
      mood_patterns: [],
    });
  } catch (err) {
    console.error("[wellbeing]", err);
    return NextResponse.json({
      current_emotional: 5,
      current_spiritual: 5,
      emotional_trend: [],
      spiritual_trend: [],
      risk_signals: [],
      positive_signals: [],
      social_withdrawal_risk: false,
      cognitive_notes: [],
      mood_patterns: [],
    });
  }
}
