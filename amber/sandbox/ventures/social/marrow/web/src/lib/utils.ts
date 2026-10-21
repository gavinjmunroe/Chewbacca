import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return format(d, 'MMM d, yyyy · h:mm a')
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return formatDistanceToNow(d, { addSuffix: true })
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getInitials(firstName: string | null, lastName: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() ?? ''
  const last = lastName?.charAt(0)?.toUpperCase() ?? ''
  return first + last || '?'
}

export function getFullName(firstName: string | null, lastName: string | null): string {
  if (firstName && lastName) return `${firstName} ${lastName}`
  return firstName || lastName || 'Unknown User'
}

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  advancing: 'Advancing',
  accepted: 'Accepted',
  waitlisted: 'Waitlisted',
  rejected: 'Not Selected',
  withdrawn: 'Withdrawn',
}

export const APPLICATION_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700',
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  advancing: 'bg-purple-100 text-purple-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  waitlisted: 'bg-orange-100 text-orange-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-stone-100 text-stone-500',
}

export const CYCLE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Open',
  paused: 'Paused',
  closed: 'Closed',
  archived: 'Archived',
}

export const CYCLE_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700',
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  closed: 'bg-stone-100 text-stone-600',
  archived: 'bg-stone-100 text-stone-400',
}

export const RECOMMENDATION_LABELS: Record<string, string> = {
  advance: 'Advance',
  reject: 'Reject',
  hold: 'Hold',
  undecided: 'Undecided',
}

export const RECOMMENDATION_COLORS: Record<string, string> = {
  advance: 'text-emerald-600 bg-emerald-50',
  reject: 'text-red-600 bg-red-50',
  hold: 'text-amber-600 bg-amber-50',
  undecided: 'text-stone-500 bg-stone-50',
}

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  resume: 'Resume',
  transcript: 'Transcript',
  portfolio: 'Portfolio',
  writing_sample: 'Writing Sample',
  other: 'Other',
}

export const ORG_CATEGORIES: { value: string; label: string }[] = [
  { value: 'consulting', label: 'Consulting' },
  { value: 'finance', label: 'Finance' },
  { value: 'tech', label: 'Technology' },
  { value: 'pre_med', label: 'Pre-Med / Healthcare' },
  { value: 'entrepreneurship', label: 'Entrepreneurship' },
  { value: 'law', label: 'Pre-Law' },
  { value: 'research', label: 'Research' },
  { value: 'media', label: 'Media & Journalism' },
  { value: 'arts', label: 'Arts & Culture' },
  { value: 'service', label: 'Community Service' },
  { value: 'social', label: 'Social / Greek Life' },
  { value: 'other', label: 'Other' },
]
