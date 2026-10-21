"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { MessageCard } from "./MessageCard"
import { PriorityStrip } from "./PriorityStrip"
import { InboxFilters } from "./InboxFilters"
import type { TriageQueueItem } from "@/types/database"
import type { Channel, DailyBriefing } from "@/types/messages"
import { RefreshCw, Inbox, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/Button"

interface InboxViewProps {
  initialThreads: TriageQueueItem[]
  channels: Partial<Channel>[]
  briefing: DailyBriefing | null
  currentStatus: string
  userId: string
}

export function InboxView({
  initialThreads,
  channels,
  briefing,
  currentStatus,
  userId,
}: InboxViewProps) {
  const router = useRouter()
  const [threads, setThreads] = useState(initialThreads)
  const [isTriaging, setIsTriaging] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const urgentThreads = threads.filter(t => t.urgency_score >= 75)
  const regularThreads = threads.filter(t => t.urgency_score < 75)

  async function handleTriageAll() {
    setIsTriaging(true)
    try {
      const untriaged = threads.filter(t => t.urgency_score === 0).slice(0, 20)
      if (untriaged.length === 0) return

      const res = await fetch("/api/triage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_ids: untriaged.map(t => t.id) }),
      })

      if (res.ok) {
        router.refresh()
      }
    } finally {
      setIsTriaging(false)
    }
  }

  async function handleSyncAll() {
    setIsSyncing(true)
    try {
      await Promise.all(
        channels.map(ch =>
          fetch("/api/messages/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel_id: ch.id }),
          })
        )
      )
      router.refresh()
    } finally {
      setIsSyncing(false)
    }
  }

  const handleAction = useCallback(
    async (threadId: string, action: string, data?: Record<string, unknown>) => {
      await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, action, action_data: data ?? {} }),
      })

      setThreads(prev => prev.filter(t => {
        if (t.id !== threadId) return true
        if (action === "archive" || action === "done") return false
        return true
      }))
    },
    []
  )

  const hasChannels = channels.length > 0
  const isEmpty = threads.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <InboxFilters
        currentStatus={currentStatus}
        channels={channels}
        onSyncAll={handleSyncAll}
        onTriageAll={handleTriageAll}
        isSyncing={isSyncing}
        isTriaging={isTriaging}
        untriagedCount={threads.filter(t => t.urgency_score === 0).length}
      />

      <div className="flex-1 overflow-y-auto">
        {!hasChannels ? (
          <EmptyChannels />
        ) : isEmpty ? (
          <EmptyInbox status={currentStatus} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-6">
            {/* Priority strip - urgent items */}
            {urgentThreads.length > 0 && (
              <PriorityStrip threads={urgentThreads} onAction={handleAction} />
            )}

            {/* Regular threads */}
            {regularThreads.length > 0 && (
              <div className="space-y-2">
                {urgentThreads.length > 0 && (
                  <h3 className="text-xs font-medium text-muted-foreground px-1">
                    Remaining ({regularThreads.length})
                  </h3>
                )}
                <div className="space-y-1.5">
                  {regularThreads.map(thread => (
                    <MessageCard
                      key={thread.id}
                      thread={thread}
                      isSelected={selectedIds.has(thread.id)}
                      onSelect={id => {
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          if (next.has(id)) next.delete(id)
                          else next.add(id)
                          return next
                        })
                      }}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyInbox({ status }: { status: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center mb-4">
        <Inbox className="w-7 h-7 text-green-400" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">
        {status === "unread" ? "All cleared" : `No ${status} messages`}
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        {status === "unread"
          ? "You&apos;re on top of everything. Great work."
          : "Nothing here right now."}
      </p>
      {status !== "unread" && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4"
          onClick={() => router.push("/inbox")}
        >
          Back to Inbox
        </Button>
      )}
    </div>
  )
}

function EmptyChannels() {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-co-blue/10 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-co-blue" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">
        Connect your first channel
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Connect Gmail, Slack, or iMessage to start clearing your communications with AI.
      </p>
      <Button onClick={() => router.push("/channels")}>
        Connect a channel
      </Button>
    </div>
  )
}
