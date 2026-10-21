import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { syncGmailChannel } from "@/lib/gmail/sync"
import { z } from "zod"

const SyncRequestSchema = z.object({
  channel_id: z.string().uuid(),
})

// POST /api/messages/sync - trigger a sync for a specific channel
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = SyncRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { channel_id } = parsed.data

  // Fetch channel and verify ownership
  const { data: channel } = await (supabase as any)
    .from("channels")
    .select("*")
    .eq("id", channel_id)
    .eq("user_id", user.id)
    .single()

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  }

  if (channel.sync_status === "syncing") {
    return NextResponse.json({ message: "Sync already in progress" })
  }

  if (!channel.access_token) {
    return NextResponse.json({ error: "Channel not authenticated" }, { status: 400 })
  }

  try {
    let result: { threadsProcessed: number; messagesProcessed: number; newCursor: string | null; errors: string[] }

    if (channel.type === "gmail") {
      result = await syncGmailChannel(
        supabase as any,
        channel.id,
        user.id,
        channel.access_token,
        channel.refresh_token ?? "",
        channel.sync_cursor
      )
    } else {
      return NextResponse.json({ error: "Sync not yet supported for this channel type" }, { status: 400 })
    }

    // Log the sync action
    await (supabase as any).from("action_log").insert({
      user_id: user.id,
      action_type: "channel_sync",
      action_data: {
        channel_id: channel.id,
        type: channel.type,
        threads: result.threadsProcessed,
        messages: result.messagesProcessed,
      },
      result: result.errors.length > 0 ? "failed" : "success",
      error: result.errors.length > 0 ? result.errors.join("; ") : null,
      approved_by: "auto_policy",
    })

    return NextResponse.json({
      success: true,
      threads_synced: result.threadsProcessed,
      messages_synced: result.messagesProcessed,
      errors: result.errors,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
