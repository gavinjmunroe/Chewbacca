'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Save,
  Send,
  Keyboard,
  Lock,
} from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { reviewSchema, type ReviewInput } from '@/lib/validations'
import {
  cn,
  formatDate,
  getFullName,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_COLORS,
} from '@/lib/utils'
import type {
  Application,
  Stage,
  StageQuestion,
  RubricCriterion,
  Review,
  ReviewScore,
  Profile,
  ApplicationResponse,
} from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

type RichReview = Review & {
  review_scores: ReviewScore[]
  profiles: Profile
}

type EnrichedApp = Application & {
  profiles: Profile
  stages: Stage | null
  cycles: {
    id: string
    name: string
    organizations: { id: string; name: string; slug: string }
  }
}

type StageWithData = Stage & {
  stage_questions: StageQuestion[]
  rubric_criteria: RubricCriterion[]
}

type ResponseMap = Record<string, ApplicationResponse>

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECOMMENDATION_OPTIONS = [
  { value: 'advance', label: 'Advance', colorClass: 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  { value: 'hold', label: 'Hold', colorClass: 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  { value: 'reject', label: 'Reject', colorClass: 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100' },
  { value: 'undecided', label: 'Undecided', colorClass: 'border-stone-300 bg-stone-50 text-stone-600 hover:bg-stone-100' },
] as const

function ScoreButtonGroup({
  maxScore,
  value,
  onChange,
  disabled,
}: {
  maxScore: number
  value: number | null
  onChange: (v: number) => void
  disabled: boolean
}) {
  const scores = Array.from({ length: maxScore }, (_, i) => i + 1)
  return (
    <div className="flex gap-1">
      {scores.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cn(
            'h-8 w-8 rounded-md border text-sm font-medium transition-all',
            value === s
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:bg-stone-50',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

function QuestionResponse({
  question,
  response,
}: {
  question: StageQuestion
  response: ApplicationResponse | undefined
}) {
  const text = response?.response_text
  const files = (response?.response_files as any[]) ?? []

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-stone-700">
        {question.question_text}
        {question.is_required && <span className="text-red-400 ml-0.5">*</span>}
      </p>
      {question.helper_text && (
        <p className="text-xs text-stone-400">{question.helper_text}</p>
      )}
      {question.question_type === 'file_upload' ? (
        <div className="space-y-1">
          {files.length > 0 ? (
            files.map((f: any, i: number) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 underline underline-offset-2"
              >
                <Download className="h-3.5 w-3.5" />
                {f.name ?? `File ${i + 1}`}
              </a>
            ))
          ) : (
            <span className="text-sm text-stone-400 italic">No file uploaded</span>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5 min-h-[2.5rem]">
          <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">
            {text ?? <span className="italic text-stone-400">No response</span>}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const params = useParams<{ orgSlug: string; cycleId: string; appId: string }>()
  const { orgSlug, cycleId, appId } = params
  const router = useRouter()
  const supabase = createClient()

  // Data state
  const [app, setApp] = React.useState<EnrichedApp | null>(null)
  const [currentStage, setCurrentStage] = React.useState<StageWithData | null>(null)
  const [allStages, setAllStages] = React.useState<StageWithData[]>([])
  const [selectedStageId, setSelectedStageId] = React.useState<string | null>(null)
  const [responseMap, setResponseMap] = React.useState<ResponseMap>({})
  const [myReview, setMyReview] = React.useState<Review | null>(null)
  const [myScores, setMyScores] = React.useState<Record<string, number>>({})
  const [otherReviews, setOtherReviews] = React.useState<RichReview[]>([])
  const [siblingAppIds, setSiblingAppIds] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isSubmitOpen, setIsSubmitOpen] = React.useState(false)
  const [userId, setUserId] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    setValue,
    formState: { isDirty },
  } = useForm<ReviewInput>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { notes: '', recommendation: undefined, scores: {} },
  })

  const watchedScores = watch('scores')
  const watchedRecommendation = watch('recommendation')
  const isSubmitted = myReview?.is_submitted ?? false

  // ── Load data ───────────────────────────────────────────────────────────────

  React.useEffect(() => {
    async function load() {
      setIsLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const sb = supabase as any

      // Application
      const { data: appDataRaw } = await sb
        .from('applications')
        .select('*, profiles(*), stages(*), cycles(id, name, organizations(id, name, slug))')
        .eq('id', appId)
        .single()

      if (!appDataRaw) { router.push('/dashboard'); return }
      const appData = appDataRaw as EnrichedApp
      setApp(appData)

      // All stages for this cycle
      const { data: stagesDataRaw } = await sb
        .from('stages')
        .select('*, stage_questions(*), rubric_criteria(*)')
        .eq('cycle_id', cycleId)
        .order('stage_order', { ascending: true })

      const stages = (stagesDataRaw ?? []) as StageWithData[]
      setAllStages(stages)

      const relevantStageId = appData.current_stage_id ?? stages[0]?.id ?? null
      setSelectedStageId(relevantStageId)

      const stage = stages.find((s) => s.id === relevantStageId) ?? null
      setCurrentStage(stage)

      // Responses
      const { data: responsesRaw } = await sb
        .from('application_responses')
        .select('*')
        .eq('application_id', appId)

      const map: ResponseMap = {}
      for (const r of (responsesRaw ?? []) as ApplicationResponse[]) map[r.question_id] = r
      setResponseMap(map)

      // My review for this stage
      if (relevantStageId) {
        const { data: reviewDataRaw } = await sb
          .from('reviews')
          .select('*')
          .eq('application_id', appId)
          .eq('stage_id', relevantStageId)
          .eq('reviewer_id', user.id)
          .single()

        const reviewData = reviewDataRaw as Review | null

        if (reviewData) {
          setMyReview(reviewData)

          const { data: scoresDataRaw } = await sb
            .from('review_scores')
            .select('*')
            .eq('review_id', reviewData.id)

          const scoreMap: Record<string, number> = {}
          for (const s of (scoresDataRaw ?? []) as ReviewScore[]) {
            if (s.score !== null) scoreMap[s.criterion_id] = s.score
          }
          setMyScores(scoreMap)

          reset({
            notes: reviewData.notes ?? '',
            recommendation: (reviewData.recommendation ?? undefined) as ReviewInput['recommendation'],
            scores: scoreMap,
          })
        }

        // Other reviewers
        const { data: othersDataRaw } = await sb
          .from('reviews')
          .select('*, review_scores(*), profiles(*)')
          .eq('application_id', appId)
          .eq('stage_id', relevantStageId)
          .neq('reviewer_id', user.id)

        setOtherReviews((othersDataRaw ?? []) as RichReview[])
      }

      // Sibling app IDs in this cycle for prev/next nav
      const { data: siblingDataRaw } = await sb
        .from('reviews')
        .select('application_id')
        .eq('reviewer_id', user.id)
        .in('stage_id', stages.map((s) => s.id))

      const ids: string[] = [...new Set<string>((siblingDataRaw ?? [] as any[]).map((r: any) => r.application_id as string))]
      setSiblingAppIds(ids)

      setIsLoading(false)
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, cycleId])

  // ── Keyboard nav ────────────────────────────────────────────────────────────

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const idx = siblingAppIds.indexOf(appId)
      if (e.key === 'ArrowLeft' && idx > 0) {
        router.push(`/review/${orgSlug}/${cycleId}/${siblingAppIds[idx - 1]}`)
      } else if (e.key === 'ArrowRight' && idx < siblingAppIds.length - 1) {
        router.push(`/review/${orgSlug}/${cycleId}/${siblingAppIds[idx + 1]}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [siblingAppIds, appId, orgSlug, cycleId, router])

  // ── Computed score ───────────────────────────────────────────────────────────

  const computedScore = React.useMemo(() => {
    if (!currentStage?.rubric_criteria?.length) return null
    const criteria = currentStage.rubric_criteria
    let weightedSum = 0
    let totalWeight = 0
    for (const c of criteria) {
      const score = watchedScores?.[c.id]
      if (score != null) {
        weightedSum += (score / c.max_score) * c.weight
        totalWeight += c.weight
      }
    }
    if (totalWeight === 0) return null
    return Math.round((weightedSum / totalWeight) * 100)
  }, [currentStage, watchedScores])

  // ── Save draft ───────────────────────────────────────────────────────────────

  const saveDraft = async (data: ReviewInput, submit = false) => {
    if (!userId || !selectedStageId) return
    setIsSaving(true)

    const sb = supabase as any

    try {
      let reviewId = myReview?.id

      if (reviewId) {
        await sb
          .from('reviews')
          .update({
            notes: data.notes ?? null,
            recommendation: data.recommendation ?? null,
            is_submitted: submit,
            submitted_at: submit ? new Date().toISOString() : null,
          })
          .eq('id', reviewId)
      } else {
        const { data: newReviewRaw, error } = await sb
          .from('reviews')
          .insert({
            application_id: appId,
            stage_id: selectedStageId,
            reviewer_id: userId,
            notes: data.notes ?? null,
            recommendation: data.recommendation ?? null,
          })
          .select()
          .single()

        const newReview = newReviewRaw as Review | null
        if (error || !newReview) throw error
        reviewId = newReview.id
        setMyReview(newReview)
      }

      // Upsert scores
      if (reviewId && currentStage?.rubric_criteria?.length) {
        const scoreRows = currentStage.rubric_criteria
          .filter((c) => data.scores[c.id] != null)
          .map((c) => ({
            review_id: reviewId!,
            criterion_id: c.id,
            score: data.scores[c.id],
          }))

        for (const row of scoreRows) {
          await sb
            .from('review_scores')
            .upsert(row, { onConflict: 'review_id,criterion_id' })
        }
      }

      if (submit) {
        await sb
          .from('reviews')
          .update({ is_submitted: true, submitted_at: new Date().toISOString() })
          .eq('id', reviewId!)

        setMyReview((prev) => prev ? { ...prev, is_submitted: true } : prev)
        toast.success('Review submitted and locked.')
        setIsSubmitOpen(false)
      } else {
        toast.success('Draft saved.')
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to save review. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
      </div>
    )
  }

  if (!app) return null

  const profile = app.profiles as Profile
  const org = (app.cycles as any)?.organizations
  const isBlind = currentStage?.is_blind ?? false
  const currentIdx = siblingAppIds.indexOf(appId)
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < siblingAppIds.length - 1

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-stone-50">
      {/* Left panel — application content */}
      <div className="flex-[3] overflow-y-auto border-r border-stone-200 bg-white">
        {/* Top bar */}
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/review/${orgSlug}/${cycleId}`)}
            >
              <ChevronLeft className="h-4 w-4" />
              Queue
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-stone-500">
              {currentIdx + 1} of {siblingAppIds.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={!hasPrev}
              onClick={() => router.push(`/review/${orgSlug}/${cycleId}/${siblingAppIds[currentIdx - 1]}`)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!hasNext}
              onClick={() => router.push(`/review/${orgSlug}/${cycleId}/${siblingAppIds[currentIdx + 1]}`)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Keyboard className="h-4 w-4 text-stone-400" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">← Previous &nbsp; → Next</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Applicant info */}
          {!isBlind && (
            <div>
              <h2 className="text-xl font-semibold text-stone-900">
                {getFullName(profile?.first_name ?? null, profile?.last_name ?? null)}
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                {profile?.school && (
                  <span className="text-sm text-stone-500">{profile.school}</span>
                )}
                {profile?.graduation_year && (
                  <span className="text-sm text-stone-500">Class of {profile.graduation_year}</span>
                )}
                {profile?.major && (
                  <span className="text-sm text-stone-500">{profile.major}</span>
                )}
              </div>
            </div>
          )}

          {/* Stage tabs */}
          {allStages.length > 1 ? (
            <Tabs
              value={selectedStageId ?? undefined}
              onValueChange={(v) => {
                setSelectedStageId(v)
                const s = allStages.find((st) => st.id === v) ?? null
                setCurrentStage(s)
              }}
            >
              <TabsList className="w-full justify-start">
                {allStages.map((s) => (
                  <TabsTrigger key={s.id} value={s.id} className="text-xs">
                    {s.name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {allStages.map((s) => (
                <TabsContent key={s.id} value={s.id} className="mt-4 space-y-5">
                  {s.stage_questions
                    .sort((a, b) => a.question_order - b.question_order)
                    .map((q) => (
                      <QuestionResponse
                        key={q.id}
                        question={q}
                        response={responseMap[q.id]}
                      />
                    ))}
                  {s.stage_questions.length === 0 && (
                    <p className="text-sm text-stone-400 italic">No questions in this stage.</p>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <div className="space-y-5">
              {(currentStage?.stage_questions ?? [])
                .sort((a, b) => a.question_order - b.question_order)
                .map((q) => (
                  <QuestionResponse
                    key={q.id}
                    question={q}
                    response={responseMap[q.id]}
                  />
                ))}
              {(currentStage?.stage_questions?.length ?? 0) === 0 && (
                <p className="text-sm text-stone-400 italic">No questions in this stage.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — review form */}
      <div className="flex-[2] overflow-y-auto bg-stone-50">
        <form onSubmit={handleSubmit((data) => saveDraft(data, false))}>
          <div className="px-5 py-5 space-y-5">
            {/* Lock indicator */}
            {isSubmitted && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <Lock className="h-4 w-4 shrink-0" />
                <span>This review has been submitted and is locked.</span>
              </div>
            )}

            {/* Other reviewers summary */}
            {otherReviews.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Other Reviewers
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {otherReviews.map((r) => {
                    const rProfile = r.profiles as Profile
                    const rec = r.recommendation
                    const colorKey = rec ?? 'undecided'
                    return (
                      <div key={r.id} className="flex items-center justify-between">
                        <span className="text-sm text-stone-600">
                          {getFullName(rProfile?.first_name ?? null, rProfile?.last_name ?? null)}
                        </span>
                        {r.is_submitted && rec ? (
                          <span
                            className={cn(
                              'text-xs font-medium px-2 py-0.5 rounded-full',
                              RECOMMENDATION_COLORS[colorKey]
                            )}
                          >
                            {RECOMMENDATION_LABELS[rec]}
                          </span>
                        ) : (
                          <span className="text-xs text-stone-400 italic">Pending</span>
                        )}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            {/* Rubric */}
            {(currentStage?.rubric_criteria?.length ?? 0) > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                      Rubric
                    </CardTitle>
                    {computedScore !== null && (
                      <span className="text-sm font-semibold text-stone-900">
                        Score: {computedScore}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-5">
                  {(currentStage!.rubric_criteria ?? [])
                    .sort((a, b) => a.criterion_order - b.criterion_order)
                    .map((criterion) => (
                      <div key={criterion.id} className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-stone-800">
                              {criterion.criterion_name}
                            </p>
                            {criterion.description && (
                              <p className="text-xs text-stone-400 mt-0.5">
                                {criterion.description}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs text-stone-400 mt-0.5">
                            Weight {criterion.weight}×
                          </span>
                        </div>
                        <Controller
                          control={control}
                          name={`scores.${criterion.id}`}
                          render={({ field }) => (
                            <ScoreButtonGroup
                              maxScore={criterion.max_score}
                              value={field.value ?? null}
                              onChange={(v) => field.onChange(v)}
                              disabled={isSubmitted}
                            />
                          )}
                        />
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Textarea
                  {...register('notes')}
                  disabled={isSubmitted}
                  placeholder="Write your notes about this applicant…"
                  className="min-h-[120px] resize-y text-sm"
                />
              </CardContent>
            </Card>

            {/* Recommendation */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                  Recommendation
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Controller
                  control={control}
                  name="recommendation"
                  render={({ field }) => (
                    <div className="grid grid-cols-2 gap-2">
                      {RECOMMENDATION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isSubmitted}
                          onClick={() => field.onChange(opt.value)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all',
                            field.value === opt.value
                              ? opt.colorClass + ' ring-2 ring-offset-1 ring-current'
                              : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                            isSubmitted && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <span>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            {/* Actions */}
            {!isSubmitted && (
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="outline"
                  className="flex-1"
                  isLoading={isSaving}
                  loadingText="Saving…"
                >
                  <Save className="h-4 w-4" />
                  Save Draft
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!watchedRecommendation}
                  onClick={() => setIsSubmitOpen(true)}
                >
                  <Send className="h-4 w-4" />
                  Submit Review
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Submit confirmation dialog */}
      <Dialog open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Review</DialogTitle>
            <DialogDescription>
              Once submitted, your review is locked and cannot be edited. Make sure your
              scores, notes, and recommendation are finalized.
            </DialogDescription>
          </DialogHeader>
          {watchedRecommendation && (
            <div className="rounded-lg border border-stone-100 bg-stone-50 px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Recommendation</span>
                <span
                  className={cn(
                    'font-medium px-2 py-0.5 rounded-full text-xs',
                    RECOMMENDATION_COLORS[watchedRecommendation]
                  )}
                >
                  {RECOMMENDATION_LABELS[watchedRecommendation]}
                </span>
              </div>
              {computedScore !== null && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Overall Score</span>
                  <span className="font-semibold text-stone-900">{computedScore}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSubmitOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={isSaving}
              loadingText="Submitting…"
              onClick={handleSubmit((data) => saveDraft(data, true))}
            >
              Confirm & Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
