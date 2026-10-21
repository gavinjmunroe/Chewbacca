import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

interface SplitRequestBody {
  whatWasTested: string;
  controlSampleSize: number;
  controlConversionRate: number;
  variantSampleSize: number;
  variantConversionRate: number;
  testDuration: string;
  metricName?: string;
}

function isSplitRequestBody(value: unknown): value is SplitRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.whatWasTested === "string" &&
    obj.whatWasTested.trim().length > 0 &&
    typeof obj.controlSampleSize === "number" &&
    obj.controlSampleSize > 0 &&
    typeof obj.controlConversionRate === "number" &&
    obj.controlConversionRate >= 0 &&
    obj.controlConversionRate <= 100 &&
    typeof obj.variantSampleSize === "number" &&
    obj.variantSampleSize > 0 &&
    typeof obj.variantConversionRate === "number" &&
    obj.variantConversionRate >= 0 &&
    obj.variantConversionRate <= 100 &&
    typeof obj.testDuration === "string" &&
    obj.testDuration.trim().length > 0
  );
}

export async function POST(req: NextRequest) {
  try {
    const raw: unknown = await req.json();
    if (!isSplitRequestBody(raw)) {
      return NextResponse.json(
        { error: "Invalid request body. Check all required fields." },
        { status: 400 },
      );
    }

    const {
      whatWasTested,
      controlSampleSize,
      controlConversionRate,
      variantSampleSize,
      variantConversionRate,
      testDuration,
      metricName = "conversion rate",
    } = raw;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are analyzing an A/B test. Return ONLY valid JSON with no markdown, no code blocks, no explanation outside the JSON.

A/B Test Details:
- What was tested: ${whatWasTested}
- Metric: ${metricName}
- Test duration: ${testDuration}
- Control: ${controlSampleSize} users, ${controlConversionRate}% ${metricName}
- Variant: ${variantSampleSize} users, ${variantConversionRate}% ${metricName}

Calculate statistical significance using a two-proportion z-test. Compute:
- p1 = ${controlConversionRate / 100} (control rate)
- p2 = ${variantConversionRate / 100} (variant rate)
- n1 = ${controlSampleSize}, n2 = ${variantSampleSize}
- pooled p = (p1*n1 + p2*n2) / (n1 + n2)
- SE = sqrt(pooled_p * (1 - pooled_p) * (1/n1 + 1/n2))
- z = (p2 - p1) / SE
- Convert z-score to p-value

Return exactly this JSON structure:
{
  "verdict": "Ship Variant B | Keep Control | Inconclusive | Need More Data",
  "verdictReason": "plain English explanation of the verdict",
  "statisticalSignificance": {
    "significant": true or false,
    "pValue": "0.03",
    "confidence": "97%",
    "zScore": "2.14"
  },
  "effectSize": {
    "relative": "+12.3%",
    "absolute": "+1.2pp",
    "practicallySignificant": true or false,
    "practicalNote": "plain English note on whether the effect size matters for a real business"
  },
  "sampleSizeAdequacy": "Adequate | Underpowered | Overpowered",
  "sampleSizeNote": "explanation of whether sample size is sufficient for reliable conclusions",
  "timeWarnings": ["array of strings about timing concerns"],
  "segmentSuggestions": ["array of segment analysis ideas"],
  "nextTests": [
    {"hypothesis": "next test idea", "rationale": "why this makes sense given these results"}
  ],
  "pitfalls": ["array of methodological warnings"],
  "summary": "2-3 sentence plain English summary a non-technical stakeholder can read and act on"
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system:
        "You are a data scientist and growth expert who specializes in statistical analysis and experimentation. You give clear, accurate, actionable analysis. Return only valid JSON with no markdown formatting.",
      messages: [{ role: "user", content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json(
        { error: "No text response from model" },
        { status: 500 },
      );
    }

    const rawText = textContent.text.trim();
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return NextResponse.json(
        { error: "Could not parse model response" },
        { status: 500 },
      );
    }

    const parsed: unknown = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    return NextResponse.json({ data: parsed }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
