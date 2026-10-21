import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"

const ActionSchema = z.object({
  thread_id: z.string().uuid(),
  action: z.enum(["archive", "snooze", "mark_read", "done", "label", "create_task"]),
  action_data: z.record(z.unknown()).optional().default({}),
  approved_by: z.enum(["user", "auto_policy", "voice"]).optional().default("user"),
})

const BulkActionSchema = z.object({
  thread_ids: z.array(z.string().uuid()).max(50),
  action: z.enum(["archive", "mark_read", "done"]),
})

// POST /api/actions - perform an action on a thread
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { thread_id, action, action_data, approved_by } = parsed.data

  // Verify ownership
  const { data: threadRaw } = await (supabase as any)
    .from("threads")
    .select("id, status, channel_id")
    .eq("id", thread_id)
    .eq("user_id", user.id)
    .single()
  const thread = threadRaw as { id: string; status: string; channel_id: string } | null

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  let newStatus: string = thread.status

  switch (action) {
    case "archive":
      newStatus = "archived"
      break
    case "done":
      newStatus = "done"
      break
    case "mark_read":
      newStatus = "read"
      break
    case "snooze":
      newStatus = "snoozed"
      break
    case "label":
    case "create_task":
      // No status change, just log
      break
  }

  if (action === "snooze") {
    const snoozeUntil = (action_data as Record<string, string>)?.until
    if (!snoozeUntil) {
      return NextResponse.json({ error: "snooze requires 'until' date" }, { status: 400 })
    }

    await (supabase as any)
      .from("threads")
      .update({ status: "snoozed", snoozed_until: snoozeUntil })
      .eq("id", thread_id)
  } else if (newStatus !== thread.status) {
    await (supabase as any)
      .from("threads")
      .update({ status: newStatus })
      .eq("id", thread_id)
  }

  if (action === "label" && (action_data as Record<string, string[]>)?.labels) {
    const labels = (action_data as Record<string, string[]>).labels
    await (supabase as any)
      .from("threads")
      .update({ labels })
      .eq("id", thread_id)
  }

  // Log action
  await (supabase as any).from("action_log").insert({
    user_id: user.id,
    thread_id,
    action_type: action,
    action_data,
    approved_by,
    result: "success",
  })

  return NextResponse.json({ success: true, new_status: newStatus })
}

// PUT /api/actions - bulk action
export async function PUT(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = BulkActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { thread_ids, action } = parsed.data

  const statusMap: Record<string, string> = {
    archive: "archived",
    mark_read: "read",
    done: "done",
  }

  const { error } = await (supabase as any)
    .from("threads")
    .update({ status: statusMap[action] })
    .in("id", thread_ids)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Bulk log
  const logEntries = thread_ids.map(tid => ({
    user_id: user.id,
    thread_id: tid,
    action_type: action,
    action_data: { bulk: true },
    approved_by: "user" as const,
    result: "success" as const,
  }))

  await (supabase as any).from("action_log").insert(logEntries)

  return NextResponse.json({ success: true, updated: thread_ids.length })
}
