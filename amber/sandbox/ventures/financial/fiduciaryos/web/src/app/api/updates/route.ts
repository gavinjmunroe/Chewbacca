import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface GenerateRequestBody {
  companyName: string;
  period: string;
  mrr: string;
  mrrGrowth: string;
  userCount: string;
  wins: string;
  challenge: string;
  asks: string;
  goals: string;
}

function isGenerateRequestBody(value: unknown): value is GenerateRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.companyName === "string" &&
    typeof obj.period === "string" &&
    typeof obj.mrr === "string" &&
    typeof obj.mrrGrowth === "string" &&
    typeof obj.userCount === "string" &&
    typeof obj.wins === "string" &&
    typeof obj.challenge === "string" &&
    typeof obj.asks === "string" &&
    typeof obj.goals === "string"
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();

    if (!isGenerateRequestBody(body)) {
      return NextResponse.json(
        { error: "Invalid request body. All fields are required." },
        { status: 400 },
      );
    }

    const {
      companyName,
      period,
      mrr,
      mrrGrowth,
      userCount,
      wins,
      challenge,
      asks,
      goals,
    } = body;

    const prompt = `You are writing an investor update email for ${companyName}.

Period: ${period}
MRR: ${mrr ? `$${mrr}` : "not provided"}
MRR Growth: ${mrrGrowth ? `${mrrGrowth}% MoM` : "not provided"}
User Count: ${userCount || "not provided"}
Top Wins:
${wins}

Main Challenge:
${challenge}

Asks from Investors:
${asks}

Next Period Goals:
${goals}

Write a professional investor update email. The tone should be direct, honest, and confident. Investors respect founders who share both wins AND challenges with equal clarity.

Return a JSON object with EXACTLY this structure (no markdown fencing, pure JSON):
{
  "subject": "crisp subject line under 60 characters, no fluff",
  "email": {
    "greeting": "opening line addressing investors",
    "tldr": "one sentence summary of where the company stands right now",
    "metrics": "metrics section formatted for email: MRR: $X (+Y% MoM), Active Users: Z, etc. Only include metrics that were provided. If MRR was not provided, skip it.",
    "wins": "wins section with 2-3 punchy bullets. Start each with a verb. No filler.",
    "challenges": "honest challenge section with 1-2 bullets. Be direct. Name the real problem.",
    "asks": "specific, actionable asks from investors. Number them if there are multiple.",
    "outlook": "next period goals section. Concrete, numbered, measurable.",
    "closing": "one-sentence closing line. Warm but brief."
  },
  "fullEmail": "the complete formatted email as a single string with proper line breaks using \\n",
  "toneNotes": "2-3 sentences explaining specific tone choices made in this email and why they build investor trust",
  "whatToIncludeNext": ["specific missing metric or datapoint investors typically want to see", "specific narrative or story that would strengthen credibility"]
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system:
        "You are a YC partner and startup advisor who has read thousands of investor updates. You write updates that are transparent, build investor confidence, and make asks feel natural. You always return pure JSON with no markdown fencing.",
      messages: [{ role: "user", content: prompt }],
    });

    const rawContent = message.content[0];
    if (rawContent.type !== "text") {
      return NextResponse.json(
        { error: "Unexpected response format from AI." },
        { status: 500 },
      );
    }

    let parsed: unknown;
    try {
      const text = rawContent.text.trim();
      const jsonText = text.startsWith("{")
        ? text
        : text.slice(text.indexOf("{"));
      parsed = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response as JSON." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: parsed }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
