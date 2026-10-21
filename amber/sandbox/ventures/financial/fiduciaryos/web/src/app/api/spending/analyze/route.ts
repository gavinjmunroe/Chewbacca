import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface SpendingCategory {
  name: string;
  amount: number;
  percentage: number;
  insight: string;
}

interface SpendingAnalysis {
  score: number;
  grade: string;
  categories: SpendingCategory[];
  topInsights: string[];
  actionPlan: string[];
  savingsOpportunity: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { transactions: string };
  const { transactions } = body;

  const prompt = `You are an expert personal finance analyst. Analyze these transactions and return a JSON spending analysis. Return ONLY the JSON object, no markdown, no explanation.

Transactions:
${transactions}

Return this exact JSON structure:
{
  "score": 0-100,
  "grade": "A" | "B" | "C" | "D" | "F",
  "categories": [
    { "name": "category name", "amount": 0, "percentage": 0, "insight": "one-sentence insight" }
  ],
  "topInsights": ["insight 1", "insight 2", "insight 3"],
  "actionPlan": ["action 1", "action 2", "action 3"],
  "savingsOpportunity": 0
}

Score rules: 70+ is A/B (healthy spending), 40-70 is C/D (needs work), under 40 is F (concerning). Grade matches score.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const analysis = JSON.parse(text) as SpendingAnalysis;
    return NextResponse.json(analysis);
  } catch {
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
