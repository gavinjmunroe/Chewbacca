export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/components/nav/Sidebar"
import { TopBar } from "@/components/nav/TopBar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefing } = (await (supabase as any).rpc("get_daily_briefing", {
    p_user_id: user.id,
  })) as { data: import("@/types/messages").DailyBriefing | null }

  return (
    <div className="flex h-screen bg-co-dark overflow-hidden">
      <Sidebar user={user} profile={profile} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar user={user} profile={profile} briefing={briefing} />
        <main className="flex-1 overflow-y-auto page-enter">
          {children}
        </main>
      </div>
    </div>
  )
}
