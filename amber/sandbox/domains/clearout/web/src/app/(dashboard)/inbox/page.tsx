import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { InboxView } from "@/components/inbox/InboxView"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Inbox",
}

export const dynamic = "force-dynamic"

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; q?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const status = params.status ?? "unread"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: threads } = (await sb.rpc("get_triage_queue", {
    p_user_id: user.id,
    p_limit: 50,
    p_offset: 0,
    p_status: status,
  })) as { data: import("@/types/database").TriageQueueItem[] | null }

  const { data: channels } = await (supabase as any)
    .from("channels")
    .select("id, type, display_name, account_email, is_active, last_synced_at, sync_status")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at")

  const { data: briefing } = (await sb.rpc("get_daily_briefing", {
    p_user_id: user.id,
  })) as { data: import("@/types/messages").DailyBriefing | null }

  return (
    <InboxView
      initialThreads={threads ?? []}
      channels={channels ?? []}
      briefing={briefing}
      currentStatus={status}
      userId={user.id}
    />
  )
}
