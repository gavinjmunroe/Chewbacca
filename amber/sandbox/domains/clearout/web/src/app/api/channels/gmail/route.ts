import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthorizationUrl } from "@/lib/gmail/client"
import { randomBytes } from "crypto"

// GET /api/channels/gmail - initiate Gmail OAuth
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const state = `${user.id}:${randomBytes(16).toString("hex")}`
  const url = getAuthorizationUrl(state)

  return NextResponse.json({ url })
}
