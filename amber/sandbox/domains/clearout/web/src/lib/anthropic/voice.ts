import Anthropic from "@anthropic-ai/sdk"
import type { TriageQueueItem } from "@/types/database"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface VoiceCommand {
  intent:
    | "next"
    | "skip"
    | "archive"
    | "snooze"
    | "draft_reply"
    | "done"
    | "read_summary"
    | "more_detail"
    | "change_tone"
    | "approve_draft"
    | "discard_draft"
    | "filter"
    | "stop"
    | "unknown"
  parameters?: {
    tone?: string
    filter?: string
    snooze_duration?: string
    instruction?: string
  }
  raw_transcript: string
}

const VOICE_COMMAND_PROMPT = `You are parsing voice commands for ClearOut, an AI communication assistant.

The user is clearing through their messages by voice. Parse their spoken command into a structured intent.

Available intents:
- "next": move to next message
- "skip": skip this message (keep as unread)
- "archive": archive/dismiss this message
- "snooze": snooze this message (may include duration like "snooze until tomorrow")
- "draft_reply": generate a reply draft (may include instruction like "keep it brief" or "sound more formal")
- "done": mark as done/resolved
- "read_summary": read the summary aloud again
- "more_detail": get more detail about this message
- "change_tone": change the tone of the draft (may include target tone)
- "approve_draft": approve and send the current draft
- "discard_draft": discard the current draft
- "filter": change what messages to show (e.g., "only show emails from my team")
- "stop": stop the voice session
- "unknown": command not recognized

Respond with JSON only: { "intent": "...", "parameters": {...} }`

export async function parseVoiceCommand(transcript: string): Promise<VoiceCommand> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: VOICE_COMMAND_PROMPT,
    messages: [
      {
        role: "user",
        content: `Voice command: "${transcript}"`,
      },
    ],
  })

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}"

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    return {
      intent: parsed.intent ?? "unknown",
      parameters: parsed.parameters ?? {},
      raw_transcript: transcript,
    }
  } catch {
    return {
      intent: "unknown",
      raw_transcript: transcript,
    }
  }
}

export async function generateVoiceReadout(thread: TriageQueueItem, mode: "brief" | "full" = "brief"): Promise<string> {
  const urgencyLabel = thread.urgency_score >= 75 ? "urgent" : thread.urgency_score >= 50 ? "important" : "low priority"
  const fromLabel = thread.latest_from ?? "unknown sender"
  const subject = thread.subject ?? "(no subject)"

  if (mode === "brief") {
    const actionPhrase = thread.action_required
      ? `, needs a ${thread.action_type ?? "response"}`
      : ""

    return `${urgencyLabel.charAt(0).toUpperCase() + urgencyLabel.slice(1)} message from ${fromLabel}: "${subject}"${actionPhrase}. ${thread.summary ?? ""}`
  }

  // Full mode - use AI to create a natural spoken summary
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: "Convert this message summary into a natural, concise spoken announcement for a voice assistant. Keep it under 3 sentences. Sound calm and helpful. Don't say 'based on the data' or anything robotic.",
    messages: [
      {
        role: "user",
        content: `Message: Subject: "${subject}", From: ${fromLabel}, Urgency: ${thread.urgency_score}/100, Summary: ${thread.summary ?? ""}, Action needed: ${thread.action_type ?? "none"}`,
      },
    ],
  })

  return response.content[0].type === "text" ? response.content[0].text : ""
}

export async function generateDailyBriefingNarrative(briefing: {
  urgent_count: number
  action_required_count: number
  unread_count: number
  top_urgent: Array<{ subject: string | null; urgency: number; from: string | null }>
}): Promise<string> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: "You are reading a communication briefing to someone starting their day. Be concise, calm, and helpful. Sound like a smart assistant giving a morning update. Under 5 sentences total.",
    messages: [
      {
        role: "user",
        content: `Morning briefing data: ${briefing.urgent_count} urgent messages, ${briefing.action_required_count} requiring action, ${briefing.unread_count} total unread. Top items: ${briefing.top_urgent.map(u => `"${u.subject ?? "no subject"}" from ${u.from ?? "unknown"} (urgency ${u.urgency})`).join(", ")}`,
      },
    ],
  })

  return response.content[0].type === "text" ? response.content[0].text : "You have messages waiting for your review."
}
