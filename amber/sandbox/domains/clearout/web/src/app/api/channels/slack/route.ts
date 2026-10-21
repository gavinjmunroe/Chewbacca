import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getSlackAuthorizationUrl } from "@/lib/slack/client"
import { randomBytes } from "crypto"

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const state = `${user.id}:${randomBytes(16).toString("hex")}`
  const url = getSlackAuthorizationUrl(state)

  return NextResponse.json({ url })
}
