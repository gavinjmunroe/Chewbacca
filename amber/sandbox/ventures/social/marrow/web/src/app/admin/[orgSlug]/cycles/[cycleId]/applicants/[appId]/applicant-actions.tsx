'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X, Plus, Save, UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Application } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { APPLICATION_STATUS_LABELS } from '@/lib/utils'

const STATUSES: Application['status'][] = [
  'submitted',
  'under_review',
  'advancing',
  'accepted',
  'waitlisted',
  'rejected',
  'withdrawn',
]

interface Props {
  applicationId: string
  currentStatus: string
  currentStageId: string | null
  stages: { id: string; name: string }[]
  tags: string[]
  decisionNote: string | null
  cycleId: string
  orgSlug: string
  reviewers: { id: string; name: string }[]
  existingAssignments: { reviewerId: string; stageId: string }[]
}

export function ApplicantActionPanel({
  applicationId,
  currentStatus,
  currentStageId,
  stages,
  tags: initialTags,
  decisionNote: initialNote,
  cycleId,
  orgSlug,
  reviewers,
  existingAssignments,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [status, setStatus] = React.useState(currentStatus)
  const [stageId, setStageId] = React.useState(currentStageId ?? '')
  const [note, setNote] = React.useState(initialNote ?? '')
  const [tags, setTags] = React.useState<string[]>(initialTags)
  const [newTag, setNewTag] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [assignReviewerId, setAssignReviewerId] = React.useState('')
  const [assignStageId, setAssignStageId] = React.useState('')
  const [assigning, setAssigning] = React.useState(false)

  const saveStatus = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('applications')
      .update({
        status: status as Application['status'],
        decision_note: note || null,
      })
      .eq('id', applicationId)

    if (error) {
      toast.error('Failed to update status')
    } else {
      toast.success('Status updated')
      router.refresh()
    }
    setSaving(false)
  }

  const saveStage = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('applications')
      .update({ current_stage_id: stageId || null })
      .eq('id', applicationId)

    if (error) {
      toast.error('Failed to update stage')
    } else {
      toast.success('Stage updated')
      router.refresh()
    }
    setSaving(false)
  }

  const addTag = async () => {
    if (!newTag.trim()) return
    const trimmed = newTag.trim().toLowerCase()
    if (tags.includes(trimmed)) {
      setNewTag('')
      return
    }
    const newTags = [...tags, trimmed]
    const { error } = await supabase
      .from('applications')
      .update({ internal_tags: newTags })
      .eq('id', applicationId)

    if (error) {
      toast.error('Failed to add tag')
    } else {
      setTags(newTags)
      setNewTag('')
    }
  }

  const assignReviewer = async () => {
    if (!assignReviewerId || !assignStageId) return
    setAssigning(true)
    const { error } = await (supabase as any)
      .from('reviews')
      .insert({
        application_id: applicationId,
        stage_id: assignStageId,
        reviewer_id: assignReviewerId,
      })
    if (error) {
      toast.error('Failed to assign reviewer')
    } else {
      toast.success('Reviewer assigned')
      setAssignReviewerId('')
      setAssignStageId('')
      router.refresh()
    }
    setAssigning(false)
  }

  const removeTag = async (tag: string) => {
    const newTags = tags.filter((t) => t !== tag)
    const { error } = await supabase
      .from('applications')
      .update({ internal_tags: newTags })
      .eq('id', applicationId)

    if (error) {
      toast.error('Failed to remove tag')
    } else {
      setTags(newTags)
    }
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-sm">
                  {APPLICATION_STATUS_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-xs resize-none"
            placeholder="Decision note (optional)"
          />
          <Button size="sm" className="w-full h-7 text-xs" onClick={saveStatus} disabled={saving}>
            <Save className="h-3 w-3 mr-1" />
            {saving ? 'Saving...' : 'Save Status'}
          </Button>
        </CardContent>
      </Card>

      {/* Stage */}
      {stages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Current Stage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="No stage assigned" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-sm">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={saveStage}
              disabled={saving}
            >
              Move to Stage
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Internal Tags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs pr-1 flex items-center gap-1"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-500">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="Add tag..."
              className="h-7 text-xs"
            />
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={addTag}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Assign Reviewer */}
      {stages.length > 0 && reviewers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Assign Reviewer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select value={assignReviewerId} onValueChange={setAssignReviewerId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select reviewer..." />
              </SelectTrigger>
              <SelectContent>
                {reviewers.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-sm">
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assignStageId} onValueChange={setAssignStageId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select stage..." />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => {
                  const alreadyAssigned = existingAssignments.some(
                    (a) => a.reviewerId === assignReviewerId && a.stageId === s.id
                  )
                  return (
                    <SelectItem key={s.id} value={s.id} className="text-sm" disabled={alreadyAssigned}>
                      {s.name}{alreadyAssigned ? ' (assigned)' : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={assignReviewer}
              disabled={!assignReviewerId || !assignStageId || assigning}
            >
              <UserPlus className="h-3 w-3 mr-1" />
              {assigning ? 'Assigning...' : 'Assign'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
