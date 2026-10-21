'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Settings, User, Vault } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { User as SupabaseUser } from '@supabase/supabase-js'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/explore', label: 'Explore' },
  { href: '/apply', label: 'My Applications' },
]

function MarrowLogo() {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      {/* Stylized bone/marrow icon */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-stone-900"
        aria-hidden="true"
      >
        <circle cx="5" cy="5" r="3" fill="currentColor" />
        <circle cx="19" cy="5" r="3" fill="currentColor" />
        <circle cx="5" cy="19" r="3" fill="currentColor" />
        <circle cx="19" cy="19" r="3" fill="currentColor" />
        <rect x="7" y="11" width="10" height="2" rx="1" fill="currentColor" />
        <rect x="4" y="7" width="2" height="10" rx="1" fill="currentColor" />
        <rect x="18" y="7" width="2" height="10" rx="1" fill="currentColor" />
      </svg>
      <span className="font-semibold text-stone-900 tracking-tight text-base group-hover:text-stone-700 transition-colors">
        Marrow
      </span>
    </Link>
  )
}

export function Navbar() {
  const [user, setUser] = React.useState<SupabaseUser | null>(null)
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
  const [initials, setInitials] = React.useState('?')
  const [isLoading, setIsLoading] = React.useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  React.useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      setUser(user)

      if (user) {
        // Fetch profile for avatar/initials
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name, avatar_url')
          .eq('id', user.id)
          .single()

        if (profile) {
          const first = profile.first_name?.charAt(0)?.toUpperCase() ?? ''
          const last = profile.last_name?.charAt(0)?.toUpperCase() ?? ''
          setInitials((first + last) || (user.email?.charAt(0)?.toUpperCase() ?? '?'))
          setAvatarUrl(profile.avatar_url ?? null)
        } else {
          setInitials(user.email?.charAt(0)?.toUpperCase() ?? '?')
        }
      }

      setIsLoading(false)
    }

    getUser()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (!session?.user) {
        setInitials('?')
        setAvatarUrl(null)
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-stone-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <MarrowLogo />

        {/* Center nav links — only for authenticated users */}
        {user && (
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  pathname === link.href || pathname.startsWith(link.href + '/')
                    ? 'bg-stone-100 text-stone-900 font-medium'
                    : 'text-stone-500 hover:text-stone-900 hover:bg-stone-50'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Right side */}
        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="h-8 w-8 rounded-full bg-stone-100 animate-pulse" />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2"
                  aria-label="User menu"
                >
                  <Avatar className="h-8 w-8 cursor-pointer hover:opacity-80 transition-opacity">
                    {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile" />}
                    <AvatarFallback className="text-xs bg-stone-900 text-stone-50">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs text-stone-400 font-normal truncate">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/vault" className="cursor-pointer">
                    <Vault className="mr-2 h-4 w-4" />
                    My Vault
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Log In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
