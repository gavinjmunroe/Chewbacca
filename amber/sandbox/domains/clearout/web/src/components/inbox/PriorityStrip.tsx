"use client"

import { useRouter } from "next/navigation"
import type { TriageQueueItem } from "@/types/database"
import { getInitials, formatRelativeTime, truncate } from "@/lib/utils"
import { AlertCircle, Archive, CheckCheck } from "lucide-react"

interface PriorityStripProps {
  threads: TriageQueueItem[]
  onAction: (threadId: string, action: string, data?: Record<string, unknown>) => Promise<void>
}

export function PriorityStrip({ threads, onAction }: PriorityStripProps) {
  const router = useRouter()

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
        <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide">
          Urgent ({threads.length})
        </h3>
      </div>

      <div className="grid gap-2">
        {threads.map(thread => (
          <div
            key={thread.id}
            className="group flex gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20 cursor-pointer hover:border-red-500/40 hover:bg-red-500/8 transition-all"
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/inbox/${thread.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/inbox/${thread.id}`) }}
          >
            <div className="shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-xs font-medium text-red-300">
                {getInitials(thread.latest_from)}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-foreground truncate">
                  {thread.latest_from ?? "Unknown"}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelativeTime(thread.last_message_at)}
                </span>
              </div>
              <p className="text-xs text-foreground/70 mt-0.5 truncate">
                {thread.subject ?? "(no subject)"}
              </p>
              {thread.summary && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {truncate(thread.summary, 120)}
                </p>
              )}
              {thread.triage_reason && (
                <p className="text-[10px] text-red-400/70 mt-1 italic">
                  {thread.triage_reason}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={e => { e.stopPropagation(); onAction(thread.id, "done") }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-green-400 hover:bg-green-400/10 transition-colors"
                title="Done"
              >
                <CheckCheck className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onAction(thread.id, "archive") }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-border transition-colors"
                title="Archive"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
