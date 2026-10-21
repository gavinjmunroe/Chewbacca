"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  Inbox,
  Plug,
  Mic,
  Settings,
  Zap,
  LogOut,
  ChevronRight,
} from "lucide-react"
import { cn, getInitials } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import type { Profile } from "@/types/messages"

const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/voice", label: "Voice Mode", icon: Mic },
  { href: "/channels", label: "Channels", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
]

interface SidebarProps {
  user: User
  profile: Profile | null
}

export function Sidebar({ user, profile }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const displayName = profile?.full_name ?? user.email?.split("@")[0] ?? "User"
  const initials = getInitials(profile?.full_name ?? user.email)

  return (
    <aside className="w-56 flex flex-col border-r border-co-border bg-co-surface/50 shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-co-border">
        <Link href="/inbox" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-co-blue flex items-center justify-center group-hover:bg-co-blue/90 transition-colors">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-white text-sm">ClearOut</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group",
                isActive
                  ? "bg-co-blue/10 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-co-panel"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  isActive ? "text-co-blue" : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span className="flex-1">{label}</span>
              {isActive && (
                <ChevronRight className="w-3 h-3 text-co-blue/60" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="p-2 border-t border-co-border">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-co-blue/20 flex items-center justify-center shrink-0">
            {profile?.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={displayName}
                width={28}
                height={28}
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <span className="text-xs font-medium text-co-blue">{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
