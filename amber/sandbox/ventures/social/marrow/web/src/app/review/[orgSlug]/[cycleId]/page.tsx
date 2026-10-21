import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Clock, ChevronRight, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn, getFullName, APPLICATION_STATUS_LABELS, APPLICATION_STATUS_COLORS } from '@/lib/utils'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; cycleId: string }>
}) {
  const { cycleId } = await params
  return { title: `Review Queue — Marrow` }
}

type FilterType = 'all' | 'pending' | 'reviewed'

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; cycleId: string }>
  searchParams: Promise<{ filter?: string }>
}) {
  const { orgSlug, cycleId } = await params
  const { filter = 'all' } = await searchParams

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?redirect=/review/${orgSlug}/${cycleId}`)

  // Load cycle with org
  const sb = supabase as any

  const { data: cycleRaw } = await sb
    .from('cycles')
    .select('*, organizations(*)')
    .eq('id', cycleId)
    .single()

  if (!cycleRaw) notFound()
  const cycle = cycleRaw as { id: string; name: string; org_id: string; organizations: any }

  const org = cycle.organizations as any

  // Verify reviewer is a member of this org
  const { data: membership } = await sb
    .from('org_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  // Fetch the current stage for this cycle (reviews are done per-stage)
  const { data: stagesRaw } = await sb
    .from('stages')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('stage_order', { ascending: true })
  const stages = (stagesRaw ?? []) as Array<{ id: string; name: string; is_blind: boolean; stage_order: number }>

  // Fetch reviews assigned to this reviewer
  const { data: myReviewsRaw } = await sb
    .from('reviews')
    .select(`
      *,
      applications (
        *,
        profiles (*),
        stages (*)
      )
    `)
    .eq('reviewer_id', user.id)
    .in('stage_id', stages.map((s) => s.id))
  const myReviews = (myReviewsRaw ?? []) as any[]

  // Flatten to deduplicated application list for this cycle
  const seenAppIds = new Set<string>()
  const assignedApps: Array<{
    appId: string
    reviewId: string
    stageId: string
    isSubmitted: boolean
    recommendation: string | null
    applicantName: string
    status: string
    stageName: string
    isBlind: boolean
  }> = []

  for (const review of myReviews) {
    const app = review.applications as any
    if (!app || app.cycle_id !== cycleId) continue
    if (seenAppIds.has(app.id)) continue
    seenAppIds.add(app.id)

    const profile = app.profiles
    const stage = app.stages
    const stageDetails = stages.find((s) => s.id === review.stage_id)
    const isBlind = stageDetails?.is_blind ?? false

    assignedApps.push({
      appId: app.id,
      reviewId: review.id,
      stageId: review.stage_id,
      isSubmitted: review.is_submitted,
      recommendation: review.recommendation,
      applicantName: isBlind ? 'Applicant (Blinded)' : getFullName(profile?.first_name ?? null, profile?.last_name ?? null),
      status: app.status,
      stageName: stageDetails?.name ?? stage?.name ?? 'Unknown Stage',
      isBlind,
    })
  }

  const total = assignedApps.length
  const reviewed = assignedApps.filter((a) => a.isSubmitted).length
  const pending = total - reviewed
  const completionPct = total > 0 ? Math.round((reviewed / total) * 100) : 0

  const activeFilter = (filter as FilterType) || 'all'
  const filtered = assignedApps.filter((a) => {
    if (activeFilter === 'pending') return !a.isSubmitted
    if (activeFilter === 'reviewed') return a.isSubmitted
    return true
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-stone-500">{org?.name}</p>
        <h1 className="text-2xl font-semibold text-stone-900 mt-0.5">{cycle.name}: Review Queue</h1>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-stone-900">{total}</p>
            <p className="text-xs text-stone-500 mt-0.5 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Total Assigned
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{reviewed}</p>
            <p className="text-xs text-stone-500 mt-0.5 flex items-center justify-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Reviewed
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{pending}</p>
            <p className="text-xs text-stone-500 mt-0.5 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Pending
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-stone-500">
          <span>Overall completion</span>
          <span>{completionPct}%</span>
        </div>
        <Progress value={completionPct} className="h-2" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-stone-200 pb-0">
        {(['all', 'pending', 'reviewed'] as const).map((f) => (
          <Link
            key={f}
            href={`/review/${orgSlug}/${cycleId}?filter=${f}`}
            className={cn(
              'px-4 py-2 text-sm rounded-t-md transition-colors capitalize',
              activeFilter === f
                ? 'bg-white border border-b-white border-stone-200 text-stone-900 font-medium -mb-px'
                : 'text-stone-500 hover:text-stone-700'
            )}
          >
            {f}
            {f === 'all' && <span className="ml-1.5 text-xs text-stone-400">({total})</span>}
            {f === 'pending' && <span className="ml-1.5 text-xs text-amber-500">({pending})</span>}
            {f === 'reviewed' && <span className="ml-1.5 text-xs text-emerald-500">({reviewed})</span>}
          </Link>
        ))}
      </div>

      {/* Application list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-stone-400 text-sm">
              {activeFilter === 'pending'
                ? "No pending reviews. You're all caught up!"
                : activeFilter === 'reviewed'
                  ? 'No submitted reviews yet.'
                  : 'No applications assigned to you for this cycle.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((app) => {
            const statusColor = APPLICATION_STATUS_COLORS[app.status] ?? ''
            return (
              <Link
                key={app.appId}
                href={`/review/${orgSlug}/${cycleId}/${app.appId}`}
                className="block"
              >
                <div className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm transition-all group">
                  <div className="flex items-center gap-3">
                    {/* Status indicator dot */}
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        app.isSubmitted ? 'bg-emerald-500' : 'bg-amber-400'
                      )}
                    />
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {app.applicantName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-stone-400">{app.stageName}</span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            statusColor
                          )}
                        >
                          {APPLICATION_STATUS_LABELS[app.status] ?? app.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'text-xs font-medium px-2 py-1 rounded-full',
                        app.isSubmitted
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      )}
                    >
                      {app.isSubmitted ? 'Reviewed' : 'Pending'}
                    </span>
                    <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-stone-500 transition-colors" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
