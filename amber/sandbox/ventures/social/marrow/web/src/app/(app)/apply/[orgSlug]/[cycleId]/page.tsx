import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import type { StageWithQuestions, Artifact } from '@/types/database'
import { ApplicationForm } from './application-form'

export const metadata = {
  title: 'Apply — Marrow',
}

interface ApplyPageProps {
  params: Promise<{ orgSlug: string; cycleId: string }>
}

export default async function ApplyPage({ params }: ApplyPageProps) {
  const { orgSlug, cycleId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch org by slug
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, description, school, category, website')
    .eq('slug', orgSlug)
    .single()

  if (!org) notFound()

  // Fetch cycle
  const { data: cycle } = await supabase
    .from('cycles')
    .select('*')
    .eq('id', cycleId)
    .eq('org_id', org.id)
    .single()

  if (!cycle || cycle.status === 'archived') notFound()

  // Fetch stages with questions, ordered
  const { data: stages } = await supabase
    .from('stages')
    .select(`
      *,
      stage_questions (*)
    `)
    .eq('cycle_id', cycleId)
    .order('stage_order', { ascending: true })

  const stagesWithQuestions: StageWithQuestions[] = (stages ?? []).map((s) => ({
    ...s,
    stage_questions: (s.stage_questions ?? []).sort(
      (a: any, b: any) => a.question_order - b.question_order
    ),
    rubric_criteria: [],
  }))

  // Fetch existing application for this user + cycle
  const { data: existingApplication } = await supabase
    .from('applications')
    .select('*')
    .eq('cycle_id', cycleId)
    .eq('applicant_id', user.id)
    .single()

  // Fetch existing responses
  let existingResponses: Record<string, string> = {}
  if (existingApplication) {
    const { data: responses } = await supabase
      .from('application_responses')
      .select('*')
      .eq('application_id', existingApplication.id)

    for (const r of responses ?? []) {
      if (r.response_text) {
        existingResponses[r.question_id] = r.response_text
      }
    }
  }

  // Fetch user's vault artifacts (for resume attachment)
  const { data: artifacts } = await supabase
    .from('artifacts')
    .select('*')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })

  const applicationStages = stagesWithQuestions.filter(
    (s) => s.stage_type === 'application' && s.stage_questions.length > 0
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Cycle Overview */}
      <div className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex items-start gap-4">
          {org.logo_url ? (
            <img
              src={org.logo_url}
              alt={org.name}
              className="h-14 w-14 rounded-xl object-cover border border-stone-100"
            />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-stone-100 flex items-center justify-center text-stone-600 font-bold text-lg">
              {org.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-0.5">
              {org.name}
            </p>
            <h1 className="text-xl font-semibold text-stone-900">{cycle.name}</h1>
            {org.school && <p className="text-sm text-stone-500 mt-0.5">{org.school}</p>}
          </div>
        </div>

        {cycle.description && (
          <p className="mt-4 text-sm text-stone-600 leading-relaxed">{cycle.description}</p>
        )}

        <div className="flex flex-wrap gap-4 mt-4 text-xs text-stone-500">
          {cycle.application_open_at && (
            <span>Opens: {formatDate(cycle.application_open_at)}</span>
          )}
          {cycle.application_close_at && (
            <span className="font-medium text-stone-700">
              Deadline: {formatDate(cycle.application_close_at)}
            </span>
          )}
          {cycle.target_class_size && (
            <span>Class size: ~{cycle.target_class_size}</span>
          )}
        </div>
      </div>

      {/* If cycle is not open, show a message */}
      {cycle.status !== 'active' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <strong>
            {cycle.status === 'draft' && 'Applications are not yet open.'}
            {cycle.status === 'paused' && 'Applications are temporarily paused.'}
            {cycle.status === 'closed' && 'Applications are now closed.'}
            {!['draft', 'paused', 'closed'].includes(cycle.status) && 'Applications are not currently accepting submissions.'}
          </strong>{' '}
          You can view the application but cannot submit at this time.
        </div>
      )}

      {/* Already submitted */}
      {existingApplication?.status === 'submitted' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          <strong>Application submitted!</strong> You submitted this application on{' '}
          {formatDate(existingApplication.submitted_at)}. We&apos;ll be in touch.
        </div>
      )}

      {/* No stages */}
      {applicationStages.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-stone-500">
          <p className="font-medium">No application questions configured yet.</p>
          <p className="text-sm mt-1">Check back later or contact the organization.</p>
        </div>
      ) : (
        <ApplicationForm
          cycleId={cycleId}
          orgSlug={orgSlug}
          stages={applicationStages}
          existingApplication={existingApplication ?? null}
          existingResponses={existingResponses}
          artifacts={artifacts ?? []}
          cycleStatus={cycle.status}
        />
      )}
    </div>
  )
}
