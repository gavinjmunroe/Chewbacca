import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/nav/sidebar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import {
  formatDate,
  formatDateTime,
  timeAgo,
  getInitials,
  getFullName,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  ARTIFACT_TYPE_LABELS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_COLORS,
} from '@/lib/utils'
import { FileText, ExternalLink, Clock, ChevronRight, Star } from 'lucide-react'
import { ApplicantActionPanel } from './applicant-actions'

interface PageProps {
  params: Promise<{ orgSlug: string; cycleId: string; appId: string }>
}

export default async function ApplicantDetailPage({ params }: PageProps) {
  const { orgSlug, cycleId, appId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch org
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, logo_url')
    .eq('slug', orgSlug)
    .single()
  if (!org) notFound()

  // Check membership
  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()
  if (!membership) redirect('/dashboard')

  // Fetch application with profile
  const { data: application } = await supabase
    .from('applications')
    .select('*, profiles(*)')
    .eq('id', appId)
    .eq('cycle_id', cycleId)
    .single()
  if (!application) notFound()

  const profile = application.profiles as import('@/types/database').Profile

  // Fetch stages for cycle
  const { data: stages } = await supabase
    .from('stages')
    .select('*, stage_questions(*)')
    .eq('cycle_id', cycleId)
    .order('stage_order', { ascending: true })

  // Fetch responses
  const { data: responses } = await supabase
    .from('application_responses')
    .select('*')
    .eq('application_id', appId)

  // Fetch artifacts for applicant
  const { data: artifacts } = await supabase
    .from('artifacts')
    .select('*')
    .eq('user_id', application.applicant_id)

  // Fetch reviews
  const { data: reviews } = await supabase
    .from('reviews')
    .select('*, profiles(*), review_scores(*)')
    .eq('application_id', appId)

  // Fetch org members for reviewer assignment
  const { data: orgMembersData } = await (supabase as any)
    .from('org_members')
    .select('user_id, profiles(first_name, last_name)')
    .eq('org_id', org.id)

  // Fetch stage history
  const { data: history } = await supabase
    .from('application_stage_history')
    .select('*, from_stage:stages!from_stage_id(name), to_stage:stages!to_stage_id(name), mover:profiles!moved_by(first_name, last_name)')
    .eq('application_id', appId)
    .order('moved_at', { ascending: false })

  const name = getFullName(profile?.first_name, profile?.last_name)
  const initials = getInitials(profile?.first_name, profile?.last_name)
  const statusLabel = APPLICATION_STATUS_LABELS[application.status] ?? application.status
  const statusColor = APPLICATION_STATUS_COLORS[application.status] ?? ''
  const currentStage = stages?.find((s) => s.id === application.current_stage_id)

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminSidebar orgSlug={orgSlug} orgName={org.name} orgLogoUrl={org.logo_url} />

      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Top bar */}
        <div className="border-b border-stone-200 px-6 py-3 flex items-center gap-3 bg-white shrink-0">
          <Link
            href={`/admin/${orgSlug}/cycles/${cycleId}/applicants`}
            className="text-xs text-stone-400 hover:text-stone-600"
          >
            ← All Applicants
          </Link>
          <ChevronRight className="h-3 w-3 text-stone-300" />
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs bg-stone-200 text-stone-700">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-stone-900">{name}</span>
          </div>
          <Badge className={`text-xs ${statusColor}`}>{statusLabel}</Badge>
          {currentStage && (
            <Badge variant="outline" className="text-xs">
              {currentStage.name}
            </Badge>
          )}
          <span className="text-xs text-stone-400 ml-auto">
            Submitted {application.submitted_at ? timeAgo(application.submitted_at) : '—'}
          </span>
        </div>

        {/* Two-column layout */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Application Content */}
          <ScrollArea className="flex-1 border-r border-stone-200">
            <div className="px-6 py-6 space-y-8 max-w-2xl">
              {/* Applicant info */}
              <div className="flex items-start gap-4">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="text-lg bg-stone-200 text-stone-700">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">{name}</h2>
                  {profile?.headline && (
                    <p className="text-sm text-stone-500">{profile.headline}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-stone-400">
                    {profile?.school && <span>{profile.school}</span>}
                    {profile?.graduation_year && <span>'{String(profile.graduation_year).slice(2)}</span>}
                    {profile?.major && <span>{profile.major}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {profile?.linkedin_url && (
                      <a
                        href={profile.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        LinkedIn <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {profile?.github_url && (
                      <a
                        href={profile.github_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-stone-600 hover:underline flex items-center gap-1"
                      >
                        GitHub <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {profile?.website_url && (
                      <a
                        href={profile.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-stone-600 hover:underline flex items-center gap-1"
                      >
                        Website <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Application Responses by Stage */}
              {stages?.map((stage) => {
                const questions = stage.stage_questions ?? []
                if (questions.length === 0) return null

                return (
                  <section key={stage.id}>
                    <h3 className="text-sm font-semibold text-stone-900 mb-3">{stage.name}</h3>
                    <div className="space-y-4">
                      {questions.map((q) => {
                        const response = responses?.find((r) => r.question_id === q.id)
                        return (
                          <div key={q.id}>
                            <p className="text-xs font-medium text-stone-600 mb-1">
                              {q.question_text}
                              {q.is_required && <span className="text-red-400 ml-0.5">*</span>}
                            </p>
                            {response?.response_text ? (
                              <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">
                                {response.response_text}
                              </p>
                            ) : (
                              <p className="text-sm text-stone-300 italic">No response</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}

              {/* Artifacts */}
              {artifacts && artifacts.length > 0 && (
                <section>
                  <Separator className="mb-6" />
                  <h3 className="text-sm font-semibold text-stone-900 mb-3">Documents</h3>
                  <div className="space-y-2">
                    {artifacts.map((artifact) => (
                      <a
                        key={artifact.id}
                        href={artifact.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 hover:border-stone-400 hover:bg-stone-50 transition-colors group"
                      >
                        <FileText className="h-5 w-5 text-stone-400 group-hover:text-stone-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">
                            {artifact.name}
                          </p>
                          <p className="text-xs text-stone-400">
                            {ARTIFACT_TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type}
                            {artifact.file_size &&
                              ` · ${(artifact.file_size / 1024).toFixed(0)} KB`}
                          </p>
                        </div>
                        <ExternalLink className="h-4 w-4 text-stone-300 group-hover:text-stone-500 shrink-0" />
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>

          {/* Right: Review Panel */}
          <div className="w-80 shrink-0 overflow-y-auto">
            <div className="p-4 space-y-5">
              {/* Action panel (client component) */}
              <ApplicantActionPanel
                applicationId={appId}
                currentStatus={application.status}
                currentStageId={application.current_stage_id}
                stages={stages?.map((s) => ({ id: s.id, name: s.name })) ?? []}
                tags={application.internal_tags ?? []}
                decisionNote={application.decision_note}
                cycleId={cycleId}
                orgSlug={orgSlug}
                reviewers={(orgMembersData ?? []).map((m: any) => ({
                  id: m.user_id,
                  name: getFullName(m.profiles?.first_name ?? null, m.profiles?.last_name ?? null) || 'Unknown Member',
                }))}
                existingAssignments={(reviews ?? []).map((r: any) => ({
                  reviewerId: r.reviewer_id,
                  stageId: r.stage_id,
                }))}
              />

              {/* Reviews summary */}
              {reviews && reviews.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Reviews ({reviews.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {reviews.map((review) => {
                      const reviewerProfile = review.profiles as import('@/types/database').Profile | null
                      const reviewerName = getFullName(
                        reviewerProfile?.first_name ?? null,
                        reviewerProfile?.last_name ?? null
                      )
                      const totalScore = review.review_scores?.reduce(
                        (sum: number, rs: { score: number | null }) => sum + (rs.score ?? 0),
                        0
                      )
                      const recColor = review.recommendation
                        ? RECOMMENDATION_COLORS[review.recommendation] ?? ''
                        : ''
                      const recLabel = review.recommendation
                        ? RECOMMENDATION_LABELS[review.recommendation] ?? review.recommendation
                        : 'Pending'

                      return (
                        <div key={review.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-stone-700">
                              {reviewerName}
                            </span>
                            <Badge className={`text-xs ${recColor}`}>{recLabel}</Badge>
                          </div>
                          {review.review_scores && review.review_scores.length > 0 && (
                            <p className="text-xs text-stone-400">
                              Score: {totalScore}
                            </p>
                          )}
                          {review.notes && (
                            <p className="text-xs text-stone-500 line-clamp-2">{review.notes}</p>
                          )}
                          <Separator />
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Stage History */}
              {history && history.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      History
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {history.map((h) => {
                        const toStage = h.to_stage as { name: string } | null
                        const mover = h.mover as { first_name: string | null; last_name: string | null } | null
                        return (
                          <div key={h.id} className="flex items-start gap-2">
                            <div className="mt-1 h-1.5 w-1.5 rounded-full bg-stone-400 shrink-0" />
                            <div>
                              <p className="text-xs text-stone-700">
                                {toStage
                                  ? `Moved to ${toStage.name}`
                                  : h.to_status
                                    ? `Status: ${APPLICATION_STATUS_LABELS[h.to_status] ?? h.to_status}`
                                    : 'Updated'}
                              </p>
                              <p className="text-xs text-stone-400">
                                {mover
                                  ? `by ${getFullName(mover.first_name, mover.last_name)} · `
                                  : ''}
                                {timeAgo(h.moved_at)}
                              </p>
                              {h.note && (
                                <p className="text-xs text-stone-500 mt-0.5 italic">{h.note}</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
