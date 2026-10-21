import { getAuthenticatedClient, getGmailClient } from "./client"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

const MAX_RESULTS = 50

interface RawThread {
  id: string
  historyId?: string
  snippet?: string
  messages?: RawMessage[]
}

interface RawMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string; size?: number }
    parts?: RawMessagePart[]
    mimeType?: string
  }
  internalDate?: string
}

interface RawMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: RawMessagePart[]
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
}

function decodeBody(data?: string): string {
  if (!data) return ""
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  } catch {
    return ""
  }
}

function extractBody(payload: RawMessage["payload"]): { text: string; html: string } {
  if (!payload) return { text: "", html: "" }

  let text = ""
  let html = ""

  function traverse(part: RawMessagePart | RawMessage["payload"]) {
    if (!part) return

    if (part.mimeType === "text/plain" && part.body?.data) {
      text += decodeBody(part.body.data)
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html += decodeBody(part.body.data)
    }

    if ("parts" in part && part.parts) {
      part.parts.forEach(traverse)
    }
  }

  traverse(payload)
  return { text, html }
}

function extractAttachments(payload: RawMessage["payload"]): Array<{
  id: string
  name: string
  size: number
  mime_type: string
}> {
  const attachments: Array<{ id: string; name: string; size: number; mime_type: string }> = []

  function traverse(part: RawMessagePart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        name: part.filename,
        size: part.body.size ?? 0,
        mime_type: part.mimeType ?? "application/octet-stream",
      })
    }
    if (part.parts) {
      part.parts.forEach(traverse)
    }
  }

  if (payload?.parts) {
    payload.parts.forEach(traverse)
  }

  return attachments
}

export async function syncGmailChannel(
  supabase: SupabaseClient<Database>,
  channelId: string,
  userId: string,
  accessToken: string,
  refreshToken: string,
  previousCursor?: string | null
): Promise<{ threadsProcessed: number; messagesProcessed: number; newCursor: string | null; errors: string[] }> {
  const errors: string[] = []
  let threadsProcessed = 0
  let messagesProcessed = 0
  let newCursor: string | null = null

  try {
    const auth = getAuthenticatedClient(accessToken, refreshToken)
    const gmail = getGmailClient(auth)

    // Mark channel as syncing
    await (supabase as any)
      .from("channels")
      .update({ sync_status: "syncing" })
      .eq("id", channelId)

    let nextPageToken: string | undefined

    do {
      const listResponse = await gmail.users.threads.list({
        userId: "me",
        maxResults: MAX_RESULTS,
        q: "in:inbox",
        pageToken: nextPageToken,
      })

      const threads = listResponse.data.threads ?? []
      nextPageToken = listResponse.data.nextPageToken ?? undefined

      if (!newCursor && listResponse.data.resultSizeEstimate) {
        // Use historyId from first message as cursor for incremental sync
      }

      for (const threadRef of threads) {
        if (!threadRef.id) continue

        try {
          const threadResponse = await gmail.users.threads.get({
            userId: "me",
            id: threadRef.id,
            format: "full",
          })

          const thread = threadResponse.data as RawThread
          const msgs = thread.messages ?? []
          if (msgs.length === 0) continue

          const firstMsg = msgs[0]
          const lastMsg = msgs[msgs.length - 1]
          const headers = firstMsg.payload?.headers ?? []

          const subject = getHeader(headers, "subject") || "(no subject)"
          const participants: Array<{ name?: string; email?: string }> = []

          // Collect unique participants
          const seenEmails = new Set<string>()
          for (const msg of msgs) {
            const from = getHeader(msg.payload?.headers ?? [], "from")
            if (from) {
              const match = from.match(/^(.+?)\s*<(.+?)>$/)
              if (match) {
                const email = match[2].toLowerCase()
                if (!seenEmails.has(email)) {
                  seenEmails.add(email)
                  participants.push({ name: match[1].replace(/"/g, ""), email })
                }
              } else {
                const email = from.toLowerCase()
                if (!seenEmails.has(email)) {
                  seenEmails.add(email)
                  participants.push({ email })
                }
              }
            }
          }

          const lastMsgDate = lastMsg.internalDate
            ? new Date(parseInt(lastMsg.internalDate))
            : new Date()
          const isUnread = firstMsg.labelIds?.includes("UNREAD") ?? false

          // Upsert thread
          const { data: existingThread } = await (supabase as any)
            .from("threads")
            .select("id, message_count")
            .eq("channel_id", channelId)
            .eq("external_thread_id", thread.id!)
            .single()

          let dbThreadId: string

          if (existingThread) {
            dbThreadId = existingThread.id
            await (supabase as any)
              .from("threads")
              .update({
                subject,
                participants: participants as unknown as Database["public"]["Tables"]["threads"]["Update"]["participants"],
                last_message_at: lastMsgDate.toISOString(),
                message_count: msgs.length,
                unread_count: msgs.filter(m => m.labelIds?.includes("UNREAD")).length,
                status: isUnread ? "unread" : "read",
              })
              .eq("id", dbThreadId)
          } else {
            const { data: newThread } = await (supabase as any)
              .from("threads")
              .insert({
                user_id: userId,
                channel_id: channelId,
                external_thread_id: thread.id!,
                subject,
                participants: participants as unknown as Database["public"]["Tables"]["threads"]["Insert"]["participants"],
                last_message_at: lastMsgDate.toISOString(),
                message_count: msgs.length,
                unread_count: msgs.filter(m => m.labelIds?.includes("UNREAD")).length,
                status: isUnread ? "unread" : "read",
                urgency_score: 0,
                importance_score: 0,
              })
              .select("id")
              .single()

            if (!newThread) continue
            dbThreadId = newThread.id
          }

          // Process each message
          for (const msg of msgs) {
            if (!msg.id) continue

            const msgHeaders = msg.payload?.headers ?? []
            const fromHeader = getHeader(msgHeaders, "from")
            const { text: bodyText, html: bodyHtml } = extractBody(msg.payload)
            const attachments = extractAttachments(msg.payload)

            // Parse from header
            let fromName: string | null = null
            let fromEmail: string | null = null
            const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/)
            if (fromMatch) {
              fromName = fromMatch[1].replace(/"/g, "")
              fromEmail = fromMatch[2].toLowerCase()
            } else if (fromHeader) {
              fromEmail = fromHeader.toLowerCase()
            }

            const toHeader = getHeader(msgHeaders, "to")
            const ccHeader = getHeader(msgHeaders, "cc")
            const receivedAt = msg.internalDate
              ? new Date(parseInt(msg.internalDate)).toISOString()
              : new Date().toISOString()

            await (supabase as any)
              .from("messages")
              .upsert({
                thread_id: dbThreadId,
                user_id: userId,
                channel_id: channelId,
                external_id: msg.id,
                from_name: fromName,
                from_email: fromEmail,
                to_addresses: toHeader ? [{ email: toHeader }] : [],
                cc_addresses: ccHeader ? [{ email: ccHeader }] : [],
                subject: getHeader(msgHeaders, "subject") || subject,
                body_text: bodyText,
                body_html: bodyHtml,
                snippet: msg.snippet ?? null,
                attachments: attachments as unknown as Database["public"]["Tables"]["messages"]["Insert"]["attachments"],
                is_outbound: msg.labelIds?.includes("SENT") ?? false,
                is_read: !(msg.labelIds?.includes("UNREAD") ?? false),
                received_at: receivedAt,
                metadata: { gmail_label_ids: msg.labelIds ?? [] },
              }, {
                onConflict: "channel_id,external_id",
              })

            messagesProcessed++
          }

          threadsProcessed++
        } catch (threadErr) {
          errors.push(`Thread ${threadRef.id}: ${String(threadErr)}`)
        }
      }

      // Only fetch first page for now in initial sync
      if (previousCursor) break

    } while (nextPageToken && threadsProcessed < 200)

    // Update channel sync status
    const { data: profileData } = await gmail.users.getProfile({ userId: "me" })
    newCursor = profileData.historyId?.toString() ?? null

    await (supabase as any)
      .from("channels")
      .update({
        sync_status: "idle",
        last_synced_at: new Date().toISOString(),
        sync_cursor: newCursor,
        error_message: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
      })
      .eq("id", channelId)

  } catch (err) {
    await (supabase as any)
      .from("channels")
      .update({
        sync_status: "error",
        error_message: String(err),
      })
      .eq("id", channelId)
    throw err
  }

  return { threadsProcessed, messagesProcessed, newCursor, errors }
}
