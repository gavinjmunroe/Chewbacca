import { Resend } from 'resend'
import {
  applicationSubmittedEmail,
  applicationStatusUpdateEmail,
  reviewerInviteEmail,
  bulkMessageEmail,
  acceptanceEmail,
  type ApplicationSubmittedParams,
  type ApplicationStatusUpdateParams,
  type ReviewerInviteParams,
  type BulkMessageParams,
  type AcceptanceParams,
} from './templates'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder')
  }
  return _resend
}

const FROM = 'Marrow <noreply@marrow.app>'

// ── Base send ──────────────────────────────────────────────────────────────────
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string
): Promise<{ id: string }> {
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  })

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`)
  }

  return { id: data!.id }
}

// ── Application submitted ──────────────────────────────────────────────────────
export async function sendApplicationSubmitted(
  to: string,
  params: ApplicationSubmittedParams
): Promise<{ id: string }> {
  return sendEmail(
    to,
    `Application received — ${params.cycleName}`,
    applicationSubmittedEmail(params)
  )
}

// ── Status update ──────────────────────────────────────────────────────────────
export async function sendStatusUpdate(
  to: string,
  params: ApplicationStatusUpdateParams
): Promise<{ id: string }> {
  const statusLabel = params.newStatus
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return sendEmail(
    to,
    `Your application status: ${statusLabel} — ${params.orgName}`,
    applicationStatusUpdateEmail(params)
  )
}

// ── Reviewer invite ────────────────────────────────────────────────────────────
export async function sendReviewerInvite(
  to: string,
  params: ReviewerInviteParams
): Promise<{ id: string }> {
  return sendEmail(
    to,
    `You're invited to review applications for ${params.orgName}`,
    reviewerInviteEmail(params)
  )
}

// ── Bulk message ───────────────────────────────────────────────────────────────
export interface BulkRecipient {
  email: string
  name: string
}

export async function sendBulkMessage(
  recipients: BulkRecipient[],
  params: Omit<BulkMessageParams, 'recipientName'>
): Promise<{ sent: number; failed: number; ids: string[] }> {
  const results = await Promise.allSettled(
    recipients.map((r) => {
      const perRecipientBody = params.body.replace(/\{applicant_name\}/g, r.name)
      return sendEmail(
        r.email,
        params.subject,
        bulkMessageEmail({ ...params, body: perRecipientBody, recipientName: r.name })
      )
    })
  )

  const ids: string[] = []
  let failed = 0

  for (const result of results) {
    if (result.status === 'fulfilled') {
      ids.push(result.value.id)
    } else {
      failed++
      console.error('[sendBulkMessage] failed for recipient:', result.reason)
    }
  }

  return { sent: ids.length, failed, ids }
}

// ── Acceptance ─────────────────────────────────────────────────────────────────
export async function sendAcceptanceEmail(
  to: string,
  params: AcceptanceParams
): Promise<{ id: string }> {
  return sendEmail(
    to,
    `You're in! Welcome to ${params.orgName}`,
    acceptanceEmail(params)
  )
}
