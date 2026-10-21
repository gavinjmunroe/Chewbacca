'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  X,
  ChevronRight,
  ChevronDown as ChevronExpandDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Stage, StageQuestion, RubricCriterion } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StageType = 'application' | 'event' | 'interview' | 'decision'
type QuestionType = 'short_text' | 'long_text' | 'single_choice' | 'multi_choice' | 'file_upload' | 'url' | 'number'

interface StageLocal extends Stage {
  questions: StageQuestion[]
  rubric: RubricCriterion[]
  expanded: boolean
  saving: boolean
}

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  application: 'Application',
  event: 'Event',
  interview: 'Interview',
  decision: 'Decision',
}

const STAGE_TYPE_COLORS: Record<StageType, string> = {
  application: 'bg-blue-100 text-blue-700',
  event: 'bg-purple-100 text-purple-700',
  interview: 'bg-amber-100 text-amber-700',
  decision: 'bg-emerald-100 text-emerald-700',
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short Answer',
  long_text: 'Long Answer',
  single_choice: 'Single Choice',
  multi_choice: 'Multiple Choice',
  file_upload: 'File Upload',
  url: 'URL',
  number: 'Number',
}

export default function StagesPage() {
  const params = useParams()
  const router = useRouter()
  const orgSlug = params.orgSlug as string
  const cycleId = params.cycleId as string
  const supabase = createClient()

  const [stages, setStages] = React.useState<StageLocal[]>([])
  const [loading, setLoading] = React.useState(true)
  const [orgName, setOrgName] = React.useState('')
  const [cycleName, setCycleName] = React.useState('')

  React.useEffect(() => {
    loadData()
  }, [cycleId])

  const loadData = async () => {
    setLoading(true)

    const [{ data: cycleData }, { data: stagesData }] = await Promise.all([
      supabase
        .from('cycles')
        .select('name, organizations(name)')
        .eq('id', cycleId)
        .single(),
      supabase
        .from('stages')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('stage_order', { ascending: true }),
    ])

    if (cycleData) {
      setCycleName(cycleData.name)
      const org = cycleData.organizations as { name: string } | null
      setOrgName(org?.name ?? '')
    }

    if (!stagesData || stagesData.length === 0) {
      setStages([])
      setLoading(false)
      return
    }

    const stageIds = stagesData.map((s) => s.id)

    const [{ data: questionsData }, { data: rubricData }] = await Promise.all([
      supabase
        .from('stage_questions')
        .select('*')
        .in('stage_id', stageIds)
        .order('question_order', { ascending: true }),
      supabase
        .from('rubric_criteria')
        .select('*')
        .in('stage_id', stageIds)
        .order('criterion_order', { ascending: true }),
    ])

    const enriched: StageLocal[] = stagesData.map((s) => ({
      ...s,
      questions: (questionsData ?? []).filter((q) => q.stage_id === s.id),
      rubric: (rubricData ?? []).filter((r) => r.stage_id === s.id),
      expanded: true,
      saving: false,
    }))

    setStages(enriched)
    setLoading(false)
  }

  const addStage = async () => {
    const order = stages.length
    const { data, error } = await supabase
      .from('stages')
      .insert({
        cycle_id: cycleId,
        name: `Stage ${order + 1}`,
        stage_order: order,
        stage_type: 'application',
        is_blind: false,
        is_required: true,
      })
      .select()
      .single()

    if (error || !data) {
      toast.error('Failed to add stage')
      return
    }

    setStages((prev) => [
      ...prev,
      { ...data, questions: [], rubric: [], expanded: true, saving: false },
    ])
  }

  const removeStage = async (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId)
    const hasContent = (stage?.questions.length ?? 0) > 0 || (stage?.rubric.length ?? 0) > 0
    const confirmed = window.confirm(
      hasContent
        ? `Delete "${stage?.name}"? This will permanently remove all its questions and rubric criteria.`
        : `Delete "${stage?.name}"? This cannot be undone.`
    )
    if (!confirmed) return

    const { error } = await supabase.from('stages').delete().eq('id', stageId)
    if (error) {
      toast.error('Failed to delete stage')
      return
    }
    setStages((prev) => prev.filter((s) => s.id !== stageId))
    toast.success('Stage removed')
  }

  const moveStage = async (index: number, dir: 'up' | 'down') => {
    const newStages = [...stages]
    const swapIndex = dir === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= newStages.length) return

    const temp = newStages[index]
    newStages[index] = newStages[swapIndex]
    newStages[swapIndex] = temp

    // Re-assign orders
    newStages.forEach((s, i) => {
      s.stage_order = i
    })
    setStages([...newStages])

    // Persist
    await Promise.all(
      newStages.map((s) =>
        supabase.from('stages').update({ stage_order: s.stage_order }).eq('id', s.id)
      )
    )
  }

  const updateStageField = async (
    stageId: string,
    field: keyof Pick<Stage, 'name' | 'description' | 'stage_type' | 'is_blind' | 'is_required'>,
    value: unknown
  ) => {
    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, [field]: value, saving: true } : s))
    )
    const { error } = await supabase
      .from('stages')
      .update({ [field]: value })
      .eq('id', stageId)

    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, saving: false } : s))
    )
    if (error) toast.error('Failed to save')
  }

  const toggleChevronExpandDown = (stageId: string) => {
    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, expanded: !s.expanded } : s))
    )
  }

  // Question ops
  const addQuestion = async (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId)
    if (!stage) return
    const order = stage.questions.length

    const { data, error } = await supabase
      .from('stage_questions')
      .insert({
        stage_id: stageId,
        question_text: '',
        question_type: 'short_text',
        is_required: true,
        question_order: order,
      })
      .select()
      .single()

    if (error || !data) {
      toast.error('Failed to add question')
      return
    }

    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId ? { ...s, questions: [...s.questions, data] } : s
      )
    )
  }

  const updateQuestion = async (
    stageId: string,
    questionId: string,
    updates: Partial<StageQuestion>
  ) => {
    const { error } = await supabase
      .from('stage_questions')
      .update(updates)
      .eq('id', questionId)

    if (error) {
      toast.error('Failed to save question')
      return
    }

    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId
          ? {
              ...s,
              questions: s.questions.map((q) =>
                q.id === questionId ? { ...q, ...updates } : q
              ),
            }
          : s
      )
    )
  }

  const deleteQuestion = async (stageId: string, questionId: string) => {
    const { error } = await supabase.from('stage_questions').delete().eq('id', questionId)
    if (error) {
      toast.error('Failed to delete question')
      return
    }
    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId
          ? { ...s, questions: s.questions.filter((q) => q.id !== questionId) }
          : s
      )
    )
  }

  // Rubric ops
  const addCriterion = async (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId)
    if (!stage) return
    const order = stage.rubric.length

    const { data, error } = await supabase
      .from('rubric_criteria')
      .insert({
        stage_id: stageId,
        criterion_name: '',
        max_score: 5,
        weight: 1.0,
        criterion_order: order,
      })
      .select()
      .single()

    if (error || !data) {
      toast.error('Failed to add criterion')
      return
    }

    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId ? { ...s, rubric: [...s.rubric, data] } : s
      )
    )
  }

  const updateCriterion = async (
    stageId: string,
    criterionId: string,
    updates: Partial<RubricCriterion>
  ) => {
    const { error } = await supabase
      .from('rubric_criteria')
      .update(updates)
      .eq('id', criterionId)

    if (error) {
      toast.error('Failed to save criterion')
      return
    }

    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId
          ? {
              ...s,
              rubric: s.rubric.map((r) =>
                r.id === criterionId ? { ...r, ...updates } : r
              ),
            }
          : s
      )
    )
  }

  const deleteCriterion = async (stageId: string, criterionId: string) => {
    const { error } = await supabase.from('rubric_criteria').delete().eq('id', criterionId)
    if (error) {
      toast.error('Failed to delete criterion')
      return
    }
    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId
          ? { ...s, rubric: s.rubric.filter((r) => r.id !== criterionId) }
          : s
      )
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-stone-400">Loading stages...</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push(`/admin/${orgSlug}/cycles/${cycleId}`)}
              className="text-xs text-stone-400 hover:text-stone-600 mb-2 flex items-center gap-1"
            >
              ← {cycleName}
            </button>
            <h1 className="text-xl font-semibold text-stone-900">Stage Builder</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              {stages.length} stage{stages.length !== 1 ? 's' : ''} · Changes save automatically
            </p>
          </div>
          <Button onClick={addStage}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Stage
          </Button>
        </div>

        {/* Empty state */}
        {stages.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm font-medium text-stone-700 mb-1">No stages yet</p>
              <p className="text-xs text-stone-400 mb-4">
                Add stages to build your application pipeline
              </p>
              <Button onClick={addStage}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add First Stage
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stages list */}
        <div className="space-y-4">
          {stages.map((stage, index) => (
            <StageCard
              key={stage.id}
              stage={stage}
              index={index}
              total={stages.length}
              onMoveUp={() => moveStage(index, 'up')}
              onMoveDown={() => moveStage(index, 'down')}
              onDelete={() => removeStage(stage.id)}
              onToggleChevronExpandDown={() => toggleChevronExpandDown(stage.id)}
              onUpdateField={(field, value) => updateStageField(stage.id, field, value)}
              onAddQuestion={() => addQuestion(stage.id)}
              onUpdateQuestion={(qId, updates) => updateQuestion(stage.id, qId, updates)}
              onDeleteQuestion={(qId) => deleteQuestion(stage.id, qId)}
              onAddCriterion={() => addCriterion(stage.id)}
              onUpdateCriterion={(cId, updates) => updateCriterion(stage.id, cId, updates)}
              onDeleteCriterion={(cId) => deleteCriterion(stage.id, cId)}
            />
          ))}
        </div>

        {stages.length > 0 && (
          <div className="flex justify-end pt-4">
            <Button
              onClick={() => router.push(`/admin/${orgSlug}/cycles/${cycleId}`)}
            >
              Done → View Cycle
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

interface StageCardProps {
  stage: StageLocal
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onToggleChevronExpandDown: () => void
  onUpdateField: (field: keyof Pick<Stage, 'name' | 'description' | 'stage_type' | 'is_blind' | 'is_required'>, value: unknown) => void
  onAddQuestion: () => void
  onUpdateQuestion: (qId: string, updates: Partial<StageQuestion>) => void
  onDeleteQuestion: (qId: string) => void
  onAddCriterion: () => void
  onUpdateCriterion: (cId: string, updates: Partial<RubricCriterion>) => void
  onDeleteCriterion: (cId: string) => void
}

function StageCard({
  stage,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
  onToggleChevronExpandDown,
  onUpdateField,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onAddCriterion,
  onUpdateCriterion,
  onDeleteCriterion,
}: StageCardProps) {
  const [localName, setLocalName] = React.useState(stage.name)

  return (
    <Card className={cn('transition-shadow', stage.saving && 'ring-1 ring-stone-200')}>
      {/* Stage Header */}
      <CardHeader className="p-4 pb-3">
        <div className="flex items-center gap-2">
          {/* Order controls */}
          <div className="flex flex-col gap-0.5 shrink-0">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="text-stone-300 hover:text-stone-600 disabled:opacity-20"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="text-stone-300 hover:text-stone-600 disabled:opacity-20"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Stage number */}
          <div className="h-7 w-7 rounded-full bg-stone-900 text-stone-50 text-xs font-semibold flex items-center justify-center shrink-0">
            {index + 1}
          </div>

          {/* Name input */}
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => onUpdateField('name', localName)}
            className="h-8 text-sm font-medium border-0 shadow-none focus-visible:ring-0 px-1 flex-1"
            placeholder="Stage name"
          />

          {/* Type badge */}
          <Select
            value={stage.stage_type}
            onValueChange={(val) => onUpdateField('stage_type', val as StageType)}
          >
            <SelectTrigger className="h-7 w-32 text-xs border-stone-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STAGE_TYPE_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Blind toggle */}
          <div className="flex items-center gap-1.5">
            <Switch
              checked={stage.is_blind}
              onCheckedChange={(val) => onUpdateField('is_blind', val)}
              className="scale-75"
            />
            <span className="text-xs text-stone-500">Blind</span>
          </div>

          {/* ChevronExpandDown */}
          <button onClick={onToggleChevronExpandDown} className="text-stone-400 hover:text-stone-600">
            {stage.expanded ? (
              <ChevronExpandDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            className="text-stone-300 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Description */}
        {stage.expanded && (
          <Textarea
            defaultValue={stage.description ?? ''}
            onBlur={(e) => onUpdateField('description', e.target.value)}
            rows={2}
            className="mt-2 text-xs resize-none"
            placeholder="Stage description (optional)"
          />
        )}
      </CardHeader>

      {/* ChevronExpandDowned content */}
      {stage.expanded && (
        <CardContent className="px-4 pb-4 space-y-4">
          <Separator />

          {/* Questions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
                Questions
              </h4>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddQuestion}>
                <Plus className="h-3 w-3 mr-1" />
                Add Question
              </Button>
            </div>

            {stage.questions.length === 0 ? (
              <p className="text-xs text-stone-400 italic">No questions yet</p>
            ) : (
              <div className="space-y-2">
                {stage.questions.map((q) => (
                  <QuestionRow
                    key={q.id}
                    question={q}
                    onUpdate={(updates) => onUpdateQuestion(q.id, updates)}
                    onDelete={() => onDeleteQuestion(q.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Rubric */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
                Rubric Criteria
              </h4>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddCriterion}>
                <Plus className="h-3 w-3 mr-1" />
                Add Criterion
              </Button>
            </div>

            {stage.rubric.length === 0 ? (
              <p className="text-xs text-stone-400 italic">No rubric criteria</p>
            ) : (
              <div className="space-y-2">
                {stage.rubric.map((c) => (
                  <CriterionRow
                    key={c.id}
                    criterion={c}
                    onUpdate={(updates) => onUpdateCriterion(c.id, updates)}
                    onDelete={() => onDeleteCriterion(c.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function QuestionRow({
  question,
  onUpdate,
  onDelete,
}: {
  question: StageQuestion
  onUpdate: (updates: Partial<StageQuestion>) => void
  onDelete: () => void
}) {
  const [text, setText] = React.useState(question.question_text)
  const [options, setOptions] = React.useState<string[]>(
    Array.isArray(question.options) ? (question.options as string[]) : []
  )
  const [showOptions, setShowOptions] = React.useState(
    question.question_type === 'single_choice' || question.question_type === 'multi_choice'
  )

  const handleTypeChange = (val: QuestionType) => {
    const needsOptions = val === 'single_choice' || val === 'multi_choice'
    setShowOptions(needsOptions)
    onUpdate({ question_type: val })
  }

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onUpdate({ question_text: text })}
            className="h-7 text-xs"
            placeholder="Question text..."
          />
          <div className="flex items-center gap-2">
            <Select
              value={question.question_type}
              onValueChange={(val) => handleTypeChange(val as QuestionType)}
            >
              <SelectTrigger className="h-6 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(QUESTION_TYPE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(question.question_type === 'short_text' || question.question_type === 'long_text') && (
              <Input
                type="number"
                defaultValue={question.word_limit ?? ''}
                onBlur={(e) => onUpdate({ word_limit: e.target.value ? parseInt(e.target.value) : null })}
                className="h-6 text-xs w-24"
                placeholder="Word limit"
              />
            )}

            <div className="flex items-center gap-1 ml-auto">
              <Switch
                checked={question.is_required}
                onCheckedChange={(val) => onUpdate({ is_required: val })}
                className="scale-75"
              />
              <span className="text-xs text-stone-400">Required</span>
            </div>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-stone-300 hover:text-red-500 mt-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Options for choice questions */}
      {showOptions && (
        <div className="space-y-1 pt-1">
          <p className="text-xs text-stone-400">Options:</p>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={opt}
                onChange={(e) => {
                  const newOpts = [...options]
                  newOpts[i] = e.target.value
                  setOptions(newOpts)
                }}
                onBlur={() => onUpdate({ options: options })}
                className="h-6 text-xs"
                placeholder={`Option ${i + 1}`}
              />
              <button
                onClick={() => {
                  const newOpts = options.filter((_, idx) => idx !== i)
                  setOptions(newOpts)
                  onUpdate({ options: newOpts })
                }}
                className="text-stone-300 hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setOptions([...options, ''])}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add option
          </Button>
        </div>
      )}
    </div>
  )
}

function CriterionRow({
  criterion,
  onUpdate,
  onDelete,
}: {
  criterion: RubricCriterion
  onUpdate: (updates: Partial<RubricCriterion>) => void
  onDelete: () => void
}) {
  const [name, setName] = React.useState(criterion.criterion_name)

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onUpdate({ criterion_name: name })}
            className="h-7 text-xs"
            placeholder="Criterion name..."
          />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Label className="text-xs text-stone-500">Max score</Label>
              <Input
                type="number"
                defaultValue={criterion.max_score}
                onBlur={(e) => onUpdate({ max_score: parseInt(e.target.value) || 5 })}
                className="h-6 text-xs w-16"
                min={1}
                max={100}
              />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-stone-500">Weight</Label>
              <Input
                type="number"
                defaultValue={criterion.weight}
                step={0.1}
                onBlur={(e) => onUpdate({ weight: parseFloat(e.target.value) || 1.0 })}
                className="h-6 text-xs w-16"
                min={0.1}
                max={10}
              />
            </div>
          </div>
          <Textarea
            defaultValue={criterion.description ?? ''}
            onBlur={(e) => onUpdate({ description: e.target.value || null })}
            rows={1}
            className="text-xs resize-none"
            placeholder="Description (optional)"
          />
        </div>
        <button onClick={onDelete} className="text-stone-300 hover:text-red-500 mt-1">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
