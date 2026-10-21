import { google } from "googleapis"
import type { OAuth2Client } from "google-auth-library"

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  )
}

export function getAuthorizationUrl(state: string): string {
  const oauth2Client = createOAuth2Client()

  const SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ]

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  })
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export function getAuthenticatedClient(accessToken: string, refreshToken?: string) {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  return oauth2Client
}

export function getGmailClient(auth: OAuth2Client) {
  return google.gmail({ version: "v1", auth })
}

export async function getUserInfo(auth: OAuth2Client) {
  const oauth2 = google.oauth2({ version: "v2", auth })
  const { data } = await oauth2.userinfo.get()
  return data
}
