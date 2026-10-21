'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Search,
  Download,
  LayoutList,
  LayoutGrid,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  Filter,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Application, Profile, Stage } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  cn,
  formatDate,
  getInitials,
  getFullName,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from '@/lib/utils'

interface AppWithProfile extends Application {
  profiles: Profile
  stages: Stage | null
  avg_score?: number | null
}

type SortField = 'name' | 'submitted_at' | 'status'
type SortDir = 'asc' | 'desc'

const STATUSES = [
  'submitted',
  'under_review',
  'advancing',
  'accepted',
  'waitlisted',
  'rejected',
]

const KANBAN_STATUSES = ['submitted', 'under_review', 'advancing', 'accepted', 'rejected']

export default function ApplicantsPage() {
  const params = useParams()
  const router = useRouter()
  const orgSlug = params.orgSlug as string
  const cycleId = params.cycleId as string
  const supabase = createClient()

  const [applications, setApplications] = React.useState<AppWithProfile[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [loading, setLoading] = React.useState(true)
  const [viewMode, setViewMode] = React.useState<'list' | 'kanban'>('list')
  const [search, setSearch] = React.useState('')
  const [filterStatus, setFilterStatus] = React.useState<string>('all')
  const [filterStage, setFilterStage] = React.useState<string>('all')
  const [sortField, setSortField] = React.useState<SortField>('submitted_at')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = React.useState('')
  const [bulkLoading, setBulkLoading] = React.useState(false)
  const [activeStageTab, setActiveStageTab] = React.useState('all')

  React.useEffect(() => {
    loadData()
  }, [cycleId])

  const loadData = async () => {
    setLoading(true)
    const [{ data: appsData }, { data: stagesData }] = await Promise.all([
      supabase
        .from('applications')
        .select('*, profiles(*), stages(*)')
        .eq('cycle_id', cycleId),
      supabase
        .from('stages')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('stage_order', { ascending: true }),
    ])

    setStages(stagesData ?? [])
    setApplications((appsData as AppWithProfile[]) ?? [])
    setLoading(false)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredApps = React.useMemo(() => {
    let apps = [...applications]

    if (search) {
      const q = search.toLowerCase()
      apps = apps.filter((a) => {
        const name = getFullName(a.profiles?.first_name, a.profiles?.last_name).toLowerCase()
        const school = (a.profiles?.school ?? '').toLowerCase()
        return name.includes(q) || school.includes(q)
      })
    }

    if (filterStatus !== 'all') {
      apps = apps.filter((a) => a.status === filterStatus)
    }

    if (filterStage !== 'all') {
      apps = apps.filter((a) => a.current_stage_id === filterStage)
    }

    if (activeStageTab !== 'all') {
      apps = apps.filter((a) => a.current_stage_id === activeStageTab)
    }

    apps.sort((a, b) => {
      let valA: string | number = ''
      let valB: string | number = ''

      if (sortField === 'name') {
        valA = getFullName(a.profiles?.first_name, a.profiles?.last_name)
        valB = getFullName(b.profiles?.first_name, b.profiles?.last_name)
      } else if (sortField === 'submitted_at') {
        valA = a.submitted_at ?? ''
        valB = b.submitted_at ?? ''
      } else if (sortField === 'status') {
        valA = a.status
        valB = b.status
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return apps
  }, [applications, search, filterStatus, filterStage, sortField, sortDir, activeStageTab])

  const toggleSelect = (id: string) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const toggleSelectAll = () => {
    if (selected.size === filteredApps.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredApps.map((a) => a.id)))
    }
  }

  const applyBulkStatus = async () => {
    if (!bulkStatus || selected.size === 0) return
    setBulkLoading(true)

    const { error } = await supabase
      .from('applications')
      .update({ status: bulkStatus as Application['status'] })
      .in('id', Array.from(selected))

    if (error) {
      toast.error('Failed to update statuses')
    } else {
      toast.success(`Updated ${selected.size} application${selected.size !== 1 ? 's' : ''}`)
      setSelected(new Set())
      setBulkStatus('')
      await loadData()
    }
    setBulkLoading(false)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ChevronUp className="h-3 w-3 text-stone-300 inline" />
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3 text-stone-600 inline" />
    ) : (
      <ChevronDown className="h-3 w-3 text-stone-600 inline" />
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-stone-400">Loading applicants...</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push(`/admin/${orgSlug}/cycles/${cycleId}`)}
              className="text-xs text-stone-400 hover:text-stone-600 mb-2 flex items-center gap-1"
            >
              ← Cycle Overview
            </button>
            <h1 className="text-xl font-semibold text-stone-900">Applicants</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              {applications.length} total · {filteredApps.length} shown
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/export/${cycleId}?format=csv`} download>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export CSV
              </a>
            </Button>
            <div className="flex items-center border border-stone-200 rounded-md">
              <button
                className={cn(
                  'px-2.5 py-1.5 rounded-l-md text-sm',
                  viewMode === 'list' ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50'
                )}
                onClick={() => setViewMode('list')}
              >
                <LayoutList className="h-4 w-4" />
              </button>
              <button
                className={cn(
                  'px-2.5 py-1.5 rounded-r-md text-sm border-l border-stone-200',
                  viewMode === 'kanban'
                    ? 'bg-stone-900 text-white'
                    : 'text-stone-500 hover:bg-stone-50'
                )}
                onClick={() => setViewMode('kanban')}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Stage filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveStageTab('all')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap',
              activeStageTab === 'all'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            )}
          >
            All Stages
          </button>
          {stages.map((stage) => (
            <button
              key={stage.id}
              onClick={() => setActiveStageTab(stage.id)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap',
                activeStageTab === stage.id
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              )}
            >
              {stage.name}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or school..."
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-sm w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {APPLICATION_STATUS_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStage} onValueChange={setFilterStage}>
            <SelectTrigger className="h-8 text-sm w-40">
              <SelectValue placeholder="Filter stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-lg">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="h-7 text-xs w-36 bg-stone-700 border-stone-600 text-white">
                <SelectValue placeholder="Set status..." />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {APPLICATION_STATUS_LABELS[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={applyBulkStatus}
              disabled={!bulkStatus || bulkLoading}
            >
              Apply
            </Button>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-stone-400 hover:text-white text-xs"
            >
              Clear
            </button>
          </div>
        )}

        {/* LIST VIEW */}
        {viewMode === 'list' && (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden space-y-2">
              {filteredApps.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-400">No applicants match your filters</div>
              ) : (
                filteredApps.map((app) => {
                  const profile = app.profiles
                  const name = getFullName(profile?.first_name, profile?.last_name)
                  const initials = getInitials(profile?.first_name, profile?.last_name)
                  const statusLabel = APPLICATION_STATUS_LABELS[app.status] ?? app.status
                  const statusColor = APPLICATION_STATUS_COLORS[app.status] ?? ''
                  const stage = stages.find((s) => s.id === app.current_stage_id)
                  return (
                    <div
                      key={app.id}
                      onClick={() => router.push(`/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 bg-white active:bg-stone-50 cursor-pointer"
                    >
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs bg-stone-200 text-stone-700">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">{name || '—'}</p>
                        <p className="text-xs text-stone-400 truncate">{profile?.school ?? '—'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge className={`text-xs ${statusColor}`}>{statusLabel}</Badge>
                        <span className="text-xs text-stone-400">{stage?.name ?? '—'}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block rounded-lg border border-stone-200 overflow-hidden bg-white">
            {/* Table header */}
            <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_1fr_2.5rem] items-center gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-xs font-medium text-stone-500">
              <Checkbox
                checked={selected.size === filteredApps.length && filteredApps.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <button
                className="flex items-center gap-1 text-left hover:text-stone-900"
                onClick={() => handleSort('name')}
              >
                Name <SortIcon field="name" />
              </button>
              <span>School</span>
              <button
                className="flex items-center gap-1 text-left hover:text-stone-900"
                onClick={() => handleSort('status')}
              >
                Status <SortIcon field="status" />
              </button>
              <span>Stage</span>
              <button
                className="flex items-center gap-1 text-left hover:text-stone-900"
                onClick={() => handleSort('submitted_at')}
              >
                Submitted <SortIcon field="submitted_at" />
              </button>
              <span />
            </div>

            {filteredApps.length === 0 ? (
              <div className="py-12 text-center text-sm text-stone-400">
                No applicants match your filters
              </div>
            ) : (
              filteredApps.map((app) => {
                const profile = app.profiles
                const name = getFullName(profile?.first_name, profile?.last_name)
                const initials = getInitials(profile?.first_name, profile?.last_name)
                const statusLabel = APPLICATION_STATUS_LABELS[app.status] ?? app.status
                const statusColor = APPLICATION_STATUS_COLORS[app.status] ?? ''
                const stage = stages.find((s) => s.id === app.current_stage_id)

                return (
                  <div
                    key={app.id}
                    className={cn(
                      'grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_1fr_2.5rem] items-center gap-2 px-4 py-3 border-b border-stone-100 last:border-0 hover:bg-stone-50 cursor-pointer transition-colors',
                      selected.has(app.id) && 'bg-stone-50'
                    )}
                    onClick={() =>
                      router.push(`/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`)
                    }
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(app.id)}
                        onCheckedChange={() => toggleSelect(app.id)}
                      />
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback className="text-xs bg-stone-200 text-stone-700">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-stone-900 truncate">{name}</span>
                    </div>
                    <span className="text-sm text-stone-500 truncate">
                      {profile?.school ?? '—'}
                    </span>
                    <Badge className={`text-xs w-fit ${statusColor}`}>{statusLabel}</Badge>
                    <span className="text-sm text-stone-500 truncate">
                      {stage?.name ?? '—'}
                    </span>
                    <span className="text-xs text-stone-400">
                      {app.submitted_at ? formatDate(app.submitted_at) : '—'}
                    </span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(
                                `/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`
                              )
                            }
                          >
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {STATUSES.filter((s) => s !== app.status).map((s) => (
                            <DropdownMenuItem
                              key={s}
                              onClick={async () => {
                                const { error } = await supabase
                                  .from('applications')
                                  .update({ status: s as Application['status'] })
                                  .eq('id', app.id)
                                if (!error) {
                                  toast.success('Status updated')
                                  await loadData()
                                }
                              }}
                            >
                              Move to {APPLICATION_STATUS_LABELS[s]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })
            )}
            </div>
          </>
        )}

        {/* KANBAN VIEW */}
        {viewMode === 'kanban' && (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {KANBAN_STATUSES.map((status) => {
              const colApps = filteredApps.filter((a) => a.status === status)
              const label = APPLICATION_STATUS_LABELS[status] ?? status
              const color = APPLICATION_STATUS_COLORS[status] ?? ''
              return (
                <div key={status} className="min-w-60 w-60 shrink-0">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Badge className={`text-xs ${color}`}>{label}</Badge>
                    <span className="text-xs text-stone-400">{colApps.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colApps.map((app) => {
                      const profile = app.profiles
                      const name = getFullName(profile?.first_name, profile?.last_name)
                      const initials = getInitials(profile?.first_name, profile?.last_name)
                      return (
                        <Card
                          key={app.id}
                          className="cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() =>
                            router.push(
                              `/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`
                            )
                          }
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs bg-stone-200 text-stone-700">
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium text-stone-900 truncate">
                                {name}
                              </span>
                            </div>
                            <p className="text-xs text-stone-400 truncate">
                              {profile?.school ?? '—'}
                            </p>
                            {app.avg_score != null && (
                              <p className="text-xs text-stone-500 mt-1">
                                Avg score: {app.avg_score.toFixed(1)}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                    {colApps.length === 0 && (
                      <div className="rounded-lg border-2 border-dashed border-stone-200 p-4 text-center text-xs text-stone-300">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
