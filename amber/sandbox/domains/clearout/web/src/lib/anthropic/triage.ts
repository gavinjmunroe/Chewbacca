import Anthropic from "@anthropic-ai/sdk"
import type { TriageResponse, Sentiment, ActionType } from "@/types/messages"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

interface TriageInput {
  subject?: string | null
  from_name?: string | null
  from_email?: string | null
  body_text?: string | null
  participants?: Array<{ name?: string; email?: string }>
  relationship_type?: string
  importance_score?: number
  channel_type?: string
  thread_age_hours?: number
  prior_messages_count?: number
}

const TRIAGE_SYSTEM_PROMPT = `You are ClearOut's triage intelligence engine. Your job is to analyze incoming messages and conversations to help users understand what deserves their attention.

For each message thread, you will assess:
1. URGENCY (0-100): How time-sensitive is this? 80+ = needs immediate attention, 50-79 = reply today, 20-49 = can wait a day or two, 0-19 = can wait or ignore
2. IMPORTANCE (0-100): How significant is this to the person's life, work, or relationships? Based on sender relationship, stakes, and context.
3. SENTIMENT: overall emotional tone (positive, neutral, negative, urgent, emotional)
4. ACTION_REQUIRED: does this require a specific action? (true/false)
5. ACTION_TYPE: if action required, what kind? (reply, decide, schedule, file, escalate, ignore)
6. SUMMARY: 1-2 sentence plain-language summary of what this message is about
7. TRIAGE_REASON: brief explanation of why you scored it this way (1 sentence)
8. TRIAGE_TAGS: 1-3 short labels (e.g., "investor", "deadline", "family", "intro", "newsletter", "urgent-reply")

Be calibrated. Not everything is urgent. Most things are not. But genuinely important things - from close relationships, with real deadlines, requiring real decisions - should score high.

Always respond with valid JSON only.`

export async function triageThread(input: TriageInput, threadId: string): Promise<TriageResponse> {
  const messageContext = `
Subject: ${input.subject ?? "(no subject)"}
From: ${input.from_name ?? ""} <${input.from_email ?? "unknown"}>
Channel: ${input.channel_type ?? "email"}
Relationship: ${input.relationship_type ?? "unknown"} (importance: ${input.importance_score ?? 50}/100)
Messages in thread: ${input.prior_messages_count ?? 1}
Thread age: ${input.thread_age_hours ?? 0} hours

Message content (first 2000 chars):
${(input.body_text ?? "").substring(0, 2000)}
`.trim()

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: TRIAGE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Triage this message thread:\n\n${messageContext}\n\nRespond with JSON only.`,
      },
    ],
  })

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}"

  let parsed: Partial<TriageResponse> = {}
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch {
    // fallback to defaults
  }

  return {
    thread_id: threadId,
    urgency_score: clamp(parsed.urgency_score ?? 25, 0, 100),
    importance_score: clamp(parsed.importance_score ?? 30, 0, 100),
    sentiment: (parsed.sentiment as Sentiment) ?? "neutral",
    action_required: parsed.action_required ?? false,
    action_type: (parsed.action_type as ActionType | null) ?? null,
    summary: parsed.summary ?? "No summary available.",
    triage_reason: parsed.triage_reason ?? "Default triage applied.",
    triage_tags: parsed.triage_tags ?? [],
  }
}

export async function triageBatch(items: Array<{ input: TriageInput; threadId: string }>): Promise<TriageResponse[]> {
  // Process in parallel with concurrency limit
  const CONCURRENCY = 5
  const results: TriageResponse[] = []

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(item => triageThread(item.input, item.threadId))
    )
    results.push(...batchResults)
  }

  return results
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}
