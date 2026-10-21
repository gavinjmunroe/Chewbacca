'use client'

import Link from 'next/link'
import { ArrowRight, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import {
  cn,
  timeAgo,
  formatDate,
  getInitials,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from '@/lib/utils'

interface ApplicationCardProps {
  appId: string
  cycleId: string
  orgSlug: string
  orgName: string
  orgLogoUrl: string | null
  cycleName: string
  status: string
  stageName: string | null
  submittedAt: string | null
  updatedAt: string
}

export function ApplicationCard({
  appId,
  cycleId,
  orgSlug,
  orgName,
  orgLogoUrl,
  cycleName,
  status,
  stageName,
  submittedAt,
  updatedAt,
}: ApplicationCardProps) {
  const isDraft = status === 'draft'
  const statusLabel = APPLICATION_STATUS_LABELS[status] ?? status
  const statusColor = APPLICATION_STATUS_COLORS[status] ?? 'bg-stone-100 text-stone-600'
  const href = `/apply/${orgSlug}/${cycleId}`

  return (
    <Card className="hover:border-stone-300 hover:shadow-sm transition-all group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Org avatar */}
          <Avatar className="h-10 w-10 shrink-0 rounded-lg">
            {orgLogoUrl && <AvatarImage src={orgLogoUrl} alt={orgName} className="rounded-lg" />}
            <AvatarFallback className="rounded-lg bg-stone-100 text-stone-600 text-xs font-semibold">
              {getInitials(orgName.split(' ')[0] ?? null, orgName.split(' ')[1] ?? null)}
            </AvatarFallback>
          </Avatar>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-stone-900 truncate leading-tight">
                  {orgName}
                </p>
                <p className="text-sm text-stone-500 truncate mt-0.5">{cycleName}</p>
              </div>

              {/* Status badge */}
              <span
                className={cn(
                  'shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                  statusColor
                )}
              >
                {statusLabel}
              </span>
            </div>

            {/* Stage + date row */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {stageName && (
                <span className="text-xs text-stone-400 bg-stone-50 rounded px-1.5 py-0.5">
                  {stageName}
                </span>
              )}
              <span className="text-xs text-stone-400 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {submittedAt
                  ? `Submitted ${timeAgo(submittedAt)}`
                  : `Updated ${timeAgo(updatedAt)}`}
              </span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link href={href}>
              {isDraft ? 'Continue Application' : 'View Application'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
