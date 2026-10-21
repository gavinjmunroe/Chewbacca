import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface EnergyRecommendation {
  action: string;
  savings: number;
  difficulty: "Easy" | "Medium" | "Hard";
  roi: string;
}

interface ApplianceBreakdown {
  appliance: string;
  estimatedKwh: number;
  estimatedCost: number;
  percentage: number;
}

interface EnergyAnalysis {
  efficiencyScore: number;
  estimatedWaste: number;
  recommendations: EnergyRecommendation[];
  breakdown: ApplianceBreakdown[];
  summary: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    billText: string;
    monthlyKwh?: number;
    rate?: number;
  };
  const { billText, monthlyKwh, rate } = body;

  const prompt = `You are an expert energy efficiency analyst. Analyze this electricity/gas bill and return a JSON analysis. Return ONLY the JSON object, no markdown, no explanation.

Bill text:
${billText}
${monthlyKwh ? `Monthly kWh usage: ${monthlyKwh}` : ""}
${rate ? `Rate per kWh: $${rate}` : ""}

Return this exact JSON structure:
{
  "efficiencyScore": 0-100,
  "estimatedWaste": 0,
  "recommendations": [
    { "action": "description", "savings": 0, "difficulty": "Easy" | "Medium" | "Hard", "roi": "X months" }
  ],
  "breakdown": [
    { "appliance": "name", "estimatedKwh": 0, "estimatedCost": 0, "percentage": 0 }
  ],
  "summary": "two-sentence summary of the energy profile"
}

efficiencyScore: 80+ = efficient, 50-80 = average, under 50 = wasteful. estimatedWaste is the dollar amount being wasted monthly on inefficiencies.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const analysis = JSON.parse(text) as EnergyAnalysis;
    return NextResponse.json(analysis);
  } catch {
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
