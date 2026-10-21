import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SettingsView } from "@/components/settings/SettingsView"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Settings",
}

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [
    { data: profile },
    { data: memory },
    { data: channels },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single(),
    supabase
      .from("user_memory")
      .select("*")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("channels")
      .select("id, type, display_name, account_email, is_active, last_synced_at")
      .eq("user_id", user.id)
      .order("created_at"),
  ])

  return (
    <SettingsView
      profile={profile}
      memory={memory}
      channels={channels ?? []}
      userId={user.id}
    />
  )
}
