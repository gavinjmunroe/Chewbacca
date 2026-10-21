'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Send, Users, Clock, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Message, Stage } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDateTime, getFullName, APPLICATION_STATUS_LABELS } from '@/lib/utils'

type RecipientType = 'all' | 'stage' | 'status' | 'individual'

interface ApplicantOption {
  applicationId: string
  name: string
  email: string
  label: string
}

const STATUSES = [
  'submitted',
  'under_review',
  'advancing',
  'accepted',
  'waitlisted',
  'rejected',
]

export default function MessagesPage() {
  const params = useParams()
  const orgSlug = params.orgSlug as string
  const cycleId = params.cycleId as string
  const supabase = createClient()

  const [messages, setMessages] = React.useState<Message[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [applicants, setApplicants] = React.useState<ApplicantOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [selectedMessage, setSelectedMessage] = React.useState<Message | null>(null)

  // Compose state
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [recipientType, setRecipientType] = React.useState<RecipientType>('all')
  const [recipientFilter, setRecipientFilter] = React.useState<string>('')
  const [applicantSearch, setApplicantSearch] = React.useState('')
  const [previewCount, setPreviewCount] = React.useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)

  React.useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId])

  const loadData = async () => {
    setLoading(true)
    const [{ data: messagesData }, { data: stagesData }, { data: appsData }] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('sent_at', { ascending: false }),
      supabase
        .from('stages')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('stage_order', { ascending: true }),
      (supabase as any)
        .from('applications')
        .select('id, profiles(first_name, last_name, email)')
        .eq('cycle_id', cycleId)
        .neq('status', 'draft')
        .neq('status', 'withdrawn'),
    ])
    setMessages(messagesData ?? [])
    setStages(stagesData ?? [])

    const opts: ApplicantOption[] = (appsData ?? []).map((a: any) => {
      const p = a.profiles
      const name = getFullName(p?.first_name ?? null, p?.last_name ?? null)
      const email = p?.email ?? ''
      return {
        applicationId: a.id,
        name,
        email,
        label: name || email,
      }
    })
    setApplicants(opts)
    setLoading(false)
  }

  const computeRecipientCount = React.useCallback(async () => {
    if (recipientType === 'individual') {
      setPreviewCount(recipientFilter ? 1 : 0)
      return
    }

    setPreviewLoading(true)
    let query = (supabase as any)
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_id', cycleId)
      .neq('status', 'draft')
      .neq('status', 'withdrawn')

    if (recipientType === 'stage' && recipientFilter) {
      query = query.eq('current_stage_id', recipientFilter)
    } else if (recipientType === 'status' && recipientFilter) {
      query = query.eq('status', recipientFilter)
    }

    const { count } = await query
    setPreviewCount(count ?? 0)
    setPreviewLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientType, recipientFilter, cycleId])

  React.useEffect(() => {
    computeRecipientCount()
  }, [computeRecipientCount])

  const handleSend = async () => {
    if (!subject.trim()) {
      toast.error('Subject is required')
      return
    }
    if (!body.trim()) {
      toast.error('Message body is required')
      return
    }

    setSending(true)

    const rf: Record<string, unknown> = {}
    if (recipientType === 'stage' && recipientFilter) rf.stage_id = recipientFilter
    if (recipientType === 'status' && recipientFilter) rf.status = recipientFilter
    if (recipientType === 'individual' && recipientFilter) rf.application_id = recipientFilter

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cycle_id: cycleId,
        subject,
        body,
        recipient_type: recipientType,
        recipient_filter: rf,
      }),
    })

    if (!res.ok) {
      toast.error('Failed to send message')
    } else {
      toast.success('Message sent!')
      setSubject('')
      setBody('')
      setRecipientType('all')
      setRecipientFilter('')
      setApplicantSearch('')
      await loadData()
    }
    setSending(false)
  }

  const filteredApplicants = React.useMemo(() => {
    if (!applicantSearch.trim()) return applicants
    const q = applicantSearch.toLowerCase()
    return applicants.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    )
  }, [applicants, applicantSearch])

  const selectedApplicant = applicants.find((a) => a.applicationId === recipientFilter)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-stone-400">Loading messages...</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex">
      {/* Left: Message history */}
      <div className="w-80 shrink-0 border-r border-stone-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-stone-200">
          <h2 className="text-sm font-semibold text-stone-900">Sent Messages</h2>
          <p className="text-xs text-stone-400 mt-0.5">{messages.length} total</p>
        </div>

        <ScrollArea className="flex-1">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Send className="h-8 w-8 text-stone-200 mb-2" />
              <p className="text-xs text-stone-400">No messages sent yet</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {messages.map((msg) => (
                <button
                  key={msg.id}
                  onClick={() => setSelectedMessage(selectedMessage?.id === msg.id ? null : msg)}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors',
                    selectedMessage?.id === msg.id && 'bg-stone-50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className="text-sm font-medium text-stone-900 truncate flex-1">
                      {msg.subject}
                    </p>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {msg.recipient_count}
                    </Badge>
                  </div>
                  <p className="text-xs text-stone-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(msg.sent_at)}
                  </p>
                  <p className="text-xs text-stone-500 mt-0.5 capitalize">
                    To: {msg.recipient_type === 'all' ? 'All applicants' : msg.recipient_type}
                  </p>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Selected message preview */}
        {selectedMessage && (
          <div className="border-t border-stone-200 bg-stone-50 p-4">
            <p className="text-xs font-semibold text-stone-700 mb-1">{selectedMessage.subject}</p>
            <p className="text-xs text-stone-500 whitespace-pre-wrap line-clamp-6">
              {selectedMessage.body}
            </p>
          </div>
        )}
      </div>

      {/* Right: Compose panel */}
      <div className="flex-1 overflow-y-auto bg-stone-50">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Compose Message</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              Send emails to applicants in this cycle
            </p>
          </div>

          {/* Recipients */}
          <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
            <Label className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Recipients
            </Label>

            <div className="grid grid-cols-2 gap-3">
              {(['all', 'stage', 'status', 'individual'] as RecipientType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setRecipientType(type)
                    setRecipientFilter('')
                    setApplicantSearch('')
                  }}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm text-left border transition-colors',
                    recipientType === type
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-200 text-stone-700 hover:border-stone-400'
                  )}
                >
                  {type === 'all' && 'All Applicants'}
                  {type === 'stage' && 'By Stage'}
                  {type === 'status' && 'By Status'}
                  {type === 'individual' && 'Individual'}
                </button>
              ))}
            </div>

            {/* Filter options */}
            {recipientType === 'stage' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">Select Stage</Label>
                <Select value={recipientFilter} onValueChange={setRecipientFilter}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Choose a stage..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {recipientType === 'status' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">Select Status</Label>
                <Select value={recipientFilter} onValueChange={setRecipientFilter}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Choose a status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {APPLICATION_STATUS_LABELS[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {recipientType === 'individual' && (
              <div className="space-y-2">
                <Label className="text-xs text-stone-500">Search Applicant</Label>
                {selectedApplicant ? (
                  <div className="flex items-center justify-between rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-stone-900">{selectedApplicant.name}</p>
                      <p className="text-xs text-stone-400">{selectedApplicant.email}</p>
                    </div>
                    <button
                      onClick={() => { setRecipientFilter(''); setApplicantSearch('') }}
                      className="text-xs text-stone-400 hover:text-stone-700 ml-2"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                      <Input
                        value={applicantSearch}
                        onChange={(e) => setApplicantSearch(e.target.value)}
                        placeholder="Search by name or email..."
                        className="text-sm pl-8"
                      />
                    </div>
                    {applicantSearch && (
                      <div className="border border-stone-200 rounded-md bg-white max-h-40 overflow-y-auto">
                        {filteredApplicants.length === 0 ? (
                          <p className="text-xs text-stone-400 px-3 py-2 text-center">No applicants found</p>
                        ) : (
                          filteredApplicants.slice(0, 10).map((a) => (
                            <button
                              key={a.applicationId}
                              onClick={() => {
                                setRecipientFilter(a.applicationId)
                                setApplicantSearch('')
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-stone-50 transition-colors"
                            >
                              <p className="text-sm text-stone-900">{a.name || 'Unnamed'}</p>
                              <p className="text-xs text-stone-400">{a.email}</p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Preview count */}
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
              previewCount === 0 ? 'bg-red-50 text-red-600' : 'bg-stone-50 text-stone-600'
            )}>
              <Users className="h-4 w-4" />
              {previewLoading ? (
                <span className="text-stone-400">Calculating...</span>
              ) : (
                <span>
                  <strong>{previewCount ?? '—'}</strong>{' '}
                  recipient{previewCount !== 1 ? 's' : ''} will receive this message
                </span>
              )}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-sm font-medium">
              Subject
            </Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Application Update from Trojan Consulting Group"
              className="text-sm"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label htmlFor="body" className="text-sm font-medium">
              Message
            </Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Dear applicant,&#10;&#10;Thank you for your application..."
              className="text-sm resize-none"
            />
            <p className="text-xs text-stone-400">
              Available variables: {'{applicant_name}'}, {'{org_name}'}, {'{cycle_name}'}
            </p>
          </div>

          {/* Send button */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setSubject('')
                setBody('')
              }}
            >
              Clear
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || !subject.trim() || !body.trim() || previewCount === 0}
            >
              <Send className="h-4 w-4 mr-1.5" />
              {sending
                ? 'Sending...'
                : `Send to ${previewCount ?? '—'} recipient${previewCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
