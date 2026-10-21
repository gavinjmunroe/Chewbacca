import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { ThreadView } from "@/components/inbox/ThreadView"
import type { Metadata } from "next"
import type { Database } from "@/types/database"

type ThreadRow = Database["public"]["Tables"]["threads"]["Row"]
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"]
type ThreadWithChannel = ThreadRow & { channels: ChannelRow }

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>
}): Promise<Metadata> {
  const { threadId } = await params
  const supabase = await createClient()
  const { data: thread } = await (supabase as any)
    .from("threads")
    .select("subject")
    .eq("id", threadId)
    .single()

  return {
    title: (thread as { subject: string | null } | null)?.subject ?? "Thread",
  }
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: rawThread } = await (supabase as any)
    .from("threads")
    .select(`*, channels (*)`)
    .eq("id", threadId)
    .eq("user_id", user.id)
    .single()

  const thread = rawThread as ThreadWithChannel | null
  if (!thread) notFound()

  // Server-side mark as read
  if (thread.status === "unread") {
    await (supabase as any).from("threads").update({ status: "read" }).eq("id", threadId)
  }

  const [
    { data: messages },
    { data: drafts },
    { data: memoryRaw },
    { data: profileRaw },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true }),
    supabase
      .from("drafts")
      .select("*")
      .eq("thread_id", threadId)
      .in("status", ["pending", "approved", "edited"])
      .order("created_at", { ascending: false }),
    supabase
      .from("user_memory")
      .select("tone_profile, communication_preferences")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single(),
  ])

  const memory = memoryRaw as { tone_profile: unknown; communication_preferences: unknown } | null
  const profile = profileRaw as { full_name: string | null; email: string | null } | null

  return (
    <ThreadView
      thread={thread}
      messages={messages ?? []}
      drafts={drafts ?? []}
      userMemory={memory}
      userProfile={profile}
      userId={user.id}
    />
  )
}
