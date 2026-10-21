'use client'

import * as React from 'react'
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  Eye,
  Tag,
  UserX,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  cn,
  formatDate,
  getFullName,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from '@/lib/utils'
import type { Application, Profile, Stage } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApplicationRow = Application & {
  profiles: Profile
  stages: Stage | null
  score?: number | null
}

type SortField = 'name' | 'status' | 'stage' | 'score' | 'submitted_at' | 'school' | 'grad_year'
type SortDir = 'asc' | 'desc'

interface ApplicantTableProps {
  applications: ApplicationRow[]
  orgSlug: string
  cycleId: string
  onStatusChange?: (appId: string, status: string) => Promise<void>
  onSelect?: (selectedIds: string[]) => void
}

const APPLICATION_STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'advancing', label: 'Advancing' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'rejected', label: 'Not Selected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

// ── Sort helpers ──────────────────────────────────────────────────────────────

function SortIcon({ field, sort }: { field: SortField; sort: { field: SortField; dir: SortDir } }) {
  if (sort.field !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-stone-300" />
  return sort.dir === 'asc' ? (
    <ChevronUp className="h-3.5 w-3.5 text-stone-600" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5 text-stone-600" />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ApplicantTable({
  applications,
  orgSlug,
  cycleId,
  onStatusChange,
  onSelect,
}: ApplicantTableProps) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: 'submitted_at',
    dir: 'desc',
  })
  const [bulkStatus, setBulkStatus] = React.useState<string>('')

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleAll = () => {
    const allIds = applications.map((a) => a.id)
    const newSet = selected.size === allIds.length ? new Set<string>() : new Set(allIds)
    setSelected(newSet)
    onSelect?.(Array.from(newSet))
  }

  const toggleOne = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
    onSelect?.(Array.from(next))
  }

  // ── Sorting ────────────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    )
  }

  const sorted = React.useMemo(() => {
    return [...applications].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      switch (sort.field) {
        case 'name': {
          const nameA = getFullName(a.profiles?.first_name ?? null, a.profiles?.last_name ?? null)
          const nameB = getFullName(b.profiles?.first_name ?? null, b.profiles?.last_name ?? null)
          return nameA.localeCompare(nameB) * dir
        }
        case 'status':
          return (a.status ?? '').localeCompare(b.status ?? '') * dir
        case 'stage':
          return (a.stages?.name ?? '').localeCompare(b.stages?.name ?? '') * dir
        case 'score':
          return ((a.score ?? -1) - (b.score ?? -1)) * dir
        case 'submitted_at':
          return (
            new Date(a.submitted_at ?? 0).getTime() -
            new Date(b.submitted_at ?? 0).getTime()
          ) * dir
        case 'school':
          return (a.profiles?.school ?? '').localeCompare(b.profiles?.school ?? '') * dir
        case 'grad_year':
          return ((a.profiles?.graduation_year ?? 0) - (b.profiles?.graduation_year ?? 0)) * dir
        default:
          return 0
      }
    })
  }, [applications, sort])

  // ── Bulk action ────────────────────────────────────────────────────────────

  const applyBulkStatus = async () => {
    if (!bulkStatus || selected.size === 0 || !onStatusChange) return
    for (const id of selected) {
      await onStatusChange(id, bulkStatus)
    }
    setBulkStatus('')
  }

  // ── Column header helper ───────────────────────────────────────────────────

  function ColHeader({
    field,
    children,
    className,
  }: {
    field: SortField
    children: React.ReactNode
    className?: string
  }) {
    return (
      <th
        className={cn(
          'px-3 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:text-stone-700 transition-colors',
          className
        )}
        onClick={() => handleSort(field)}
      >
        <span className="flex items-center gap-1">
          {children}
          <SortIcon field={field} sort={sort} />
        </span>
      </th>
    )
  }

  const allSelected = applications.length > 0 && selected.size === applications.length

  return (
    <div className="space-y-0">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-t-lg border border-b-0 border-stone-200 bg-stone-900 px-4 py-3 text-white">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="h-8 w-44 bg-stone-800 border-stone-700 text-white text-xs">
                <SelectValue placeholder="Change status…" />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs bg-stone-700 text-white hover:bg-stone-600 border-0"
              disabled={!bulkStatus}
              onClick={applyBulkStatus}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-stone-300 hover:text-white hover:bg-stone-700"
              onClick={() => { setSelected(new Set()); onSelect?.([]) }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div
        className={cn(
          'overflow-x-auto border border-stone-200',
          selected.size > 0 ? 'rounded-b-xl' : 'rounded-xl'
        )}
      >
        <table className="w-full min-w-[900px] border-collapse bg-white">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <ColHeader field="name">Name</ColHeader>
              <ColHeader field="school">School</ColHeader>
              <ColHeader field="grad_year">Year</ColHeader>
              <ColHeader field="status">Status</ColHeader>
              <ColHeader field="stage">Stage</ColHeader>
              <ColHeader field="score" className="text-right">Score</ColHeader>
              <ColHeader field="submitted_at">Submitted</ColHeader>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-sm text-stone-400">
                  No applicants found.
                </td>
              </tr>
            )}
            {sorted.map((app) => {
              const profile = app.profiles
              const stage = app.stages
              const isSelected = selected.has(app.id)
              const statusColor = APPLICATION_STATUS_COLORS[app.status] ?? ''
              const statusLabel = APPLICATION_STATUS_LABELS[app.status] ?? app.status

              return (
                <tr
                  key={app.id}
                  className={cn(
                    'border-b border-stone-100 last:border-0 transition-colors',
                    isSelected ? 'bg-stone-50' : 'hover:bg-stone-50/70'
                  )}
                >
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(app.id)}
                      aria-label={`Select ${getFullName(profile?.first_name ?? null, profile?.last_name ?? null)}`}
                    />
                  </td>

                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`}
                      className="font-medium text-stone-900 hover:text-stone-600 transition-colors text-sm"
                    >
                      {getFullName(profile?.first_name ?? null, profile?.last_name ?? null)}
                    </Link>
                    {profile?.email && (
                      <p className="text-xs text-stone-400 mt-0.5 truncate max-w-[180px]">
                        {profile.email}
                      </p>
                    )}
                  </td>

                  <td className="px-3 py-3 text-sm text-stone-600">
                    {profile?.school ?? <span className="text-stone-300">—</span>}
                  </td>

                  <td className="px-3 py-3 text-sm text-stone-500">
                    {profile?.graduation_year ?? <span className="text-stone-300">—</span>}
                  </td>

                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
                        statusColor
                      )}
                    >
                      {statusLabel}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-sm text-stone-500">
                    {stage?.name ?? <span className="text-stone-300">—</span>}
                  </td>

                  <td className="px-3 py-3 text-right text-sm">
                    {app.score != null ? (
                      <span className="font-semibold text-stone-800">{app.score}</span>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>

                  <td className="px-3 py-3 text-sm text-stone-400 whitespace-nowrap">
                    {app.submitted_at ? formatDate(app.submitted_at) : (
                      <span className="text-stone-300">Draft</span>
                    )}
                  </td>

                  <td className="px-3 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4 text-stone-400" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/${orgSlug}/cycles/${cycleId}/applicants/${app.id}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Application
                          </Link>
                        </DropdownMenuItem>
                        {onStatusChange && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-emerald-600 focus:text-emerald-600 focus:bg-emerald-50"
                              onClick={() => onStatusChange(app.id, 'accepted')}
                            >
                              Accept
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-amber-600 focus:text-amber-600 focus:bg-amber-50"
                              onClick={() => onStatusChange(app.id, 'waitlisted')}
                            >
                              Waitlist
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 focus:bg-red-50"
                              onClick={() => onStatusChange(app.id, 'rejected')}
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
