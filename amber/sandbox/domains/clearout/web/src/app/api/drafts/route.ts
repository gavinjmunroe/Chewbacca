import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateDraft } from "@/lib/anthropic/draft"
import { z } from "zod"

const GenerateDraftSchema = z.object({
  thread_id: z.string().uuid(),
  tone: z.enum(["formal", "casual", "warm", "brief", "detailed", "empathetic", "assertive", "balanced"]).optional(),
  instruction: z.string().max(500).optional(),
  voice_instruction: z.string().max(500).optional(),
})

const UpdateDraftSchema = z.object({
  draft_id: z.string().uuid(),
  status: z.enum(["approved", "edited", "discarded"]).optional(),
  edited_content: z.string().optional(),
})

// POST /api/drafts - generate a new draft
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = GenerateDraftSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { thread_id, tone = "balanced", instruction, voice_instruction } = parsed.data

  // Fetch thread
  const { data: thread } = await (supabase as any)
    .from("threads")
    .select("*")
    .eq("id", thread_id)
    .eq("user_id", user.id)
    .single()

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  // Fetch messages (last 10)
  type DraftMsgRow = { from_name: string | null; from_email: string | null; body_text: string | null; received_at: string | null; is_outbound: boolean }
  const { data: messagesRaw } = await (supabase as any)
    .from("messages")
    .select("from_name, from_email, body_text, received_at, is_outbound")
    .eq("thread_id", thread_id)
    .order("received_at", { ascending: true })
    .limit(10)
  const messages = messagesRaw as DraftMsgRow[] | null

  // Fetch user memory for tone profile
  const { data: memoryRaw } = await (supabase as any)
    .from("user_memory")
    .select("tone_profile")
    .eq("user_id", user.id)
    .single()
  const memory = memoryRaw as { tone_profile: unknown } | null

  const { data: profileRaw } = await (supabase as any)
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single()
  const profile = profileRaw as { full_name: string | null; email: string | null } | null

  // Get recipient info from participants
  const participants = thread.participants as Array<{ name?: string; email?: string; role?: string }>
  const recipient = participants.find(p => p.email !== profile?.email) ?? participants[0]

  const start = Date.now()

  const result = await generateDraft({
    subject: thread.subject,
    thread_messages: messages?.map(m => ({
      from_name: m.from_name,
      from_email: m.from_email,
      body_text: m.body_text,
      received_at: m.received_at,
      is_outbound: m.is_outbound,
    })) ?? [],
    recipient_name: recipient?.name,
    recipient_email: recipient?.email,
    user_name: profile?.full_name ?? undefined,
    user_email: profile?.email ?? undefined,
    requested_tone: tone,
    tone_profile: memory?.tone_profile as Record<string, unknown> ?? undefined,
    instruction,
    voice_instruction,
  })

  const elapsed = Date.now() - start

  // Save draft to database
  const { data: draft, error } = await (supabase as any)
    .from("drafts")
    .insert({
      thread_id,
      user_id: user.id,
      content: result.content,
      tone: result.tone,
      context_used: {
        tone_profile: memory?.tone_profile,
        instruction,
        voice_instruction,
        reasoning: result.reasoning,
      },
      model: "claude-sonnet-4-6",
      prompt_version: "1.0",
      generation_time_ms: elapsed,
      status: "pending",
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log draft generation
  await (supabase as any).from("action_log").insert({
    user_id: user.id,
    thread_id,
    draft_id: draft.id,
    action_type: "draft_generated",
    action_data: { tone, elapsed_ms: elapsed },
    result: "success",
    approved_by: "auto_policy",
  })

  return NextResponse.json({
    draft_id: draft.id,
    content: result.content,
    tone: result.tone,
    reasoning: result.reasoning,
  })
}

// PATCH /api/drafts - update draft status
export async function PATCH(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = UpdateDraftSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { draft_id, status, edited_content } = parsed.data

  const update: Record<string, unknown> = {}
  if (status) update.status = status
  if (edited_content !== undefined) {
    update.edited_content = edited_content
    update.status = "edited"
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: draft, error } = await (supabase as any)
    .from("drafts")
    .update(update)
    .eq("id", draft_id)
    .eq("user_id", user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Increment memory stats
  if (status === "approved" || status === "discarded") {
    const { data: memRaw } = await (supabase as any)
      .from("user_memory")
      .select("total_approvals, total_discards, total_edits")
      .eq("user_id", user.id)
      .single()
    const mem = memRaw as { total_approvals: number; total_discards: number; total_edits: number } | null

    if (mem) {
      const update =
        status === "approved"
          ? { total_approvals: (mem.total_approvals ?? 0) + 1 }
          : { total_discards: (mem.total_discards ?? 0) + 1 }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("user_memory").update(update).eq("user_id", user.id)
    }
  }

  return NextResponse.json({ draft })
}
