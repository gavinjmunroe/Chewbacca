export function getSlackAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    scope: [
      "channels:history",
      "channels:read",
      "groups:history",
      "groups:read",
      "im:history",
      "im:read",
      "mpim:history",
      "mpim:read",
      "users:read",
      "users:read.email",
      "chat:write",
      "files:read",
      "emoji:read",
      "reactions:read",
      "team:read",
    ].join(","),
    redirect_uri: process.env.SLACK_REDIRECT_URI!,
    state,
    response_type: "code",
  })

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

export async function exchangeSlackCodeForTokens(code: string) {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI!,
    }),
  })

  const data = await response.json()
  if (!data.ok) throw new Error(`Slack OAuth error: ${data.error}`)
  return data
}

export async function callSlackAPI(
  method: string,
  token: string,
  params: Record<string, string | number | boolean> = {}
): Promise<Record<string, unknown>> {
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    queryParams.set(key, String(value))
  }

  const response = await fetch(
    `https://slack.com/api/${method}?${queryParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  )

  const data = await response.json()
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`)
  return data
}

export async function getSlackWorkspaceInfo(token: string) {
  return callSlackAPI("team.info", token)
}

export async function getSlackChannels(token: string) {
  return callSlackAPI("conversations.list", token, {
    types: "public_channel,private_channel,im,mpim",
    limit: 200,
    exclude_archived: true,
  })
}

export async function getSlackChannelHistory(
  token: string,
  channelId: string,
  limit = 100,
  oldest?: string
) {
  return callSlackAPI("conversations.history", token, {
    channel: channelId,
    limit,
    ...(oldest ? { oldest } : {}),
  })
}

export async function sendSlackMessage(
  token: string,
  channelId: string,
  text: string,
  threadTs?: string
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  })

  const data = await response.json()
  if (!data.ok) throw new Error(`Slack send error: ${data.error}`)
  return data
}
