import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { exchangeSlackCodeForTokens, getSlackWorkspaceInfo } from "@/lib/slack/client"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(`${origin}/channels?error=slack_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/channels?error=missing_params`)
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const [stateUserId] = state.split(":")
  if (stateUserId !== user.id) {
    return NextResponse.redirect(`${origin}/channels?error=state_mismatch`)
  }

  try {
    const tokenData = await exchangeSlackCodeForTokens(code)
    const accessToken = tokenData.access_token as string
    const teamId = tokenData.team?.id as string
    const teamName = tokenData.team?.name as string
    const botUserId = tokenData.bot_user_id as string
    const authedUser = tokenData.authed_user as { id: string; access_token?: string }

    const workspaceToken = authedUser.access_token ?? accessToken

    const { error: dbError } = await (supabase as any)
      .from("channels")
      .upsert({
        user_id: user.id,
        type: "slack",
        display_name: teamName ?? "Slack",
        account_id: authedUser.id,
        access_token: workspaceToken,
        workspace_id: teamId,
        workspace_name: teamName,
        is_active: true,
        sync_status: "idle",
        metadata: {
          bot_user_id: botUserId,
          team_id: teamId,
        },
      }, {
        onConflict: "user_id,type,workspace_id",
      })

    if (dbError) throw dbError

    return NextResponse.redirect(`${origin}/channels?connected=slack&sync=true`)
  } catch (err) {
    console.error("Slack callback error:", err)
    return NextResponse.redirect(`${origin}/channels?error=slack_failed`)
  }
}
