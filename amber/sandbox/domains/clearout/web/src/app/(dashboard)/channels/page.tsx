import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ChannelsView } from "@/components/channels/ChannelsView"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Channels",
}

export const dynamic = "force-dynamic"

export default async function ChannelsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: channels } = await (supabase as any)
    .from("channels")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at")

  return (
    <Suspense fallback={null}>
      <ChannelsView
        channels={channels ?? []}
        userId={user.id}
      />
    </Suspense>
  )
}
