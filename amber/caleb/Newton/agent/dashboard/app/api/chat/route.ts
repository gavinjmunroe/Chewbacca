import { NextRequest, NextResponse } from "next/server";
import { sbGet } from "@/lib/supabase";
import { CONTEXT_REPO, ghGet } from "@/lib/github";

/**
 * Dashboard chat with Amber.
 *
 * DESIGN PRINCIPLE: The dashboard should never duplicate the agent's logic.
 * When the agent's prompts, health framework, or capabilities change,
 * the dashboard should inherit those changes automatically.
 *
 * Currently: loads context from the same Supabase tables + GitHub repo
 * as the agent, and uses the same system prompt structure.
 *
 * TODO: When the agent's lib/ modules support direct import from the
 * dashboard (shared package or monorepo setup), replace this with
 * imports from lib/prompts.js, lib/health.js, lib/context.js.
 * For now, we load the same data and construct a compatible prompt.
 */

async function loadContext(): Promise<string> {
  const contextFiles = [
    ".claude/context/CALEB.md",
    ".claude/context/NOW.md",
    ".claude/context/PEOPLE.md",
    ".claude/context/SYSTEM.md",
    ".claude/context/STACK.md",
  ];

  const results = await Promise.all(
    contextFiles.map(async (fileKey) => {
      try {
        const row = await sbGet<{ content: string }>(
          "context_files",
          `file_key=eq.${encodeURIComponent(fileKey)}`,
        );
        if (row?.content) return `\n\n# ${fileKey}\n\n${row.content}`;
      } catch {}
      try {
        const r = await ghGet(CONTEXT_REPO, fileKey);
        if (r) return `\n\n# ${fileKey}\n\n${r.content}`;
      } catch {}
      return "";
    }),
  );

  return results.join("").slice(0, 60000);
}

async function loadHealthBlock(): Promise<string> {
  const handle = process.env.CALEB_PHONE || "+15550100002";
  try {
    const profile = await sbGet<Record<string, number | string | null>>(
      "health_profiles",
      `handle=eq.${encodeURIComponent(handle)}`,
    );
    if (!profile) return "";
    const dims = [
      "social",
      "financial",
      "intellectual",
      "spiritual",
      "physical",
      "emotional",
    ];
    const scores = dims
      .filter((d) => profile[d] !== null)
      .map((d) => `${d}: ${profile[d]}/10`)
      .join(", ");
    if (!scores) return "";
    return `\n\nCALEB'S HEALTH (6 dimensions): ${scores}. Overall: ${profile.overall_score}/10. Lowest: ${profile.lowest_dimension}. Highest: ${profile.highest_dimension}.`;
  } catch {
    return "";
  }
}

// This prompt mirrors the agent's buildSystemPromptForSender (Caleb DM mode)
// Source of truth: lib/prompts.js in the agent codebase
function buildSystemPrompt(context: string, healthBlock: string): string {
  return `You are Amber, Caleb Newton's personal AI. You are speaking through the Amber dashboard (web interface). This is the same Amber that lives in Caleb's iMessage. Same personality, same knowledge, same warmth.

FULL CONTEXT ABOUT CALEB AND HIS WORLD:
${context}
${healthBlock}

---

IDENTITY:
- You are Amber: warm, wise, spiritually grounded in traditional Christian faith, emotionally intelligent, and tactically sharp.
- Motherly and nurturing but also direct.
- Good sense of humor, keep things casual and conversational.

THE 6 DIMENSIONS OF HEALTH (your core framework):
Masculine: Social, Financial, Intellectual
Feminine: Spiritual, Physical, Emotional
Each scored 0-10. These are the ONLY 6. Never guess other dimensions.

HOW TO USE THE HEALTH LENS:
- Every person has a health profile across these 6 dimensions
- When someone mentions their job, that's financial. Friends or loneliness, social. God or purpose, spiritual.
- Sleep or exercise, physical. Frustration or joy, emotional. Learning or ideas, intellectual.
- You don't announce tracking. You listen, calibrate, and respond with the right energy.

CRITICAL LOOKUP PROTOCOL:
1. Check your context first. If a name appears in your context, they are NOT a stranger.
2. Lead with context knowledge for known people. Never list random web results for someone you know.

RESPONSE STYLE:
- Concise and conversational. Not a report.
- Faith-informed when relevant, never preachy.
- Never use em dashes. Use commas or new sentences.
- Never end with filler. Just stop when you're done.
- Never fabricate facts. If unsure, say so directly.`;
}

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message required." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured. Set ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    const [context, healthBlock] = await Promise.all([
      loadContext(),
      loadHealthBlock(),
    ]);

    const messages = [
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: buildSystemPrompt(context, healthBlock),
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[chat] Anthropic error:", errText);
      return NextResponse.json({ error: "AI error." }, { status: 502 });
    }

    const data = await res.json();
    const reply = data.content
      ?.filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ reply: reply || "..." });
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
