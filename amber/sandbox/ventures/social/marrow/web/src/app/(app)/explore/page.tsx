import Link from 'next/link'
import { Search, Building2, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { getInitials, ORG_CATEGORIES } from '@/lib/utils'
import type { Organization, Cycle } from '@/types/database'

export const metadata = {
  title: 'Explore Organizations — Marrow',
}

type OrgWithCycles = Organization & {
  cycles: Pick<Cycle, 'id' | 'name' | 'status' | 'application_close_at'>[]
}

interface ExplorePageProps {
  searchParams: Promise<{ q?: string; category?: string }>
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const { q, category } = await searchParams
  const supabase = await createClient()

  // Build query: active orgs with active cycles
  let query = supabase
    .from('organizations')
    .select(`
      *,
      cycles (
        id,
        name,
        status,
        application_close_at
      )
    `)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (category) {
    query = query.eq('category', category)
  }

  const { data: orgs } = await query

  // Filter by search term client-side (small data set)
  const searchLower = q?.toLowerCase().trim() ?? ''
  const filtered: OrgWithCycles[] = (orgs ?? []).filter((org) => {
    const matchesSearch =
      !searchLower ||
      org.name.toLowerCase().includes(searchLower) ||
      org.description?.toLowerCase().includes(searchLower) ||
      org.school?.toLowerCase().includes(searchLower)

    const hasActiveCycles = (org.cycles ?? []).some((c) => c.status === 'active')
    return matchesSearch && hasActiveCycles
  })

  const categoryLabel =
    ORG_CATEGORIES.find((c) => c.value === category)?.label ?? null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Explore Organizations</h1>
        <p className="text-sm text-stone-500 mt-1">
          Discover clubs and organizations currently recruiting on campus.
        </p>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form className="flex-1 flex gap-2" method="GET">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search organizations..."
              className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-1 placeholder:text-stone-400"
            />
          </div>
          {/* Hidden category if set */}
          {category && <input type="hidden" name="category" value={category} />}
          <button
            type="submit"
            className="h-9 px-4 text-sm font-medium rounded-md bg-stone-900 text-white hover:bg-stone-800 transition-colors"
          >
            Search
          </button>
        </form>

        {/* Category Pills */}
        <div className="flex gap-2 flex-wrap">
          <Link
            href={q ? `/explore?q=${encodeURIComponent(q)}` : '/explore'}
            className={`h-9 px-3 text-sm rounded-md border transition-colors flex items-center ${
              !category
                ? 'bg-stone-900 text-white border-stone-900'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
            }`}
          >
            All
          </Link>
          {ORG_CATEGORIES.map((cat) => (
            <Link
              key={cat.value}
              href={`/explore?${q ? `q=${encodeURIComponent(q)}&` : ''}category=${cat.value}`}
              className={`h-9 px-3 text-sm rounded-md border transition-colors flex items-center whitespace-nowrap ${
                category === cat.value
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {cat.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center gap-2">
        <p className="text-sm text-stone-500">
          {filtered.length > 0
            ? `${filtered.length} organization${filtered.length !== 1 ? 's' : ''} currently recruiting`
            : 'No organizations found'}
          {categoryLabel && (
            <span className="ml-1">
              in <strong className="text-stone-700">{categoryLabel}</strong>
            </span>
          )}
          {q && (
            <span className="ml-1">
              matching <strong className="text-stone-700">&ldquo;{q}&rdquo;</strong>
            </span>
          )}
        </p>
        {(q || category) && (
          <Link
            href="/explore"
            className="text-xs text-stone-400 hover:text-stone-700 underline underline-offset-2"
          >
            Clear filters
          </Link>
        )}
      </div>

      {/* Org Grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-12 w-12 text-stone-300 mb-4" />
            {q || category ? (
              <>
                <p className="font-medium text-stone-700">No matches found</p>
                <p className="text-sm text-stone-400 mt-1">
                  No organizations match your search. Try different keywords or{' '}
                  <Link href="/explore" className="text-stone-600 underline underline-offset-2">clear your filters</Link>.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-stone-700">No organizations recruiting right now</p>
                <p className="text-sm text-stone-400 mt-1">
                  Check back soon — new recruiting cycles open throughout the year.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((org) => {
            const activeCycles = (org.cycles ?? []).filter((c) => c.status === 'active')
            const categoryLabel =
              ORG_CATEGORIES.find((c) => c.value === org.category)?.label ?? org.category

            return (
              <Card
                key={org.id}
                className="hover:border-stone-300 hover:shadow-md transition-all group"
              >
                <CardContent className="p-5 flex flex-col h-full">
                  {/* Org Header */}
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar className="h-12 w-12 rounded-lg shrink-0">
                      {org.logo_url && (
                        <AvatarImage src={org.logo_url} alt={org.name} className="object-cover" />
                      )}
                      <AvatarFallback className="rounded-lg bg-stone-100 text-stone-700 font-semibold text-sm">
                        {getInitials(
                          org.name.split(' ')[0] ?? null,
                          org.name.split(' ')[1] ?? null
                        )}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-stone-900 leading-tight truncate">
                        {org.name}
                      </p>
                      {org.school && (
                        <p className="text-xs text-stone-400 mt-0.5 truncate">{org.school}</p>
                      )}
                    </div>

                    {org.website && (
                      <a
                        href={org.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-stone-300 hover:text-stone-600 transition-colors shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  {/* Category */}
                  {categoryLabel && (
                    <Badge variant="secondary" className="w-fit text-xs mb-3">
                      {categoryLabel}
                    </Badge>
                  )}

                  {/* Description */}
                  {org.description && (
                    <p className="text-sm text-stone-500 line-clamp-2 mb-4 flex-1">
                      {org.description}
                    </p>
                  )}

                  {/* Active cycles */}
                  <div className="mt-auto space-y-2">
                    {activeCycles.slice(0, 2).map((cycle) => (
                      <Link
                        key={cycle.id}
                        href={`/apply/${org.slug}/${cycle.id}`}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors group/cycle"
                      >
                        <div>
                          <p className="text-xs font-medium text-stone-800">{cycle.name}</p>
                          {cycle.application_close_at && (
                            <p className="text-xs text-stone-400 mt-0.5">
                              Closes{' '}
                              {new Date(cycle.application_close_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                          )}
                        </div>
                        <Badge variant="success" className="text-xs shrink-0">
                          Open
                        </Badge>
                      </Link>
                    ))}

                    {activeCycles.length > 2 && (
                      <p className="text-xs text-stone-400 text-center">
                        +{activeCycles.length - 2} more cycle{activeCycles.length - 2 !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
