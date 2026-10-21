import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Calendar, Users, Globe, ArrowRight, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, formatDate, getInitials, ORG_CATEGORIES, CYCLE_STATUS_LABELS, CYCLE_STATUS_COLORS } from '@/lib/utils'
import type { Organization, Cycle } from '@/types/database'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('organizations')
    .select('name, description')
    .eq('slug', orgSlug)
    .single()

  const d = data as unknown as { name: string; description: string | null } | null
  if (!d) return { title: 'Organization — Marrow' }
  return {
    title: `${d.name} — Marrow`,
    description: d.description ?? undefined,
  }
}

export default async function OrgPublicPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  // Load org
  const { data: orgRaw } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', orgSlug)
    .eq('is_active', true)
    .single()

  if (!orgRaw) notFound()
  const org = orgRaw as unknown as Organization

  // Load active cycles
  const { data: cyclesRaw } = await supabase
    .from('cycles')
    .select('*')
    .eq('org_id', org.id)
    .eq('status', 'active')
    .eq('is_public', true)
    .order('application_close_at', { ascending: true })
  const cycles = (cyclesRaw ?? []) as unknown as Cycle[]

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Check which cycles user already applied to
  const appliedCycleIds = new Set<string>()
  if (user) {
    const { data: existingApps } = await supabase
      .from('applications')
      .select('cycle_id')
      .eq('applicant_id', user.id)
      .in('cycle_id', cycles.map((c) => c.id))

    for (const a of (existingApps ?? []) as any[]) appliedCycleIds.add(a.cycle_id)
  }

  const categoryLabel =
    ORG_CATEGORIES.find((c) => c.value === org.category)?.label ?? org.category

  return (
    <div className="min-h-screen bg-white">
      {/* Cover image */}
      <div className="relative h-56 w-full bg-stone-100 overflow-hidden">
        {org.cover_url ? (
          <Image
            src={org.cover_url}
            alt={`${org.name} cover`}
            fill
            className="object-cover"
            priority
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-stone-200 to-stone-300" />
        )}
      </div>

      <div className="mx-auto max-w-4xl px-4">
        {/* Org header */}
        <div className="relative -mt-10 mb-6 flex items-end justify-between gap-4">
          <div className="flex items-end gap-4">
            <Avatar className="h-20 w-20 border-4 border-white shadow-md">
              {org.logo_url && <AvatarImage src={org.logo_url} alt={org.name} />}
              <AvatarFallback className="text-xl font-bold bg-stone-900 text-white">
                {getInitials(org.name.split(' ')[0] ?? null, org.name.split(' ')[1] ?? null)}
              </AvatarFallback>
            </Avatar>
          </div>

          {org.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-1 flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors"
            >
              <Globe className="h-4 w-4" />
              Website
            </a>
          )}
        </div>

        <div className="mb-8 space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-stone-900">{org.name}</h1>
            {org.is_verified && (
              <Badge variant="success" className="text-xs">Verified</Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {categoryLabel && (
              <Badge variant="secondary">{categoryLabel}</Badge>
            )}
            {org.school && (
              <span className="text-sm text-stone-500">{org.school}</span>
            )}
          </div>

          {org.description && (
            <p className="text-stone-600 text-sm leading-relaxed max-w-2xl">
              {org.description}
            </p>
          )}
        </div>

        {/* Active cycles */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">
            Active Recruiting Cycles
          </h2>

          {(cycles?.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-6 py-10 text-center">
              <p className="text-stone-400 text-sm">
                No active cycles right now. Check back soon or follow this organization for updates.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(cycles ?? []).map((cycle) => {
                const alreadyApplied = appliedCycleIds.has(cycle.id)
                const isDeadlineSoon =
                  cycle.application_close_at &&
                  new Date(cycle.application_close_at).getTime() - Date.now() <
                    7 * 24 * 60 * 60 * 1000

                return (
                  <Card
                    key={cycle.id}
                    className="hover:border-stone-400 transition-colors group"
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-stone-900 group-hover:text-stone-700 transition-colors">
                          {cycle.name}
                        </h3>
                        {alreadyApplied && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Applied
                          </span>
                        )}
                      </div>

                      {cycle.description && (
                        <p className="text-sm text-stone-500 line-clamp-3 leading-relaxed">
                          {cycle.description}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-400">
                        {cycle.application_close_at && (
                          <span
                            className={cn(
                              'flex items-center gap-1',
                              isDeadlineSoon && 'text-amber-600 font-medium'
                            )}
                          >
                            <Calendar className="h-3 w-3" />
                            Deadline: {formatDate(cycle.application_close_at)}
                          </span>
                        )}
                        {cycle.target_class_size && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {cycle.target_class_size} spots
                          </span>
                        )}
                      </div>

                      <div className="pt-1">
                        {alreadyApplied ? (
                          <Button variant="outline" size="sm" asChild className="w-full">
                            <Link href={`/apply/${orgSlug}/${cycle.id}`}>
                              View Application
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        ) : (
                          <Button size="sm" asChild className="w-full">
                            <Link href={`/apply/${orgSlug}/${cycle.id}`}>
                              Apply Now
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* About section */}
        {org.description && (
          <section className="mb-12 border-t border-stone-100 pt-8">
            <h2 className="text-lg font-semibold text-stone-900 mb-3">About</h2>
            <div className="prose prose-stone prose-sm max-w-none text-stone-600 leading-relaxed whitespace-pre-wrap">
              {org.description}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
