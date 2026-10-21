"use client"

import { useRouter, usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/Button"
import { RefreshCw, Sparkles } from "lucide-react"
import type { Channel } from "@/types/messages"

const FILTERS = [
  { value: "unread", label: "Unread" },
  { value: "in_progress", label: "In Progress" },
  { value: "snoozed", label: "Snoozed" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
]

interface InboxFiltersProps {
  currentStatus: string
  channels: Partial<Channel>[]
  onSyncAll: () => void
  onTriageAll: () => void
  isSyncing: boolean
  isTriaging: boolean
  untriagedCount: number
}

export function InboxFilters({
  currentStatus,
  onSyncAll,
  onTriageAll,
  isSyncing,
  isTriaging,
  untriagedCount,
}: InboxFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()

  function handleFilterChange(status: string) {
    router.push(`${pathname}?status=${status}`)
  }

  return (
    <div className="border-b border-co-border bg-co-surface/30 px-4 py-2 flex items-center gap-2 flex-wrap">
      {/* Status filters */}
      <div className="flex items-center gap-1 flex-1">
        {FILTERS.map(filter => (
          <button
            key={filter.value}
            onClick={() => handleFilterChange(filter.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              currentStatus === filter.value
                ? "bg-co-blue/15 text-co-blue"
                : "text-muted-foreground hover:text-foreground hover:bg-co-panel"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {untriagedCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onTriageAll}
            loading={isTriaging}
          >
            <Sparkles className="w-3 h-3" />
            Triage {untriagedCount}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onSyncAll}
          loading={isSyncing}
          title="Sync all channels"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}
