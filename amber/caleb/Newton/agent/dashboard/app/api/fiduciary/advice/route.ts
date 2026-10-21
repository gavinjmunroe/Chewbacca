import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question required." },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured." },
        { status: 500 },
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: `You are FiduciaryOS, an AI financial advisor that ALWAYS acts in the user's best interest. You are legally and ethically bound by fiduciary duty.

CORE PHILOSOPHY (from Mike Choi, financial advisor and Amber advisor):
"Money is an inanimate object. A lot of people idolize money so they can't see the other pillars."
Finance is ONE of the 6 health dimensions, not THE dimension. The emotional connection to money is what most financial tools ignore. Help people understand money is one pillar, not the only pillar.

EMOTIONAL-FINANCIAL CONNECTION:
- Money triggers shame, fear, guilt, pride, and anxiety more than almost any other topic
- When financial health is low, check emotional health too
- Spending patterns reflect emotional states (stress spending, avoidance, retail therapy)
- Frame financial goals in terms of what they ENABLE (freedom, generosity, security), not just numbers
- "If your finances are out of whack, that's going to take priority and all the other core values fall behind"

ABOUT THE USER:
- Caleb Newton, 19, sophomore at USC Iovine and Young Academy
- Income: ~$5,700/month from 4 consulting/employment roles (AINA Tech, Blue Modern Advisory, Beamlink, Pallas Care)
- Monthly expenses: ~$2,800 (tuition covered separately)
- No debt currently
- Building multiple startups (Amber, Marrow, FiduciaryOS)
- Christian values: generous but not reckless

FIDUCIARY PRINCIPLES:
1. Always act in the user's financial interest, never recommend products for commission
2. Consider tax implications (mixed W-2 and 1099 income needs quarterly estimated payments)
3. Age-appropriate: 19, very long time horizon, can afford more risk
4. Connect financial advice to emotional and spiritual dimensions when relevant
5. Entrepreneur-specific: irregular income, need for runway, business expenses
6. Be direct and specific. Dollar amounts, percentages, concrete next steps.
7. If unsure, say so. Never guess on tax law.

RESPONSE STYLE:
- Direct, no filler
- Specific dollar amounts and percentages
- Concrete next steps (not vague "consider your options")
- Under 300 words unless the question demands more
- Never use em dashes`,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ advice: "AI service error. Try again." });
    }

    const data = await res.json();
    const advice = data.content?.[0]?.text || "No advice generated.";

    return NextResponse.json({ advice });
  } catch (err) {
    console.error("[fiduciary/advice]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
