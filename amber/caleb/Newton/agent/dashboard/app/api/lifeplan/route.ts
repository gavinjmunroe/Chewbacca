import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { answers } = await req.json();
    if (!Array.isArray(answers) || answers.length < 3) {
      return NextResponse.json(
        { error: "Answer all questions." },
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

    const questions = [
      "What activity makes you lose track of time?",
      "What matters more: impact or security?",
      "Describe your ideal Tuesday in 5 years.",
      "What's one thing you'd regret not trying?",
      "How do you recharge: alone or with people?",
    ];

    const prompt = questions
      .map((q, i) => `Q: ${q}\nA: ${answers[i] || "(skipped)"}`)
      .join("\n\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: `You are a life coach and career advisor analyzing someone's personality quiz answers. This person is Caleb Newton, a sophomore at USC Iovine and Young Academy studying Innovation. He's a committed Christian, half-Filipino, 2e autistic, and building multiple startups (Amber AI, Blue Modern Advisory, etc.).

QUIZ RESPONSES:
${prompt}

Analyze across the 6 dimensions of health (social, financial, intellectual, spiritual, physical, emotional) and return ONLY valid JSON:

{
  "personality": {
    "traits": ["5-7 core personality traits"],
    "strengths": ["3-4 key strengths"],
    "growth_areas": ["2-3 growth areas"],
    "mbti_estimate": "XXXX (your best guess)"
  },
  "career": {
    "current_path": "assessment of current trajectory in 1-2 sentences",
    "alignment_score": 85,
    "suggestions": ["3 specific career/project suggestions"],
    "skills_to_develop": ["2-3 skills to build"]
  },
  "life_plan": {
    "short_term": ["3 actions for next 3 months"],
    "medium_term": ["3 goals for 6-12 months"],
    "long_term": ["3 vision items for 2-5 years"],
    "theme": "one-sentence life theme"
  },
  "coaching_insight": "A personal, specific insight that connects who they are to where they're going. Make it feel like it was written just for them. 2-3 sentences."
}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[lifeplan] API error:", err);
      return NextResponse.json({ error: "AI error." }, { status: 502 });
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse response." },
        { status: 500 },
      );
    }

    const result = JSON.parse(jsonMatch[0]);

    // Save to Supabase for persistence and progress tracking
    try {
      const { sbUpsert } = await import("@/lib/supabase");
      await sbUpsert("lifeplan_results", {
        handle: process.env.CALEB_PHONE || "+15550100002",
        result,
        answers,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Non-critical, continue even if save fails
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[lifeplan]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
