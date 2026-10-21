'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Upload, FileText, AlertCircle, Loader2, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn, formatDate } from '@/lib/utils'
import type { OnboardingTask, OnboardingCompletion, Cycle, Organization } from '@/types/database'

type TaskWithCompletion = OnboardingTask & {
  completion: OnboardingCompletion | null
}

const TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  acknowledgment: <CheckCircle2 className="h-4 w-4" />,
  form: <FileText className="h-4 w-4" />,
  upload: <Upload className="h-4 w-4" />,
  default: <Circle className="h-4 w-4" />,
}

function TaskCard({
  task,
  onComplete,
  isCompleting,
}: {
  task: TaskWithCompletion
  onComplete: (taskId: string, response?: Record<string, unknown>) => Promise<void>
  isCompleting: boolean
}) {
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [uploadFile, setUploadFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const isCompleted = task.completion?.status === 'completed'
  const config = task.task_config as any ?? {}

  const handleAcknowledge = async () => {
    if (!acknowledged) return
    await onComplete(task.id, { acknowledged: true })
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    await onComplete(task.id, { fileName: uploadFile.name })
  }

  return (
    <Card
      className={cn(
        'transition-all',
        isCompleted
          ? 'border-emerald-200 bg-emerald-50/30'
          : task.is_required
            ? 'border-stone-200'
            : 'border-dashed border-stone-200'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                isCompleted
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-stone-100 text-stone-500'
              )}
            >
              {isCompleted
                ? <CheckCircle2 className="h-4 w-4" />
                : TASK_TYPE_ICONS[task.task_type] ?? TASK_TYPE_ICONS.default}
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-stone-900 flex items-center gap-2">
                {task.title}
                {task.is_required && (
                  <span className="text-xs text-red-400 font-normal">Required</span>
                )}
              </CardTitle>
              {task.description && (
                <CardDescription className="mt-1 text-xs leading-relaxed">
                  {task.description}
                </CardDescription>
              )}
            </div>
          </div>

          {task.due_date && (
            <div className="shrink-0 flex items-center gap-1 text-xs text-stone-400">
              <Calendar className="h-3 w-3" />
              {formatDate(task.due_date)}
            </div>
          )}
        </div>
      </CardHeader>

      {!isCompleted && (
        <CardContent className="pt-0">
          <div className="ml-11 space-y-3">
            {task.task_type === 'acknowledgment' && (
              <>
                {config.text && (
                  <p className="text-sm text-stone-600 bg-stone-50 rounded-lg px-3 py-2.5 border border-stone-100 leading-relaxed">
                    {config.text}
                  </p>
                )}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`ack-${task.id}`}
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(!!v)}
                  />
                  <Label htmlFor={`ack-${task.id}`} className="text-sm text-stone-600 cursor-pointer">
                    {config.checkboxLabel ?? 'I acknowledge and agree'}
                  </Label>
                </div>
                <Button
                  size="sm"
                  disabled={!acknowledged || isCompleting}
                  isLoading={isCompleting}
                  loadingText="Saving…"
                  onClick={handleAcknowledge}
                >
                  Mark Complete
                </Button>
              </>
            )}

            {task.task_type === 'upload' && (
              <>
                <div
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-stone-200 px-6 py-6 cursor-pointer hover:border-stone-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6 text-stone-300 mb-2" />
                  {uploadFile ? (
                    <p className="text-sm text-stone-700 font-medium">{uploadFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-stone-500">Click to upload</p>
                      {config.acceptedTypes && (
                        <p className="text-xs text-stone-400 mt-0.5">{config.acceptedTypes}</p>
                      )}
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={config.acceptedTypes}
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!uploadFile || isCompleting}
                  isLoading={isCompleting}
                  loadingText="Uploading…"
                  onClick={handleUpload}
                >
                  Submit Upload
                </Button>
              </>
            )}

            {task.task_type === 'form' && config.formUrl && (
              <div className="space-y-2">
                <p className="text-sm text-stone-500">
                  Complete the form below, then mark this task as done.
                </p>
                <a
                  href={config.formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Open Form
                </a>
                <Button
                  size="sm"
                  isLoading={isCompleting}
                  loadingText="Saving…"
                  onClick={() => onComplete(task.id, { formCompleted: true })}
                >
                  Mark as Done
                </Button>
              </div>
            )}

            {/* Fallback for other task types */}
            {!['acknowledgment', 'upload', 'form'].includes(task.task_type) && (
              <Button
                size="sm"
                isLoading={isCompleting}
                loadingText="Saving…"
                onClick={() => onComplete(task.id)}
              >
                Mark Complete
              </Button>
            )}
          </div>
        </CardContent>
      )}

      {isCompleted && task.completion?.completed_at && (
        <CardContent className="pt-0 pb-4">
          <p className="ml-11 text-xs text-emerald-600">
            Completed {formatDate(task.completion.completed_at)}
          </p>
        </CardContent>
      )}
    </Card>
  )
}

export default function OnboardingPage() {
  const params = useParams<{ cycleId: string }>()
  const { cycleId } = params
  const router = useRouter()
  const supabase = createClient()

  const [cycle, setCycle] = React.useState<Cycle & { organizations: Organization } | null>(null)
  const [tasks, setTasks] = React.useState<TaskWithCompletion[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [completingTaskId, setCompletingTaskId] = React.useState<string | null>(null)
  const [userId, setUserId] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      setIsLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      // Verify user has accepted application for this cycle
      const { data: app } = await supabase
        .from('applications')
        .select('id, status')
        .eq('cycle_id', cycleId)
        .eq('applicant_id', user.id)
        .eq('status', 'accepted')
        .single()

      if (!app) {
        router.push('/dashboard')
        return
      }

      // Load cycle with org
      const { data: cycleData } = await supabase
        .from('cycles')
        .select('*, organizations(*)')
        .eq('id', cycleId)
        .single()

      if (!cycleData) { router.push('/dashboard'); return }
      setCycle(cycleData as any)

      // Load tasks
      const { data: tasksData } = await supabase
        .from('onboarding_tasks')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('task_order', { ascending: true })

      // Load completions
      const taskIds = (tasksData ?? []).map((t) => (t as any).id as string)
      const { data: completionsData } = await supabase
        .from('onboarding_completions')
        .select('*')
        .eq('user_id', user.id)
        .in('task_id', taskIds)

      const completionMap: Record<string, OnboardingCompletion> = {}
      for (const c of (completionsData ?? []) as any[]) completionMap[c.task_id] = c

      const enriched: TaskWithCompletion[] = (tasksData ?? []).map((t) => ({
        ...(t as any),
        completion: completionMap[(t as any).id] ?? null,
      }))

      setTasks(enriched)
      setIsLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId])

  const handleComplete = async (taskId: string, response?: Record<string, unknown>) => {
    if (!userId) return
    setCompletingTaskId(taskId)
    try {
      const existing = tasks.find((t) => t.id === taskId)?.completion
      const sb = supabase as any
      if (existing) {
        await sb
          .from('onboarding_completions')
          .update({
            status: 'completed',
            response: response ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await sb.from('onboarding_completions').insert({
          task_id: taskId,
          user_id: userId,
          response: response ?? null,
          completed_at: new Date().toISOString(),
        })
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                completion: {
                  ...(t.completion ?? {}),
                  task_id: taskId,
                  user_id: userId,
                  status: 'completed',
                  response: response ?? null,
                  completed_at: new Date().toISOString(),
                } as OnboardingCompletion,
              }
            : t
        )
      )

      toast.success('Task completed!')
    } catch {
      toast.error('Failed to mark task complete.')
    } finally {
      setCompletingTaskId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    )
  }

  if (!cycle) return null

  const org = (cycle as any).organizations
  const completedCount = tasks.filter((t) => t.completion?.status === 'completed').length
  const totalRequired = tasks.filter((t) => t.is_required).length
  const completedRequired = tasks.filter(
    (t) => t.is_required && t.completion?.status === 'completed'
  ).length
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0
  const allRequiredDone = completedRequired >= totalRequired

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* Congratulations banner */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 px-6 py-8 text-white text-center shadow-lg">
        <h1 className="text-2xl font-bold">Congratulations!</h1>
        <p className="mt-2 text-emerald-100 text-sm">
          You've been accepted to{' '}
          <span className="font-semibold text-white">{org?.name}</span>
          {', '}<span className="font-semibold text-white">{cycle.name}</span>
        </p>
        <p className="mt-1 text-emerald-200 text-xs">
          Complete the onboarding tasks below to finalize your membership.
        </p>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-stone-600 font-medium">
            {completedCount} of {tasks.length} tasks complete
          </span>
          <span className="text-stone-400">{progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
        {allRequiredDone && tasks.length > 0 && (
          <p className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All required tasks complete
          </p>
        )}
      </div>

      {/* Tasks */}
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-300 mx-auto mb-3" />
            <p className="text-stone-500 text-sm">No onboarding tasks at this time.</p>
            <p className="text-stone-400 text-xs mt-1">
              Your membership has been confirmed. Welcome!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={handleComplete}
              isCompleting={completingTaskId === task.id}
            />
          ))}
        </div>
      )}

      {/* Footer CTA */}
      {allRequiredDone && (
        <div className="text-center pt-2">
          <Button onClick={() => router.push('/dashboard')}>
            Go to Dashboard
          </Button>
        </div>
      )}
    </div>
  )
}
