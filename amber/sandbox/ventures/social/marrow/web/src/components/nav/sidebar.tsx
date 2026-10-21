'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Settings, Users, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarProps {
  orgSlug: string
  orgName: string
  orgLogoUrl?: string | null
}

const NAV_ITEMS = [
  {
    label: 'Overview',
    href: (slug: string) => `/admin/${slug}`,
    icon: BarChart3,
    exact: true,
  },
  {
    label: 'Cycles',
    href: (slug: string) => `/admin/${slug}/cycles`,
    icon: RefreshCw,
    exact: false,
  },
  {
    label: 'Members',
    href: (slug: string) => `/admin/${slug}/members`,
    icon: Users,
    exact: false,
  },
  {
    label: 'Settings',
    href: (slug: string) => `/admin/${slug}/settings`,
    icon: Settings,
    exact: false,
  },
]

function OrgAvatar({
  name,
  logoUrl,
}: {
  name: string
  logoUrl?: string | null
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="h-8 w-8 rounded-md object-cover"
      />
    )
  }

  return (
    <div className="h-8 w-8 rounded-md bg-stone-900 text-stone-50 flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {initials || '?'}
    </div>
  )
}

export function AdminSidebar({ orgSlug, orgName, orgLogoUrl }: SidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string, exact: boolean) => {
    if (exact) {
      return pathname === href
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r border-stone-200 bg-white">
      {/* Org header */}
      <div className="flex items-center gap-2.5 border-b border-stone-200 px-4 py-4">
        <OrgAvatar name={orgName} logoUrl={orgLogoUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900 leading-tight">
            {orgName}
          </p>
          <p className="text-xs text-stone-400">Admin</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const href = item.href(orgSlug)
            const active = isActive(href, item.exact)
            const Icon = item.icon

            return (
              <li key={item.label}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    active
                      ? 'bg-stone-100 text-stone-900 font-medium'
                      : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      active ? 'text-stone-900' : 'text-stone-400'
                    )}
                  />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-stone-200 p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </aside>
  )
}
