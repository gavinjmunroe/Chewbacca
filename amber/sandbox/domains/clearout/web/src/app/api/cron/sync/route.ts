import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { syncGmailChannel } from "@/lib/gmail/sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/cron/sync - triggered by Vercel cron every 15 minutes
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Fetch all active channels due for sync
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: channels } = await (supabase as any)
    .from("channels")
    .select("*")
    .eq("is_active", true)
    .eq("sync_status", "idle")
    .or(`last_synced_at.is.null,last_synced_at.lt.${fifteenMinutesAgo}`)
    .limit(20) // process max 20 channels per cron run

  if (!channels?.length) {
    return NextResponse.json({ message: "No channels to sync", synced: 0 })
  }

  const results: Array<{ channelId: string; status: string; error?: string }> = []

  for (const channel of channels) {
    try {
      if (channel.type === "gmail" && channel.access_token) {
        await syncGmailChannel(
          supabase as any,
          channel.id,
          channel.user_id,
          channel.access_token,
          channel.refresh_token ?? "",
          channel.sync_cursor
        )
        results.push({ channelId: channel.id, status: "synced" })
      }
    } catch (err) {
      results.push({
        channelId: channel.id,
        status: "error",
        error: String(err),
      })
    }
  }

  return NextResponse.json({
    message: "Cron sync complete",
    synced: results.filter(r => r.status === "synced").length,
    errors: results.filter(r => r.status === "error").length,
    results,
  })
}
