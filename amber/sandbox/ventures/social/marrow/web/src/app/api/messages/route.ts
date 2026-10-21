import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBulkMessage } from '@/lib/email/send'
import type { Database } from '@/types/database'

type RecipientType = Database['public']['Tables']['messages']['Row']['recipient_type']
type ApplicationStatus = Database['public']['Tables']['applications']['Row']['status']

interface SendMessageBody {
  cycle_id: string
  subject: string
  body: string
  recipient_type: RecipientType
  /** For recipient_type "stage": stage_id. For "status": status value. For "individual": array of user IDs. */
  recipient_filter?: string | string[]
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: SendMessageBody = await request.json()
    const { cycle_id, subject, body: messageBody, recipient_type, recipient_filter } = body

    if (!cycle_id || !subject || !messageBody || !recipient_type) {
      return NextResponse.json(
        { error: 'Missing required fields: cycle_id, subject, body, recipient_type' },
        { status: 400 }
      )
    }

    // Fetch cycle + org
    const { data: cycle, error: cycleError } = await supabase
      .from('cycles')
      .select('id, name, org_id, organizations(name)')
      .eq('id', cycle_id)
      .single()

    if (cycleError || !cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
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

    const orgName = (cycle.organizations as { name: string } | null)?.name ?? 'Your organization'

    // ── Build recipient list ───────────────────────────────────────────────────
    let recipientQuery = supabase
      .from('applications')
      .select('applicant_id, profiles(email, first_name, last_name)')
      .eq('cycle_id', cycle_id)

    if (recipient_type === 'stage' && typeof recipient_filter === 'string') {
      recipientQuery = recipientQuery.eq('current_stage_id', recipient_filter)
    } else if (recipient_type === 'status' && typeof recipient_filter === 'string') {
      recipientQuery = recipientQuery.eq('status', recipient_filter as ApplicationStatus)
    } else if (recipient_type === 'individual' && Array.isArray(recipient_filter)) {
      recipientQuery = recipientQuery.in('applicant_id', recipient_filter)
    }
    // recipient_type === 'all' gets all applicants (no additional filter)

    const { data: applicationRows, error: recipientError } = await recipientQuery

    if (recipientError) {
      console.error('[messages] recipient query error:', recipientError.message)
      return NextResponse.json({ error: 'Failed to resolve recipients' }, { status: 500 })
    }

    const recipients = (applicationRows ?? [])
      .map((row) => {
        const profile = row.profiles as {
          email: string
          first_name: string | null
          last_name: string | null
        } | null
        if (!profile?.email) return null
        return {
          email: profile.email,
          name:
            [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
            profile.email,
        }
      })
      .filter((r): r is { email: string; name: string } => r !== null)

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No recipients match the specified filter' },
        { status: 400 }
      )
    }

    // ── Send emails ────────────────────────────────────────────────────────────
    // Interpolate org/cycle-level template variables
    const bodyWithSharedVars = messageBody
      .replace(/\{org_name\}/g, orgName)
      .replace(/\{cycle_name\}/g, cycle.name)

    // {applicant_name} is per-recipient — handled inside sendBulkMessage
    const { sent, failed } = await sendBulkMessage(recipients, {
      orgName,
      subject,
      body: bodyWithSharedVars,
    })

    // ── Persist message record ─────────────────────────────────────────────────
    const { data: messageRecord, error: insertError } = await supabase
      .from('messages')
      .insert({
        cycle_id,
        sent_by: user.id,
        recipient_type,
        recipient_filter: recipient_filter
          ? JSON.parse(JSON.stringify(recipient_filter))
          : {},
        subject,
        body: messageBody,
        recipient_count: sent,
      })
      .select('id')
      .single()

    if (insertError) {
      // Non-fatal — emails already sent
      console.error('[messages] insert error:', insertError.message)
    }

    return NextResponse.json({
      sent,
      failed,
      message_id: messageRecord?.id ?? null,
    })
  } catch (err) {
    console.error('[messages] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
