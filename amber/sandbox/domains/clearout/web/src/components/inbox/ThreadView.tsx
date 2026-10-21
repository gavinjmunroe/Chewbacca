"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { DraftEditor } from "./DraftEditor"
import type { Thread, Message, Draft, Channel } from "@/types/messages"
import { formatRelativeTime, getInitials, getChannelIcon } from "@/lib/utils"
import {
  ArrowLeft,
  Archive,
  CheckCheck,
  Clock,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { Badge } from "@/components/ui/Badge"

interface ThreadViewProps {
  thread: Thread & { channels: Channel }
  messages: Message[]
  drafts: Draft[]
  userMemory: { tone_profile: unknown; communication_preferences: unknown } | null
  userProfile: { full_name: string | null; email: string | null } | null
  userId: string
}

export function ThreadView({
  thread,
  messages,
  drafts: initialDrafts,
  userMemory,
  userProfile,
  userId,
}: ThreadViewProps) {
  const router = useRouter()
  const [drafts, setDrafts] = useState(initialDrafts)
  const [isGenerating, setIsGenerating] = useState(false)
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set([messages[messages.length - 1]?.id].filter(Boolean) as string[])
  )

  const activeDraft = drafts.find(d => d.status === "pending" || d.status === "edited")

  async function handleAction(action: string, data?: Record<string, unknown>) {
    await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: thread.id,
        action,
        action_data: data ?? {},
      }),
    })

    if (action === "archive" || action === "done") {
      router.push("/inbox")
    }
  }

  async function handleGenerateDraft(instruction?: string) {
    setIsGenerating(true)
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: thread.id,
          tone: "balanced",
          instruction,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setDrafts(prev => [{ ...data, id: data.draft_id, status: "pending" } as Draft, ...prev.filter(d => d.id !== data.draft_id)])
      }
    } finally {
      setIsGenerating(false)
    }
  }

  function toggleMessage(msgId: string) {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-panel transition-colors shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-foreground leading-tight">
            {thread.subject ?? "(no subject)"}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {getChannelIcon(thread.channels?.type ?? "email")} {thread.channels?.display_name ?? thread.channels?.account_email}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{thread.message_count} messages</span>
            {thread.urgency_score >= 75 && (
              <Badge variant="urgent" className="text-[10px]">
                <AlertCircle className="w-2.5 h-2.5" /> Urgent
              </Badge>
            )}
            {thread.triage_tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="ghost" className="text-[10px]">{tag}</Badge>
            ))}
          </div>

          {thread.summary && (
            <p className="mt-2 text-xs text-muted-foreground bg-co-panel rounded-lg px-3 py-2 border border-co-border italic">
              <Sparkles className="w-3 h-3 inline mr-1 text-co-blue" />
              {thread.summary}
            </p>
          )}
        </div>

        {/* Thread actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleAction("snooze", {
              until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            })}
            title="Snooze"
          >
            <Clock className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleAction("done")}
            title="Mark done"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleAction("archive")}
            title="Archive"
          >
            <Archive className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-4">
        {messages.map((msg, i) => {
          const isExpanded = expandedMessages.has(msg.id)
          const isLatest = i === messages.length - 1

          return (
            <div
              key={msg.id}
              className="bg-co-panel border border-co-border rounded-xl overflow-hidden"
            >
              {/* Message header */}
              <button
                className="w-full flex items-start gap-3 p-3 hover:bg-co-border/30 transition-colors text-left"
                onClick={() => !isLatest && toggleMessage(msg.id)}
              >
                <div className="w-7 h-7 rounded-full bg-co-border flex items-center justify-center text-xs font-medium shrink-0">
                  {getInitials(msg.from_name ?? msg.from_email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {msg.from_name ?? msg.from_email ?? "Unknown"}
                    </span>
                    {msg.from_email && msg.from_name && (
                      <span className="text-xs text-muted-foreground truncate">&lt;{msg.from_email}&gt;</span>
                    )}
                  </div>
                  {!isExpanded && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {msg.snippet ?? msg.body_text?.slice(0, 100)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelativeTime(msg.received_at)}
                  </span>
                  {!isLatest && (
                    isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )
                  )}
                </div>
              </button>

              {/* Message body */}
              {(isExpanded || isLatest) && (
                <div className="px-4 pb-4 pt-1">
                  <div className="text-sm text-foreground/80 leading-relaxed message-body whitespace-pre-wrap">
                    {msg.body_text ?? msg.snippet ?? "(no content)"}
                  </div>

                  {(msg.to_addresses as Array<{ email: string }>)?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-co-border">
                      <span className="text-xs text-muted-foreground">
                        To: {(msg.to_addresses as Array<{ email: string }>).map(a => a.email).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Draft editor */}
      <DraftEditor
        threadId={thread.id}
        activeDraft={activeDraft}
        onGenerate={handleGenerateDraft}
        isGenerating={isGenerating}
        channelType={thread.channels?.type}
        onDraftUpdate={draft => setDrafts(prev => {
          const next = prev.filter(d => d.id !== draft.id)
          return [draft, ...next]
        })}
      />
    </div>
  )
}
