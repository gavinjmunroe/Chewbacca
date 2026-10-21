'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronRight,
  ChevronLeft,
  Save,
  Send,
  Upload,
  FileText,
  Check,
  Paperclip,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn, ARTIFACT_TYPE_LABELS, formatFileSize } from '@/lib/utils'
import type { StageWithQuestions, Artifact, Application, StageQuestion } from '@/types/database'

interface ApplicationFormProps {
  cycleId: string
  orgSlug: string
  stages: StageWithQuestions[]
  existingApplication: Application | null
  existingResponses: Record<string, string>
  artifacts: Artifact[]
  cycleStatus: string
}

export function ApplicationForm({
  cycleId,
  orgSlug,
  stages,
  existingApplication,
  existingResponses,
  artifacts,
  cycleStatus,
}: ApplicationFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [currentStageIndex, setCurrentStageIndex] = React.useState(0)
  const [responses, setResponses] = React.useState<Record<string, string>>(existingResponses)
  const [fileResponses, setFileResponses] = React.useState<Record<string, { url: string; name: string }>>({})
  const [isSaving, setIsSaving] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [showSubmitDialog, setShowSubmitDialog] = React.useState(false)
  const [uploadingQuestion, setUploadingQuestion] = React.useState<string | null>(null)
  const [vaultPickerQuestion, setVaultPickerQuestion] = React.useState<string | null>(null)

  const currentStage = stages[currentStageIndex]
  const isLastStage = currentStageIndex === stages.length - 1
  const isFirstStage = currentStageIndex === 0
  const isReadOnly =
    existingApplication?.status === 'submitted' ||
    (cycleStatus !== 'active' && !existingApplication)

  const progressPct = ((currentStageIndex + 1) / stages.length) * 100

  const updateResponse = (questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }))
  }

  const toggleMultiChoice = (questionId: string, option: string) => {
    const current = responses[questionId] ?? ''
    const selected = current ? current.split('|||') : []
    const idx = selected.indexOf(option)
    if (idx >= 0) {
      selected.splice(idx, 1)
    } else {
      selected.push(option)
    }
    updateResponse(questionId, selected.join('|||'))
  }

  const isMultiSelected = (questionId: string, option: string): boolean => {
    const current = responses[questionId] ?? ''
    return current.split('|||').includes(option)
  }

  const handleFileUpload = async (questionId: string, file: File) => {
    setUploadingQuestion(questionId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bucket', 'artifacts')

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Upload failed')
      }

      const { url } = await res.json()
      setFileResponses((prev) => ({
        ...prev,
        [questionId]: { url, name: file.name },
      }))
      updateResponse(questionId, url)
      toast.success('File uploaded')
    } catch (err: any) {
      toast.error(err.message ?? 'Upload failed')
    } finally {
      setUploadingQuestion(null)
    }
  }

  const attachVaultArtifact = (questionId: string, artifact: Artifact) => {
    setFileResponses((prev) => ({
      ...prev,
      [questionId]: { url: artifact.file_url, name: artifact.name },
    }))
    updateResponse(questionId, artifact.file_url)
    setVaultPickerQuestion(null)
    toast.success(`Attached: ${artifact.name}`)
  }

  const validateCurrentStage = (): string | null => {
    for (const q of currentStage.stage_questions) {
      if (!q.is_required) continue
      const val = responses[q.id] ?? ''
      if (!val.trim()) {
        return `"${q.question_text.slice(0, 40)}${q.question_text.length > 40 ? '...' : ''}" is required`
      }

      if (q.question_type === 'long_text' && q.word_limit) {
        const wordCount = val.trim().split(/\s+/).filter(Boolean).length
        if (wordCount > q.word_limit) {
          return `Response exceeds ${q.word_limit} word limit`
        }
      }
    }
    return null
  }

  const saveApplication = async (andSubmit = false) => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      toast.error('Not authenticated')
      return null
    }

    // Upsert application
    let applicationId = existingApplication?.id

    if (!applicationId) {
      const { data: newApp, error } = await supabase
        .from('applications')
        .insert({
          cycle_id: cycleId,
          applicant_id: user.id,
        })
        .select('id')
        .single()

      if (error || !newApp) {
        throw new Error(error?.message ?? 'Failed to create application')
      }
      applicationId = newApp.id
    }

    // Upsert all responses
    const allQuestionIds = stages.flatMap((s) => s.stage_questions.map((q) => q.id))
    for (const qId of allQuestionIds) {
      const responseText = responses[qId] ?? null
      if (responseText === null && !existingResponses[qId]) continue

      const { data: existing } = await supabase
        .from('application_responses')
        .select('id')
        .eq('application_id', applicationId)
        .eq('question_id', qId)
        .single()

      if (existing) {
        await supabase
          .from('application_responses')
          .update({ response_text: responseText })
          .eq('id', existing.id)
      } else if (responseText) {
        await supabase.from('application_responses').insert({
          application_id: applicationId,
          question_id: qId,
          response_text: responseText,
          response_files: [],
        })
      }
    }

    if (andSubmit) {
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', applicationId)

      if (error) throw new Error(error.message)
    }

    return applicationId
  }

  const handleSaveDraft = async () => {
    setIsSaving(true)
    try {
      await saveApplication(false)
      toast.success('Draft saved')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await saveApplication(true)
      toast.success('Application submitted!')
      setShowSubmitDialog(false)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleNextStage = () => {
    const err = validateCurrentStage()
    if (err) {
      toast.error(err)
      return
    }
    if (!isLastStage) {
      setCurrentStageIndex((i) => i + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handlePrevStage = () => {
    if (!isFirstStage) {
      setCurrentStageIndex((i) => i - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const resumeArtifacts = artifacts.filter((a) => a.artifact_type === 'resume')
  const primaryResume = resumeArtifacts.find((a) => a.is_primary) ?? resumeArtifacts[0]

  return (
    <div className="space-y-6">
      {/* Stage Progress */}
      {stages.length > 1 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>
              Section {currentStageIndex + 1} of {stages.length}
            </span>
            <span>{Math.round(progressPct)}% complete</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
          <div className="flex gap-2 flex-wrap">
            {stages.map((stage, idx) => (
              <button
                key={stage.id}
                onClick={() => setCurrentStageIndex(idx)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border transition-colors',
                  idx === currentStageIndex
                    ? 'bg-stone-900 text-white border-stone-900'
                    : idx < currentStageIndex
                    ? 'bg-stone-100 text-stone-600 border-stone-200'
                    : 'border-stone-200 text-stone-400'
                )}
              >
                {idx < currentStageIndex && <Check className="inline h-3 w-3 mr-1" />}
                {stage.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Resume Vault Banner */}
      {primaryResume && currentStageIndex === 0 && (
        <Card className="border-blue-100 bg-blue-50">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-blue-500 shrink-0" />
              <div className="text-sm">
                <span className="text-blue-800 font-medium">Resume on file: </span>
                <span className="text-blue-600">{primaryResume.name}</span>
              </div>
            </div>
            <a
              href={primaryResume.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2 shrink-0"
            >
              View
            </a>
          </CardContent>
        </Card>
      )}

      {/* Current Stage Questions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{currentStage.name}</CardTitle>
          {currentStage.description && (
            <p className="text-sm text-stone-500">{currentStage.description}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {currentStage.stage_questions.map((question, qIdx) => (
            <div key={question.id}>
              {qIdx > 0 && <Separator className="mb-6" />}
              <QuestionField
                question={question}
                value={responses[question.id] ?? ''}
                fileValue={fileResponses[question.id] ?? null}
                onChange={(val) => updateResponse(question.id, val)}
                onFileUpload={(file) => handleFileUpload(question.id, file)}
                onOpenVaultPicker={() => setVaultPickerQuestion(question.id)}
                onClearFile={() => {
                  setFileResponses((prev) => {
                    const next = { ...prev }
                    delete next[question.id]
                    return next
                  })
                  updateResponse(question.id, '')
                }}
                isUploading={uploadingQuestion === question.id}
                isReadOnly={isReadOnly}
                artifacts={artifacts}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Navigation Footer */}
      {!isReadOnly && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {!isFirstStage && (
              <Button variant="outline" onClick={handlePrevStage}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleSaveDraft}
              isLoading={isSaving}
              loadingText="Saving..."
            >
              <Save className="h-4 w-4" />
              Save Draft
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {!isLastStage ? (
              <Button onClick={handleNextStage}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  const err = validateCurrentStage()
                  if (err) {
                    toast.error(err)
                    return
                  }
                  setShowSubmitDialog(true)
                }}
              >
                <Send className="h-4 w-4" />
                Submit Application
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Submit Confirmation Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Application?</DialogTitle>
            <DialogDescription>
              Once submitted, you won&apos;t be able to edit your responses. Make sure
              everything looks good before submitting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Review Again
            </Button>
            <Button
              onClick={handleSubmit}
              isLoading={isSubmitting}
              loadingText="Submitting..."
            >
              <Send className="h-4 w-4" />
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vault Picker Dialog */}
      <Dialog
        open={!!vaultPickerQuestion}
        onOpenChange={(open) => !open && setVaultPickerQuestion(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach from Vault</DialogTitle>
            <DialogDescription>
              Select a file from your vault to attach to this question.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {artifacts.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-6">
                Your vault is empty. Upload files in the Vault tab.
              </p>
            ) : (
              artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() =>
                    vaultPickerQuestion && attachVaultArtifact(vaultPickerQuestion, artifact)
                  }
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-stone-200 hover:border-stone-400 hover:bg-stone-50 text-left transition-colors"
                >
                  <FileText className="h-5 w-5 text-stone-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{artifact.name}</p>
                    <p className="text-xs text-stone-400">
                      {ARTIFACT_TYPE_LABELS[artifact.artifact_type]} ·{' '}
                      {formatFileSize(artifact.file_size)}
                    </p>
                  </div>
                  {artifact.is_primary && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Primary
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVaultPickerQuestion(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- QuestionField component ----------

interface QuestionFieldProps {
  question: StageQuestion
  value: string
  fileValue: { url: string; name: string } | null
  onChange: (val: string) => void
  onFileUpload: (file: File) => void
  onOpenVaultPicker: () => void
  onClearFile: () => void
  isUploading: boolean
  isReadOnly: boolean
  artifacts: Artifact[]
}

function QuestionField({
  question,
  value,
  fileValue,
  onChange,
  onFileUpload,
  onOpenVaultPicker,
  onClearFile,
  isUploading,
  isReadOnly,
  artifacts,
}: QuestionFieldProps) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const options: string[] = Array.isArray(question.options)
    ? (question.options as string[])
    : []

  const wordCount = value.trim()
    ? value.trim().split(/\s+/).filter(Boolean).length
    : 0

  const isOverLimit =
    question.question_type === 'long_text' &&
    question.word_limit != null &&
    wordCount > question.word_limit

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <Label className="text-sm font-medium text-stone-800 leading-snug">
          {question.question_text}
          {question.is_required && (
            <span className="text-red-500 ml-0.5">*</span>
          )}
        </Label>
      </div>

      {question.helper_text && (
        <p className="text-xs text-stone-400">{question.helper_text}</p>
      )}

      {/* short_text */}
      {question.question_type === 'short_text' && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? ''}
          maxLength={question.char_limit ?? undefined}
          disabled={isReadOnly}
        />
      )}

      {/* long_text */}
      {question.question_type === 'long_text' && (
        <div className="space-y-1">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? ''}
            rows={6}
            disabled={isReadOnly}
            className={cn(isOverLimit && 'border-red-300 focus-visible:ring-red-400')}
          />
          <div className="flex justify-end">
            <span
              className={cn(
                'text-xs',
                isOverLimit ? 'text-red-500' : 'text-stone-400'
              )}
            >
              {wordCount}
              {question.word_limit ? ` / ${question.word_limit} words` : ' words'}
            </span>
          </div>
        </div>
      )}

      {/* url */}
      {question.question_type === 'url' && (
        <Input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? 'https://'}
          disabled={isReadOnly}
        />
      )}

      {/* number */}
      {question.question_type === 'number' && (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? ''}
          disabled={isReadOnly}
        />
      )}

      {/* single_choice */}
      {question.question_type === 'single_choice' && options.length > 0 && (
        <div className="space-y-2">
          {options.map((opt) => (
            <label
              key={opt}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                value === opt
                  ? 'border-stone-900 bg-stone-50'
                  : 'border-stone-200 hover:border-stone-300',
                isReadOnly && 'opacity-60 cursor-default'
              )}
            >
              <input
                type="radio"
                name={question.id}
                value={opt}
                checked={value === opt}
                onChange={() => !isReadOnly && onChange(opt)}
                disabled={isReadOnly}
                className="sr-only"
              />
              <div
                className={cn(
                  'h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0',
                  value === opt ? 'border-stone-900' : 'border-stone-300'
                )}
              >
                {value === opt && (
                  <div className="h-2 w-2 rounded-full bg-stone-900" />
                )}
              </div>
              <span className="text-sm text-stone-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* multi_choice */}
      {question.question_type === 'multi_choice' && options.length > 0 && (
        <div className="space-y-2">
          {options.map((opt) => {
            const checked = value.split('|||').includes(opt)
            return (
              <label
                key={opt}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  checked
                    ? 'border-stone-900 bg-stone-50'
                    : 'border-stone-200 hover:border-stone-300',
                  isReadOnly && 'opacity-60 cursor-default'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (!isReadOnly) {
                      const selected = value ? value.split('|||') : []
                      const idx = selected.indexOf(opt)
                      if (idx >= 0) selected.splice(idx, 1)
                      else selected.push(opt)
                      onChange(selected.join('|||'))
                    }
                  }}
                  disabled={isReadOnly}
                  className="sr-only"
                />
                <div
                  className={cn(
                    'h-4 w-4 rounded border-2 flex items-center justify-center shrink-0',
                    checked ? 'border-stone-900 bg-stone-900' : 'border-stone-300'
                  )}
                >
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <span className="text-sm text-stone-700">{opt}</span>
              </label>
            )
          })}
        </div>
      )}

      {/* file_upload */}
      {question.question_type === 'file_upload' && (
        <div className="space-y-2">
          {fileValue ? (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 bg-stone-50">
              <FileText className="h-5 w-5 text-stone-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-700 truncate">{fileValue.name}</p>
              </div>
              <a
                href={fileValue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-stone-400 hover:text-stone-700 underline underline-offset-2 shrink-0"
              >
                View
              </a>
              {!isReadOnly && (
                <button
                  onClick={() => onClearFile()}
                  className="text-xs text-red-400 hover:text-red-600 shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ) : (
            !isReadOnly && (
              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) onFileUpload(f)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isLoading={isUploading}
                  loadingText="Uploading..."
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload File
                </Button>
                {artifacts.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenVaultPicker}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    From Vault
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

