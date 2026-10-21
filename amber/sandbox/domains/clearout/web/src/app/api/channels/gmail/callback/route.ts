import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { exchangeCodeForTokens, getAuthenticatedClient, getUserInfo } from "@/lib/gmail/client"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(`${origin}/channels?error=gmail_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/channels?error=missing_params`)
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  // Validate state contains user ID
  const [stateUserId] = state.split(":")
  if (stateUserId !== user.id) {
    return NextResponse.redirect(`${origin}/channels?error=state_mismatch`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const auth = getAuthenticatedClient(tokens.access_token!, tokens.refresh_token!)
    const userInfo = await getUserInfo(auth)

    const expiry = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null

    // Upsert the channel
    const { error: dbError } = await (supabase as any)
      .from("channels")
      .upsert({
        user_id: user.id,
        type: "gmail",
        display_name: userInfo.name ?? userInfo.email ?? "Gmail",
        account_email: userInfo.email ?? "",
        account_id: userInfo.id ?? "",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: expiry,
        scopes: tokens.scope?.split(" ") ?? [],
        is_active: true,
        sync_status: "idle",
      }, {
        onConflict: "user_id,type,account_email",
      })

    if (dbError) throw dbError

    return NextResponse.redirect(`${origin}/channels?connected=gmail&sync=true`)
  } catch (err) {
    console.error("Gmail callback error:", err)
    return NextResponse.redirect(`${origin}/channels?error=gmail_failed`)
  }
}
