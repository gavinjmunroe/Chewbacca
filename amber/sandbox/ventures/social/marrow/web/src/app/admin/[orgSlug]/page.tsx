import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/nav/sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { getInitials, getFullName } from '@/lib/utils'
import { Plus, Users, RefreshCw, BarChart3 } from 'lucide-react'
import { CycleCard } from './cycle-card'

interface PageProps {
  params: Promise<{ orgSlug: string }>
}

export default async function OrgDashboardPage({ params }: PageProps) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch org
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
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

  // Fetch cycles with application counts
  const { data: cycles } = await supabase
    .from('cycles')
    .select('*')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })

  // Fetch members with profiles
  const { data: members } = await supabase
    .from('org_members')
    .select('*, profiles(first_name, last_name, avatar_url, email)')
    .eq('org_id', org.id)
    .order('invited_at', { ascending: true })

  // Fetch application counts per cycle
  const cycleIds = cycles?.map((c) => c.id) ?? []
  const { data: appCounts } = cycleIds.length
    ? await supabase
        .from('applications')
        .select('cycle_id')
        .in('cycle_id', cycleIds)
    : { data: [] }

  const appCountByCycle: Record<string, number> = {}
  for (const app of appCounts ?? []) {
    appCountByCycle[app.cycle_id] = (appCountByCycle[app.cycle_id] ?? 0) + 1
  }

  const totalApplications = Object.values(appCountByCycle).reduce((a, b) => a + b, 0)
  const activeCycle = cycles?.find((c) => c.status === 'active')

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminSidebar orgSlug={orgSlug} orgName={org.name} orgLogoUrl={org.logo_url} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-stone-900">{org.name}</h1>
              <p className="text-sm text-stone-500 mt-0.5">
                {org.school && <span>{org.school} · </span>}
                {membership.role.charAt(0).toUpperCase() + membership.role.slice(1)}
              </p>
            </div>
            <Button asChild>
              <Link href={`/admin/${orgSlug}/cycles/new`}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Cycle
              </Link>
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Total Cycles"
              value={cycles?.length ?? 0}
              icon={<RefreshCw className="h-4 w-4 text-stone-400" />}
            />
            <StatCard
              label="Active Cycle"
              value={activeCycle ? activeCycle.name : 'None'}
              small={!activeCycle}
              icon={<BarChart3 className="h-4 w-4 text-stone-400" />}
            />
            <StatCard
              label="Total Applications"
              value={totalApplications}
              icon={<Users className="h-4 w-4 text-stone-400" />}
            />
            <StatCard
              label="Team Members"
              value={members?.length ?? 0}
              icon={<Users className="h-4 w-4 text-stone-400" />}
            />
          </div>

          {/* Cycles */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide">
                Recruiting Cycles
              </h2>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/${orgSlug}/cycles/new`}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Create Cycle
                </Link>
              </Button>
            </div>

            {!cycles?.length ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 text-stone-300 mb-3" />
                  <p className="text-sm font-medium text-stone-700">No recruiting cycles yet</p>
                  <p className="text-xs text-stone-400 mt-1 mb-4">
                    Create your first cycle to start recruiting
                  </p>
                  <Button size="sm" asChild>
                    <Link href={`/admin/${orgSlug}/cycles/new`}>Create your first cycle</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {cycles.map((cycle) => (
                  <CycleCard
                    key={cycle.id}
                    cycle={cycle}
                    orgSlug={orgSlug}
                    appCount={appCountByCycle[cycle.id] ?? 0}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Team */}
          <section>
            <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide mb-4">
              Team
            </h2>
            <Card>
              <CardContent className="p-0">
                {members?.map((member, i) => {
                  const profile = member.profiles as {
                    first_name: string | null
                    last_name: string | null
                    avatar_url: string | null
                    email: string | null
                  } | null
                  const name = getFullName(
                    profile?.first_name ?? null,
                    profile?.last_name ?? null
                  )
                  const initials = getInitials(
                    profile?.first_name ?? null,
                    profile?.last_name ?? null
                  )
                  return (
                    <div key={member.id}>
                      {i > 0 && <Separator />}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-stone-200 text-stone-700">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">{name}</p>
                          <p className="text-xs text-stone-400 truncate">{profile?.email}</p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">
                          {member.role}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  small,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  small?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-stone-500">{label}</p>
          {icon}
        </div>
        <p
          className={
            small
              ? 'text-sm font-medium text-stone-500'
              : 'text-2xl font-semibold text-stone-900'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

