'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Edit, Users, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate, CYCLE_STATUS_LABELS, CYCLE_STATUS_COLORS } from '@/lib/utils'

interface CycleCardProps {
  cycle: {
    id: string
    name: string
    status: string
    application_open_at: string | null
    application_close_at: string | null
    description: string | null
  }
  orgSlug: string
  appCount: number
}

export function CycleCard({ cycle, orgSlug, appCount }: CycleCardProps) {
  const [archiving, setArchiving] = React.useState(false)
  const [archived, setArchived] = React.useState(cycle.status === 'archived')

  const statusLabel = CYCLE_STATUS_LABELS[archived ? 'archived' : cycle.status] ?? cycle.status
  const statusColor = CYCLE_STATUS_COLORS[archived ? 'archived' : cycle.status] ?? ''

  const handleArchive = async () => {
    if (!confirm(`Archive "${cycle.name}"? This will close the cycle to new applications.`)) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/cycles/${cycle.id}/archive`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Failed to archive cycle')
      }
      setArchived(true)
      toast.success(`"${cycle.name}" has been archived`)
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to archive cycle')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-stone-900 truncate">{cycle.name}</h3>
              <Badge className={`text-xs shrink-0 ${statusColor}`}>{statusLabel}</Badge>
            </div>
            {cycle.description && (
              <p className="text-xs text-stone-500 truncate mb-2">{cycle.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-stone-400">
              {cycle.application_open_at && (
                <span>Opens {formatDate(cycle.application_open_at)}</span>
              )}
              {cycle.application_close_at && (
                <span>Closes {formatDate(cycle.application_close_at)}</span>
              )}
              <span>
                {appCount} applicant{appCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/${orgSlug}/cycles/${cycle.id}`}>
                <Edit className="h-3.5 w-3.5 mr-1" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/${orgSlug}/cycles/${cycle.id}/applicants`}>
                <Users className="h-3.5 w-3.5 mr-1" />
                Applicants
              </Link>
            </Button>
            {!archived && (
              <Button
                variant="ghost"
                size="sm"
                className="text-stone-400 hover:text-stone-600"
                onClick={handleArchive}
                disabled={archiving}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
