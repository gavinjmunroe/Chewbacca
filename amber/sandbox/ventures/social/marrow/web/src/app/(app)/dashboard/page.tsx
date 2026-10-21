import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Calendar, Clock, ArrowRight, Building2, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  cn,
  formatDate,
  timeAgo,
  getInitials,
  getFullName,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from '@/lib/utils'
import type { ApplicationWithDetails } from '@/types/database'

export const metadata = {
  title: 'Dashboard — Marrow',
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fetch applications with org and cycle data
  const { data: applications } = await supabase
    .from('applications')
    .select(`
      *,
      cycles (
        *,
        organizations (*)
      ),
      stages (*)
    `)
    .eq('applicant_id', user.id)
    .order('updated_at', { ascending: false })

  // Fetch recent activity history (last 10 events)
  const { data: recentActivity } = await supabase
    .from('application_stage_history')
    .select(`
      *,
      applications!inner (
        id,
        cycles (
          name,
          organizations ( name )
        )
      )
    `)
    .eq('applications.applicant_id', user.id)
    .order('moved_at', { ascending: false })
    .limit(10)

  // Fetch upcoming RSVP'd events
  const now = new Date().toISOString()
  const { data: upcomingRsvps } = await supabase
    .from('event_rsvps')
    .select(`
      *,
      events (
        *,
        cycles (
          name,
          organizations ( name )
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'attending')
    .gte('events.starts_at', now)
    .order('events.starts_at', { ascending: true })
    .limit(5)

  const activeApplications = (applications ?? []).filter(
    (a) => a.status !== 'withdrawn' && a.status !== 'rejected'
  )
  const firstName = profile?.first_name ?? user.email?.split('@')[0] ?? 'there'

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="rounded-xl bg-stone-900 px-6 py-8 text-white">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-stone-300 text-sm">
          {activeApplications.length > 0
            ? `You have ${activeApplications.length} active application${activeApplications.length !== 1 ? 's' : ''}.`
            : 'Start exploring organizations to find your next opportunity.'}
        </p>
        {activeApplications.length === 0 && (
          <Button className="mt-4 bg-white text-stone-900 hover:bg-stone-100" asChild>
            <Link href="/explore">
              Explore Organizations
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Applications — takes 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900">My Applications</h2>
            {(applications?.length ?? 0) > 0 && (
              <Link
                href="/explore"
                className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-0.5 transition-colors"
              >
                Explore more <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {(applications?.length ?? 0) === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Building2 className="h-10 w-10 text-stone-300 mb-3" />
                <p className="font-medium text-stone-700">No applications yet</p>
                <p className="text-sm text-stone-400 mt-1 mb-4">
                  Browse organizations and apply to cycles that interest you.
                </p>
                <Button variant="outline" asChild>
                  <Link href="/explore">Explore Organizations</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(applications ?? []).map((app) => {
                const cycle = app.cycles as any
                const org = cycle?.organizations as any
                const stage = app.stages as any
                const statusLabel = APPLICATION_STATUS_LABELS[app.status] ?? app.status
                const statusColor = APPLICATION_STATUS_COLORS[app.status] ?? ''

                return (
                  <Card key={app.id} className="hover:border-stone-300 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-10 w-10 shrink-0">
                          {org?.logo_url && <AvatarImage src={org.logo_url} alt={org.name} />}
                          <AvatarFallback className="bg-stone-100 text-stone-600 text-xs font-semibold">
                            {getInitials(
                              org?.name?.split(' ')[0] ?? null,
                              org?.name?.split(' ')[1] ?? null
                            )}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-stone-900 leading-tight">
                                {org?.name ?? '—'}
                              </p>
                              <p className="text-sm text-stone-500 mt-0.5">
                                {cycle?.name ?? '—'}
                              </p>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                statusColor
                              )}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 mt-2">
                            {stage && (
                              <span className="text-xs text-stone-400">
                                Stage: {stage.name}
                              </span>
                            )}
                            <span className="text-xs text-stone-400">
                              Updated {timeAgo(app.updated_at)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/apply/${cycle?.organizations?.slug}/${app.cycle_id}`}>
                            View Application
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Sidebar: activity + events */}
        <div className="space-y-6">
          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-stone-400" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(recentActivity?.length ?? 0) === 0 ? (
                <p className="text-xs text-stone-400 text-center py-4">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {(recentActivity ?? []).map((event, i) => {
                    const app = event.applications as any
                    const org = app?.cycles?.organizations
                    return (
                      <div key={event.id}>
                        {i > 0 && <Separator className="my-3" />}
                        <div className="text-xs space-y-0.5">
                          <p className="font-medium text-stone-700">
                            {org?.name ?? 'Organization'}
                          </p>
                          <p className="text-stone-500">
                            {event.to_status
                              ? `Status: ${APPLICATION_STATUS_LABELS[event.to_status] ?? event.to_status}`
                              : event.note ?? 'Application updated'}
                          </p>
                          <p className="text-stone-400">{timeAgo(event.moved_at)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-stone-400" />
                Upcoming Events
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(upcomingRsvps?.length ?? 0) === 0 ? (
                <p className="text-xs text-stone-400 text-center py-4">
                  No upcoming events.
                </p>
              ) : (
                <div className="space-y-3">
                  {(upcomingRsvps ?? []).map((rsvp, i) => {
                    const event = rsvp.events as any
                    const org = event?.cycles?.organizations
                    return (
                      <div key={rsvp.id}>
                        {i > 0 && <Separator className="my-3" />}
                        <div className="text-xs space-y-0.5">
                          <p className="font-medium text-stone-700">{event?.name}</p>
                          <p className="text-stone-500">{org?.name}</p>
                          <p className="text-stone-400">
                            {formatDate(event?.starts_at)}
                          </p>
                          {event?.location && (
                            <p className="text-stone-400">{event.location}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
