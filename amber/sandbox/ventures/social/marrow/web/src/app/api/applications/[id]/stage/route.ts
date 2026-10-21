import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendStatusUpdate, sendAcceptanceEmail } from '@/lib/email/send'
import type { Database } from '@/types/database'

type ApplicationStatus = Database['public']['Tables']['applications']['Row']['status']

interface StageTransitionBody {
  status?: ApplicationStatus
  stage_id?: string
  note?: string
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: applicationId } = await params
    const supabase = await createClient()

    // Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch application with cycle + org + current stage + applicant profile
    const { data: application, error: appError } = await supabase
      .from('applications')
      .select(`
        id,
        status,
        current_stage_id,
        cycle_id,
        applicant_id,
        cycles (
          id,
          name,
          org_id,
          organizations (
            id,
            name
          )
        ),
        stages (
          id,
          name
        ),
        profiles (
          email,
          first_name,
          last_name
        )
      `)
      .eq('id', applicationId)
      .single()

    if (appError || !application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const cycle = application.cycles as {
      id: string
      name: string
      org_id: string
      organizations: { id: string; name: string } | null
    } | null

    if (!cycle) {
      return NextResponse.json({ error: 'Cycle data missing' }, { status: 500 })
    }

    // Admin check
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', cycle.org_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse body
    const body: StageTransitionBody = await request.json()
    const { status: newStatus, stage_id: newStageId, note } = body

    if (!newStatus && !newStageId) {
      return NextResponse.json(
        { error: 'At least one of status or stage_id must be provided' },
        { status: 400 }
      )
    }

    const previousStatus = application.status
    const previousStageId = application.current_stage_id

    // Build update payload
    const updatePayload: Partial<{
      status: ApplicationStatus
      current_stage_id: string
      decision_at: string
      decision_note: string
    }> = {}

    if (newStatus) updatePayload.status = newStatus
    if (newStageId) updatePayload.current_stage_id = newStageId
    if (newStatus && (newStatus === 'accepted' || newStatus === 'rejected')) {
      updatePayload.decision_at = new Date().toISOString()
      if (note) updatePayload.decision_note = note
    }

    // Update application
    const { data: updatedApp, error: updateError } = await supabase
      .from('applications')
      .update(updatePayload)
      .eq('id', applicationId)
      .select()
      .single()

    if (updateError) {
      console.error('[stage] update error:', updateError.message)
      return NextResponse.json({ error: 'Failed to update application' }, { status: 500 })
    }

    // ── Audit log ──────────────────────────────────────────────────────────────
    await supabase.from('audit_log').insert({
      org_id: cycle.org_id,
      cycle_id: cycle.id,
      actor_id: user.id,
      action: 'application.stage_transition',
      resource_type: 'application',
      resource_id: applicationId,
      metadata: {
        from_status: previousStatus,
        to_status: newStatus ?? null,
        from_stage_id: previousStageId,
        to_stage_id: newStageId ?? null,
        note: note ?? null,
      },
    })

    // ── Stage history ──────────────────────────────────────────────────────────
    await supabase.from('application_stage_history').insert({
      application_id: applicationId,
      from_stage_id: previousStageId,
      to_stage_id: newStageId ?? null,
      from_status: previousStatus,
      to_status: newStatus ?? null,
      moved_by: user.id,
      note: note ?? null,
    })

    // ── Email notifications ────────────────────────────────────────────────────
    const profile = application.profiles as {
      email: string
      first_name: string | null
      last_name: string | null
    } | null

    const orgName = cycle.organizations?.name ?? 'The organization'
    const cycleName = cycle.name
    const applicantName = profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
        profile.email
      : 'Applicant'

    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/applications/${applicationId}`

    if (profile?.email && newStatus) {
      if (newStatus === 'accepted') {
        const onboardingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/onboarding/${cycle.id}`
        await sendAcceptanceEmail(profile.email, {
          applicantName,
          orgName,
          cycleName,
          onboardingUrl,
        }).catch((err) => {
          console.error('[stage] acceptance email failed:', err)
        })
      } else if (newStatus === 'rejected' || newStatus === 'under_review' || newStatus === 'advancing' || newStatus === 'waitlisted') {
        await sendStatusUpdate(profile.email, {
          applicantName,
          orgName,
          cycleName,
          newStatus,
          note,
          dashboardUrl: appUrl,
        }).catch((err) => {
          console.error('[stage] status update email failed:', err)
        })
      }
    }

    return NextResponse.json({ application: updatedApp })
  } catch (err) {
    console.error('[stage] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
