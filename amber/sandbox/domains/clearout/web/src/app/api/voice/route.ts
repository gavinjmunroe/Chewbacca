import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseVoiceCommand, generateVoiceReadout, generateDailyBriefingNarrative } from "@/lib/anthropic/voice"
import { z } from "zod"

const CommandSchema = z.object({
  transcript: z.string().min(1).max(1000),
  current_thread_id: z.string().uuid().optional(),
  mode: z.enum(["clearing", "briefing", "dictation"]).optional().default("clearing"),
})

const ReadoutSchema = z.object({
  thread_id: z.string().uuid(),
  mode: z.enum(["brief", "full"]).optional().default("brief"),
})

// POST /api/voice - parse voice command
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")

  const body = await request.json()

  if (action === "readout") {
    const parsed = ReadoutSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const { thread_id, mode } = parsed.data

    // Fetch thread from triage queue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: threads } = (await (supabase as any).rpc("get_triage_queue", {
      p_user_id: user.id,
      p_limit: 1,
      p_status: "all",
    })) as { data: import("@/types/database").TriageQueueItem[] | null }

    const thread = threads?.find(t => t.id === thread_id)
    if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    const text = await generateVoiceReadout(thread, mode)
    return NextResponse.json({ text })
  }

  if (action === "briefing") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: briefingData } = (await (supabase as any).rpc("get_daily_briefing", {
      p_user_id: user.id,
    })) as { data: import("@/types/database").Json | null }

    const text = await generateDailyBriefingNarrative({
      urgent_count: (briefingData as Record<string, number>)?.urgent_count ?? 0,
      action_required_count: (briefingData as Record<string, number>)?.action_required_count ?? 0,
      unread_count: (briefingData as Record<string, number>)?.unread_count ?? 0,
      top_urgent: (briefingData as Record<string, Array<{ subject: string | null; urgency: number; from: string | null }>>)?.top_urgent ?? [],
    })
    return NextResponse.json({ text })
  }

  // Default: parse command
  const parsed = CommandSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const command = await parseVoiceCommand(parsed.data.transcript)
  return NextResponse.json({ command })
}
