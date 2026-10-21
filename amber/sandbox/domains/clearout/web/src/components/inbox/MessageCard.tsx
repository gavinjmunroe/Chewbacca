"use client"

import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/Badge"
import {
  cn,
  formatRelativeTime,
  getUrgencyBorderClass,
  getChannelIcon,
  getInitials,
  truncate,
} from "@/lib/utils"
import type { TriageQueueItem } from "@/types/database"
import {
  Archive,
  Clock,
  CheckCheck,
  MessageSquarePlus,
} from "lucide-react"

interface MessageCardProps {
  thread: TriageQueueItem
  isSelected: boolean
  onSelect: (id: string) => void
  onAction: (threadId: string, action: string, data?: Record<string, unknown>) => Promise<void>
}

export function MessageCard({ thread, isSelected, onSelect, onAction }: MessageCardProps) {
  const router = useRouter()

  const urgencyBorder = getUrgencyBorderClass(thread.urgency_score)

  function handleClick() {
    router.push(`/inbox/${thread.id}`)
  }

  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation()
    await onAction(thread.id, "archive")
  }

  async function handleDone(e: React.MouseEvent) {
    e.stopPropagation()
    await onAction(thread.id, "done")
  }

  async function handleSnooze(e: React.MouseEvent) {
    e.stopPropagation()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    await onAction(thread.id, "snooze", { until: tomorrow.toISOString() })
  }

  const isUnread = thread.status === "unread"
  const tags = thread.triage_tags.slice(0, 2)

  return (
    <div
      className={cn(
        "group relative flex gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150",
        "bg-co-panel border border-co-border",
        urgencyBorder,
        "hover:border-co-blue/30 hover:bg-co-panel/80",
        isSelected && "border-co-blue/50 bg-co-blue/5",
        isUnread && "bg-co-surface"
      )}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick() }}
    >
      {/* Checkbox */}
      <button
        type="button"
        aria-label="Select thread"
        className="mt-0.5 shrink-0"
        onClick={e => {
          e.stopPropagation()
          onSelect(thread.id)
        }}
      >
        <div
          className={cn(
            "w-4 h-4 rounded border transition-all",
            isSelected
              ? "bg-co-blue border-co-blue"
              : "border-co-border group-hover:border-co-muted"
          )}
        />
      </button>

      {/* Avatar */}
      <div className="shrink-0">
        <div className="w-8 h-8 rounded-full bg-co-border flex items-center justify-center text-xs font-medium text-foreground/70">
          {getInitials(thread.latest_from)}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn("text-sm truncate", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
              {thread.latest_from ?? "Unknown"}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {getChannelIcon(thread.channel_type)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {thread.urgency_score >= 75 && (
              <span className="text-[10px] text-red-400 font-medium">urgent</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {formatRelativeTime(thread.last_message_at)}
            </span>
            {isUnread && (
              <span className="w-1.5 h-1.5 rounded-full bg-co-blue shrink-0" />
            )}
          </div>
        </div>

        <p className={cn("text-xs mt-0.5 truncate", isUnread ? "text-foreground/70" : "text-muted-foreground")}>
          {thread.subject ?? "(no subject)"}
        </p>

        {thread.summary && (
          <p className="text-xs mt-1 text-muted-foreground line-clamp-1">
            {truncate(thread.summary, 100)}
          </p>
        )}

        {/* Tags and actions */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            {tags.map(tag => (
              <Badge key={tag} variant="ghost" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {thread.action_required && thread.action_type && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {thread.action_type}
              </Badge>
            )}
          </div>

          {/* Quick actions - visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); router.push(`/inbox/${thread.id}?draft=true`) }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-border transition-colors"
              title="Draft reply"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleSnooze}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-border transition-colors"
              title="Snooze"
            >
              <Clock className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDone}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-green-400 hover:bg-green-400/10 transition-colors"
              title="Mark done"
            >
              <CheckCheck className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleArchive}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-border transition-colors"
              title="Archive"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
