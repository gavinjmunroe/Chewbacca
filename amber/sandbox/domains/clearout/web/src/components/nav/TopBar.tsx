"use client"

import { Bell, Search } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import type { Profile, DailyBriefing } from "@/types/messages"
import { usePathname } from "next/navigation"

interface TopBarProps {
  user: User
  profile: Profile | null
  briefing?: DailyBriefing | null
}

const PAGE_TITLES: Record<string, string> = {
  "/inbox": "Inbox",
  "/voice": "Voice Mode",
  "/channels": "Channels",
  "/settings": "Settings",
}

export function TopBar({ briefing }: TopBarProps) {
  const pathname = usePathname()
  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname === path || pathname.startsWith(`${path}/`)
  )?.[1] ?? "ClearOut"

  const urgentCount = briefing?.urgent_count ?? 0
  const unreadCount = briefing?.unread_count ?? 0

  return (
    <header className="h-12 border-b border-co-border bg-co-surface/30 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0">
      <h1 className="text-sm font-semibold text-foreground flex-1">{title}</h1>

      {/* Stats */}
      {unreadCount > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {urgentCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-red-400 font-medium">{urgentCount} urgent</span>
            </span>
          )}
          <span>{unreadCount} unread</span>
        </div>
      )}

      {/* Search button */}
      <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-co-panel transition-colors">
        <Search className="w-4 h-4" />
      </button>

      {/* Notifications */}
      <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-co-panel transition-colors relative">
        <Bell className="w-4 h-4" />
        {urgentCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>
    </header>
  )
}
