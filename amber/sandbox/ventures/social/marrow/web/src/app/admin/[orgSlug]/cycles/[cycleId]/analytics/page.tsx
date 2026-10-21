import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/nav/sidebar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatDate, getFullName, getInitials, RECOMMENDATION_LABELS, RECOMMENDATION_COLORS } from '@/lib/utils'
import { AnalyticsCharts } from './analytics-charts'

interface PageProps {
  params: Promise<{ orgSlug: string; cycleId: string }>
}

export default async function AnalyticsPage({ params }: PageProps) {
  const { orgSlug, cycleId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch org
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, logo_url')
    .eq('slug', orgSlug)
    .single()
  if (!org) notFound()

  // Check membership
  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()
  if (!membership) redirect('/dashboard')

  // Fetch cycle
  const { data: cycle } = await supabase
    .from('cycles')
    .select('name')
    .eq('id', cycleId)
    .single()
  if (!cycle) notFound()

  // Fetch applications
  const { data: applications } = await supabase
    .from('applications')
    .select('id, status, current_stage_id, submitted_at, created_at')
    .eq('cycle_id', cycleId)

  // Fetch stages
  const { data: stages } = await supabase
    .from('stages')
    .select('id, name, stage_order')
    .eq('cycle_id', cycleId)
    .order('stage_order', { ascending: true })

  // Fetch reviews with reviewer profiles
  const { data: reviews } = await supabase
    .from('reviews')
    .select('*, profiles(first_name, last_name), review_scores(*)')
    .in(
      'application_id',
      (applications ?? []).map((a) => a.id)
    )

  // Compute status breakdown
  const statusCounts: Record<string, number> = {}
  for (const app of applications ?? []) {
    statusCounts[app.status] = (statusCounts[app.status] ?? 0) + 1
  }

  // Compute stage distribution
  const stageCounts: Record<string, number> = {}
  for (const app of applications ?? []) {
    if (app.current_stage_id) {
      stageCounts[app.current_stage_id] = (stageCounts[app.current_stage_id] ?? 0) + 1
    }
  }

  const stageDistData = (stages ?? []).map((s) => ({
    name: s.name,
    value: stageCounts[s.id] ?? 0,
  }))

  // Applications over time (by day)
  const dayMap: Record<string, number> = {}
  for (const app of applications ?? []) {
    if (!app.submitted_at) continue
    const day = app.submitted_at.slice(0, 10) // YYYY-MM-DD
    dayMap[day] = (dayMap[day] ?? 0) + 1
  }
  const timelineData = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // Status funnel data
  const FUNNEL_ORDER = [
    'submitted',
    'under_review',
    'advancing',
    'accepted',
    'waitlisted',
    'rejected',
    'withdrawn',
  ]
  const funnelData = FUNNEL_ORDER.filter((s) => statusCounts[s] > 0).map((s) => ({
    status: s,
    count: statusCounts[s],
  }))

  // Reviewer stats
  const reviewerMap: Record<
    string,
    {
      profile: { first_name: string | null; last_name: string | null } | null
      count: number
      totalScore: number
      scoreCount: number
      recommendations: Record<string, number>
    }
  > = {}

  for (const review of reviews ?? []) {
    if (!review.reviewer_id) continue
    if (!reviewerMap[review.reviewer_id]) {
      reviewerMap[review.reviewer_id] = {
        profile: review.profiles as { first_name: string | null; last_name: string | null } | null,
        count: 0,
        totalScore: 0,
        scoreCount: 0,
        recommendations: {},
      }
    }
    const rv = reviewerMap[review.reviewer_id]
    if (review.is_submitted) rv.count++
    if (review.recommendation) {
      rv.recommendations[review.recommendation] =
        (rv.recommendations[review.recommendation] ?? 0) + 1
    }
    for (const rs of review.review_scores ?? []) {
      if (rs.score != null) {
        rv.totalScore += rs.score
        rv.scoreCount++
      }
    }
  }

  const reviewerStats = Object.entries(reviewerMap).map(([id, data]) => ({
    id,
    name: getFullName(data.profile?.first_name ?? null, data.profile?.last_name ?? null),
    initials: getInitials(data.profile?.first_name ?? null, data.profile?.last_name ?? null),
    count: data.count,
    avgScore: data.scoreCount > 0 ? data.totalScore / data.scoreCount : null,
    recommendations: data.recommendations,
  }))

  const totalApps = applications?.length ?? 0
  const acceptedCount = statusCounts['accepted'] ?? 0
  const acceptanceRate = totalApps > 0 ? ((acceptedCount / totalApps) * 100).toFixed(1) : '0'

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminSidebar orgSlug={orgSlug} orgName={org.name} orgLogoUrl={org.logo_url} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
          {/* Header */}
          <div>
            <Link
              href={`/admin/${orgSlug}/cycles/${cycleId}`}
              className="text-xs text-stone-400 hover:text-stone-600 mb-2 flex items-center gap-1"
            >
              ← {cycle.name}
            </Link>
            <h1 className="text-xl font-semibold text-stone-900">Analytics</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              {cycle.name} · {totalApps} total applications
            </p>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard label="Total Apps" value={totalApps} />
            <KpiCard label="Accepted" value={acceptedCount} highlight="emerald" />
            <KpiCard label="Acceptance Rate" value={`${acceptanceRate}%`} />
            <KpiCard label="Reviewers" value={reviewerStats.length} />
          </div>

          {/* Charts — client component */}
          <AnalyticsCharts
            funnelData={funnelData}
            timelineData={timelineData}
            stageDistData={stageDistData}
          />

          {/* Reviewer Stats Table */}
          {reviewerStats.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-stone-900 mb-3">Reviewer Performance</h2>
              <Card>
                <CardContent className="p-0">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-4 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-xs font-medium text-stone-500">
                    <span>Reviewer</span>
                    <span className="text-right">Reviews</span>
                    <span className="text-right">Avg Score</span>
                    <span>Recommendations</span>
                  </div>

                  {reviewerStats.map((rv, i) => (
                    <div key={rv.id}>
                      {i > 0 && <Separator />}
                      <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-4 items-center px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarFallback className="text-xs bg-stone-200 text-stone-700">
                              {rv.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-stone-900 truncate">{rv.name}</span>
                        </div>
                        <span className="text-sm font-medium text-stone-700 text-right">
                          {rv.count}
                        </span>
                        <span className="text-sm text-stone-700 text-right">
                          {rv.avgScore != null ? rv.avgScore.toFixed(1) : '—'}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(rv.recommendations).map(([rec, count]) => (
                            <Badge
                              key={rec}
                              className={`text-xs ${RECOMMENDATION_COLORS[rec] ?? ''}`}
                            >
                              {RECOMMENDATION_LABELS[rec] ?? rec}: {count}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          )}

          {/* Stage Completion Rates */}
          {stages && stages.length > 0 && totalApps > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-stone-900 mb-3">
                Stage Completion Rates
              </h2>
              <Card>
                <CardContent className="p-4 space-y-3">
                  {stages.map((stage) => {
                    const count = stageCounts[stage.id] ?? 0
                    const pct = Math.round((count / totalApps) * 100)
                    return (
                      <div key={stage.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-stone-700">{stage.name}</span>
                          <span className="text-sm font-medium text-stone-900">
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                          <div
                            className="h-2 bg-stone-700 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function KpiCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string | number
  highlight?: 'emerald'
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-stone-500 mb-1">{label}</p>
        <p
          className={`text-2xl font-semibold ${
            highlight === 'emerald' ? 'text-emerald-600' : 'text-stone-900'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
