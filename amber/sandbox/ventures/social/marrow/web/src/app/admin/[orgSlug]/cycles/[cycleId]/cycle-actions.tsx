'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Play, Pause, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface CycleActionsProps {
  cycleId: string
  currentStatus: string
  orgSlug: string
}

export function CycleActions({ cycleId, currentStatus, orgSlug }: CycleActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = React.useState(false)

  const updateStatus = async (status: string) => {
    setLoading(true)
    const { error } = await supabase
      .from('cycles')
      .update({ status })
      .eq('id', cycleId)

    if (error) {
      toast.error('Failed to update cycle status')
    } else {
      toast.success(`Cycle ${status === 'active' ? 'activated' : status === 'paused' ? 'paused' : 'closed'}`)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <>
      {currentStatus === 'draft' || currentStatus === 'paused' ? (
        <Button size="sm" onClick={() => updateStatus('active')} disabled={loading}>
          <Play className="h-3.5 w-3.5 mr-1" />
          Activate
        </Button>
      ) : null}
      {currentStatus === 'active' && (
        <Button variant="outline" size="sm" onClick={() => updateStatus('paused')} disabled={loading}>
          <Pause className="h-3.5 w-3.5 mr-1" />
          Pause
        </Button>
      )}
      {currentStatus !== 'closed' && currentStatus !== 'archived' && (
        <Button variant="outline" size="sm" onClick={() => updateStatus('closed')} disabled={loading}
          className="text-stone-500">
          <X className="h-3.5 w-3.5 mr-1" />
          Close
        </Button>
      )}
    </>
  )
}
