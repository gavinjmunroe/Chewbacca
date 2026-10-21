import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/nav/sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  formatDate,
  formatDateTime,
  timeAgo,
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_COLORS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from '@/lib/utils'
import { Users, Layers, Download, Play, Pause, X, BarChart3 } from 'lucide-react'
import { CycleActions } from './cycle-actions'

interface PageProps {
  params: Promise<{ orgSlug: string; cycleId: string }>
}

export default async function CycleOverviewPage({ params }: PageProps) {
  const { orgSlug, cycleId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch cycle with org
  const { data: cycle } = await supabase
    .from('cycles')
    .select('*, organizations(name, slug, logo_url)')
    .eq('id', cycleId)
    .single()

  if (!cycle) notFound()

  const org = cycle.organizations as { name: string; slug: string; logo_url: string | null }
  if (org.slug !== orgSlug) notFound()

  // Check membership
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgRow!.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  // Fetch applications with status counts
  const { data: applications } = await supabase
    .from('applications')
    .select('id, status, current_stage_id, submitted_at')
    .eq('cycle_id', cycleId)

  // Fetch stages
  const { data: stages } = await supabase
    .from('stages')
    .select('id, name, stage_type, stage_order')
    .eq('cycle_id', cycleId)
    .order('stage_order', { ascending: true })

  // Compute status breakdown
  const statusCounts: Record<string, number> = {}
  for (const app of applications ?? []) {
    statusCounts[app.status] = (statusCounts[app.status] ?? 0) + 1
  }

  // Stage distribution
  const stageCounts: Record<string, number> = {}
  for (const app of applications ?? []) {
    if (app.current_stage_id) {
      stageCounts[app.current_stage_id] = (stageCounts[app.current_stage_id] ?? 0) + 1
    }
  }

  const totalApplicants = applications?.length ?? 0

  // Recent activity: most recently submitted
  const recentApps = [...(applications ?? [])]
    .filter((a) => a.submitted_at)
    .sort((a, b) => new Date(b.submitted_at!).getTime() - new Date(a.submitted_at!).getTime())
    .slice(0, 5)

  const statusLabel = CYCLE_STATUS_LABELS[cycle.status] ?? cycle.status
  const statusColor = CYCLE_STATUS_COLORS[cycle.status] ?? ''

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminSidebar orgSlug={orgSlug} orgName={org.name} orgLogoUrl={org.logo_url} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-semibold text-stone-900">{cycle.name}</h1>
                <Badge className={`text-xs ${statusColor}`}>{statusLabel}</Badge>
              </div>
              {cycle.description && (
                <p className="text-sm text-stone-500">{cycle.description}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-400">
                {cycle.application_open_at && (
                  <span>Opens {formatDate(cycle.application_open_at)}</span>
                )}
                {cycle.application_close_at && (
                  <span>Closes {formatDate(cycle.application_close_at)}</span>
                )}
                {cycle.target_class_size && (
                  <span>Target: {cycle.target_class_size} members</span>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/api/export/${cycleId}?format=csv`} target="_blank">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export CSV
                </Link>
              </Button>
              <CycleActions cycleId={cycleId} currentStatus={cycle.status} orgSlug={orgSlug} />
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Recent Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-stone-500 mb-1">Total Applicants</p>
                    <p className="text-2xl font-semibold text-stone-900">{totalApplicants}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-stone-500 mb-1">Stages</p>
                    <p className="text-2xl font-semibold text-stone-900">{stages?.length ?? 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-stone-500 mb-1">Accepted</p>
                    <p className="text-2xl font-semibold text-emerald-600">
                      {statusCounts['accepted'] ?? 0}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-stone-500 mb-1">Under Review</p>
                    <p className="text-2xl font-semibold text-amber-600">
                      {statusCounts['under_review'] ?? 0}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Status Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {totalApplicants === 0 ? (
                    <p className="text-sm text-stone-400 py-4 text-center">
                      No applications yet
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(statusCounts).map(([status, count]) => {
                        const pct = totalApplicants > 0 ? (count / totalApplicants) * 100 : 0
                        const label = APPLICATION_STATUS_LABELS[status] ?? status
                        const colorClass = APPLICATION_STATUS_COLORS[status] ?? ''
                        return (
                          <div key={status} className="flex items-center gap-3">
                            <Badge className={`w-28 justify-center text-xs ${colorClass}`}>
                              {label}
                            </Badge>
                            <div className="flex-1 bg-stone-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-stone-400"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-stone-700 w-8 text-right">
                              {count}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Stage Distribution */}
              {stages && stages.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Stage Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {stages.map((stage) => {
                        const count = stageCounts[stage.id] ?? 0
                        const pct = totalApplicants > 0 ? (count / totalApplicants) * 100 : 0
                        return (
                          <div key={stage.id} className="flex items-center gap-3">
                            <span className="text-sm text-stone-700 w-40 truncate">
                              {stage.name}
                            </span>
                            <div className="flex-1 bg-stone-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-stone-600"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-stone-700 w-8 text-right">
                              {count}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quick Links */}
              <div className="grid grid-cols-3 gap-3">
                <QuickLink
                  href={`/admin/${orgSlug}/cycles/${cycleId}/stages`}
                  icon={<Layers className="h-5 w-5 text-stone-400" />}
                  label="Manage Stages"
                  description="Build your application pipeline"
                />
                <QuickLink
                  href={`/admin/${orgSlug}/cycles/${cycleId}/applicants`}
                  icon={<Users className="h-5 w-5 text-stone-400" />}
                  label="View Applicants"
                  description={`${totalApplicants} total`}
                />
                <QuickLink
                  href={`/admin/${orgSlug}/cycles/${cycleId}/analytics`}
                  icon={<BarChart3 className="h-5 w-5 text-stone-400" />}
                  label="Analytics"
                  description="Charts and insights"
                />
              </div>
            </TabsContent>

            <TabsContent value="activity" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Recent Submissions</CardTitle>
                </CardHeader>
                <CardContent>
                  {recentApps.length === 0 ? (
                    <p className="text-sm text-stone-400 py-4 text-center">
                      No submissions yet
                    </p>
                  ) : (
                    <div className="space-y-0">
                      {recentApps.map((app, i) => (
                        <div key={app.id}>
                          {i > 0 && <Separator />}
                          <div className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-2">
                              <Badge
                                className={`text-xs ${APPLICATION_STATUS_COLORS[app.status] ?? ''}`}
                              >
                                {APPLICATION_STATUS_LABELS[app.status] ?? app.status}
                              </Badge>
                              <span className="text-sm text-stone-700 font-mono text-xs">
                                #{app.id.slice(0, 8)}
                              </span>
                            </div>
                            <span className="text-xs text-stone-400">
                              {app.submitted_at ? timeAgo(app.submitted_at) : '—'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}

function QuickLink({
  href,
  icon,
  label,
  description,
}: {
  href: string
  icon: React.ReactNode
  label: string
  description: string
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-stone-400 hover:shadow-sm transition-all cursor-pointer h-full">
        <CardContent className="p-4 flex flex-col gap-2">
          {icon}
          <div>
            <p className="text-sm font-medium text-stone-900">{label}</p>
            <p className="text-xs text-stone-400 mt-0.5">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
