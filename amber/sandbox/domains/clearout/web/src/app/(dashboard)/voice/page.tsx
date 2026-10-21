import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { VoicePage } from "@/components/voice/VoicePage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Voice Mode",
}

export const dynamic = "force-dynamic"

export default async function VoiceRoute() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [
    { data: threads },
    { data: briefing },
    { data: memoryRaw },
    { data: profileRaw },
  ] = await Promise.all([
    (sb.rpc("get_triage_queue", {
      p_user_id: user.id,
      p_limit: 20,
      p_status: "unread",
    })) as Promise<{ data: import("@/types/database").TriageQueueItem[] | null }>,
    (sb.rpc("get_daily_briefing", {
      p_user_id: user.id,
    })) as Promise<{ data: import("@/types/messages").DailyBriefing | null }>,
    supabase
      .from("user_memory")
      .select("tone_profile, communication_preferences")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single(),
  ])

  const memory = memoryRaw as { tone_profile: unknown; communication_preferences: unknown } | null
  const profile = profileRaw as { full_name: string | null } | null

  return (
    <VoicePage
      initialQueue={threads ?? []}
      briefing={briefing}
      userMemory={memory}
      userName={profile?.full_name ?? ""}
      userId={user.id}
    />
  )
}
