import Anthropic from "@anthropic-ai/sdk"
import type { DraftTone } from "@/types/messages"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

interface DraftContext {
  subject?: string | null
  thread_messages: Array<{
    from_name?: string | null
    from_email?: string | null
    body_text?: string | null
    received_at?: string | null
    is_outbound: boolean
  }>
  recipient_name?: string | null
  recipient_email?: string | null
  relationship_type?: string
  user_name?: string
  user_email?: string
  tone_profile?: {
    default_formality?: string
    uses_emoji?: boolean
    greeting_style?: string
    sign_off_style?: string
    avg_message_length?: string
    directness?: string
  }
  requested_tone?: DraftTone
  instruction?: string // custom instruction from user
  voice_instruction?: string // from voice mode
}

export async function generateDraft(context: DraftContext): Promise<{
  content: string
  tone: DraftTone
  reasoning: string
}> {
  const {
    subject,
    thread_messages,
    recipient_name,
    relationship_type = "unknown",
    user_name,
    requested_tone = "balanced",
    tone_profile,
    instruction,
    voice_instruction,
  } = context

  const threadHistory = thread_messages
    .slice(-10) // last 10 messages for context
    .map(m => {
      const sender = m.is_outbound ? (user_name ?? "Me") : (m.from_name ?? m.from_email ?? "Them")
      const body = (m.body_text ?? "").substring(0, 800)
      return `[${sender}]: ${body}`
    })
    .join("\n\n---\n\n")

  const toneInstructions = buildToneInstructions(requested_tone, tone_profile, relationship_type)
  const customInstructions = instruction ? `\n\nSpecial instruction: "${instruction}"` : ""
  const voiceInstructions = voice_instruction ? `\n\nVoice instruction from user: "${voice_instruction}"` : ""

  const systemPrompt = `You are ClearOut's drafting engine. Your job is to write reply drafts that sound exactly like the user - not like a generic AI assistant.

${toneInstructions}

Key rules:
1. Sound authentic and human - no corporate speak, no AI-isms
2. Match the register appropriate for this relationship (${relationship_type})
3. Be appropriately brief unless the situation calls for length
4. Preserve the user's voice based on their tone profile
5. Address the specific content of the message being replied to
6. Do NOT include subject lines in email body
7. Do NOT include "Subject: ..." at the top

Respond with JSON: { "draft": "...", "reasoning": "one sentence why this tone/approach" }`

  const userPrompt = `Thread subject: ${subject ?? "(no subject)"}
Recipient: ${recipient_name ?? "them"} (relationship: ${relationship_type})
Requested tone: ${requested_tone}${customInstructions}${voiceInstructions}

Conversation history (most recent last):
${threadHistory}

Write a reply draft now.`

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}"

  let content = ""
  let reasoning = ""

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      content = parsed.draft ?? ""
      reasoning = parsed.reasoning ?? ""
    } else {
      content = raw
    }
  } catch {
    content = raw
  }

  return {
    content: content.trim(),
    tone: requested_tone,
    reasoning: reasoning.trim(),
  }
}

function buildToneInstructions(
  tone: DraftTone,
  toneProfile?: DraftContext["tone_profile"],
  relationship?: string
): string {
  const profile = toneProfile ?? {}
  const greeting = profile.greeting_style ?? "Hi"
  const signOff = profile.sign_off_style ?? "Thanks"
  const usesEmoji = profile.uses_emoji ?? false
  const length = profile.avg_message_length ?? "medium"
  const directness = profile.directness ?? "moderate"

  const toneMap: Record<DraftTone, string> = {
    formal: "Be professional, formal, and structured. Use complete sentences and proper grammar.",
    casual: "Be casual and conversational. Contractions are fine. Match how the user naturally texts.",
    warm: "Be warm, genuine, and personal. Show care. Use the recipient's name.",
    brief: "Be extremely concise. No fluff. Get to the point in 1-3 sentences max.",
    detailed: "Be thorough. Address all points. Provide context and clarity.",
    empathetic: "Lead with empathy. Acknowledge feelings first. Be supportive.",
    assertive: "Be direct and confident. State what you need clearly. Avoid hedging.",
    balanced: `Use a balanced, natural tone appropriate for ${relationship ?? "this relationship"}.`,
  }

  return `Tone profile for this user:
- Typical greeting: "${greeting}"
- Typical sign-off: "${signOff}"
- Emoji usage: ${usesEmoji ? "yes, uses emoji occasionally" : "no emoji"}
- Message length preference: ${length}
- Directness level: ${directness}
- Requested tone: ${tone} - ${toneMap[tone]}`
}
