import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { triageThread, triageBatch } from "@/lib/anthropic/triage"
import { z } from "zod"

const TriageSingleSchema = z.object({
  thread_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
})

const TriageBatchSchema = z.object({
  thread_ids: z.array(z.string().uuid()).max(20),
})

// POST /api/triage - triage a single thread
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = TriageSingleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { thread_id, force } = parsed.data

  // Fetch thread + messages
  const { data: thread } = await (supabase as any)
    .from("threads")
    .select("*, channels(type)")
    .eq("id", thread_id)
    .eq("user_id", user.id)
    .single()

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  // Skip if already triaged unless forced
  if (thread.urgency_score > 0 && !force) {
    return NextResponse.json({
      thread_id,
      urgency_score: thread.urgency_score,
      importance_score: thread.importance_score,
      sentiment: thread.sentiment,
      action_required: thread.action_required,
      action_type: thread.action_type,
      summary: thread.summary,
      triage_reason: thread.triage_reason,
      triage_tags: thread.triage_tags,
      cached: true,
    })
  }

  type MsgRow = { from_name: string | null; from_email: string | null; body_text: string | null; received_at: string | null }
  const { data: messagesRaw } = await (supabase as any)
    .from("messages")
    .select("from_name, from_email, body_text, received_at")
    .eq("thread_id", thread_id)
    .order("received_at", { ascending: true })
    .limit(5)
  const messages = messagesRaw as MsgRow[] | null

  const latestMessage = messages?.[messages.length - 1]
  const firstMessage = messages?.[0]

  const result = await triageThread({
    subject: thread.subject,
    from_name: firstMessage?.from_name,
    from_email: firstMessage?.from_email,
    body_text: latestMessage?.body_text,
    channel_type: (thread.channels as { type: string })?.type,
    prior_messages_count: thread.message_count,
    thread_age_hours: thread.last_message_at
      ? (Date.now() - new Date(thread.last_message_at).getTime()) / (1000 * 60 * 60)
      : 0,
  }, thread_id)

  // Update thread with triage results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("threads")
    .update({
      urgency_score: result.urgency_score,
      importance_score: result.importance_score,
      sentiment: result.sentiment,
      action_required: result.action_required,
      action_type: result.action_type,
      triage_reason: result.triage_reason,
      triage_tags: result.triage_tags,
      summary: result.summary,
    })
    .eq("id", thread_id)

  return NextResponse.json({ ...result, cached: false })
}

// POST /api/triage/batch - triage multiple threads
export async function PUT(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = TriageBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { thread_ids } = parsed.data

  // Fetch all threads
  const { data: threads } = await (supabase as any)
    .from("threads")
    .select("*, channels(type)")
    .in("id", thread_ids)
    .eq("user_id", user.id)

  if (!threads?.length) return NextResponse.json({ results: [] })

  const items = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (threads as any[]).map(async (thread: any) => {
      const { data: msgRaw } = await (supabase as any)
        .from("messages")
        .select("from_name, from_email, body_text, received_at")
        .eq("thread_id", thread.id)
        .order("received_at", { ascending: false })
        .limit(1)
      const msgs = msgRaw as Array<{ from_name: string | null; from_email: string | null; body_text: string | null; received_at: string | null }> | null

      return {
        threadId: thread.id,
        input: {
          subject: thread.subject,
          from_email: msgs?.[0]?.from_email,
          from_name: msgs?.[0]?.from_name,
          body_text: msgs?.[0]?.body_text,
          channel_type: (thread.channels as { type: string })?.type,
          prior_messages_count: thread.message_count,
        },
      }
    })
  )

  const results = await triageBatch(items)

  // Bulk update threads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  for (const result of results) {
    await sb
      .from("threads")
      .update({
        urgency_score: result.urgency_score,
        importance_score: result.importance_score,
        sentiment: result.sentiment,
        action_required: result.action_required,
        action_type: result.action_type,
        triage_reason: result.triage_reason,
        triage_tags: result.triage_tags,
        summary: result.summary,
      })
      .eq("id", result.thread_id)
  }

  return NextResponse.json({ results })
}
