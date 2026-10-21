// ─── Email Templates ──────────────────────────────────────────────────────────
// All templates return self-contained HTML strings with inline CSS.
// Brand: primary #4f46e5 (indigo-600), text #111827, muted #6b7280

const base = (body: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Marrow</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#4f46e5;padding:28px 40px;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Marrow</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;color:#111827;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because of your activity on Marrow.<br/>
                &copy; ${new Date().getFullYear()} Marrow. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 24px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`

const divider = `<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;" />`

const statusBadge = (status: string) => {
  const map: Record<string, { bg: string; color: string }> = {
    accepted:     { bg: '#d1fae5', color: '#065f46' },
    rejected:     { bg: '#fee2e2', color: '#991b1b' },
    under_review: { bg: '#dbeafe', color: '#1e40af' },
    advancing:    { bg: '#ede9fe', color: '#5b21b6' },
    waitlisted:   { bg: '#fef3c7', color: '#92400e' },
    submitted:    { bg: '#e0e7ff', color: '#3730a3' },
  }
  const style = map[status] ?? { bg: '#f3f4f6', color: '#374151' }
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return `<span style="display:inline-block;padding:4px 12px;border-radius:9999px;background-color:${style.bg};color:${style.color};font-size:13px;font-weight:600;">${label}</span>`
}

// ── 1. Application submitted ───────────────────────────────────────────────────
export interface ApplicationSubmittedParams {
  applicantName: string
  orgName: string
  cycleName: string
  dashboardUrl: string
}

export function applicationSubmittedEmail(params: ApplicationSubmittedParams): string {
  const { applicantName, orgName, cycleName, dashboardUrl } = params
  return base(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;">Application Received</h1>
    <p style="margin:0 0 24px;font-size:16px;color:#6b7280;">Hi ${applicantName},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Your application to <strong>${orgName}</strong> for <strong>${cycleName}</strong> has been successfully submitted.
      The team will review your application and reach out with updates.
    </p>
    <div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:24px 0;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;">Submitted to</p>
      <p style="margin:0;font-size:16px;font-weight:600;color:#111827;">${orgName} &mdash; ${cycleName}</p>
    </div>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      You can track the status of your application at any time from your dashboard.
    </p>
    ${btn(dashboardUrl, 'View Application')}
    ${divider}
    <p style="margin:0;font-size:13px;color:#9ca3af;">
      Good luck! If you have questions, reach out to the ${orgName} team directly through your dashboard.
    </p>
  `)
}

// ── 2. Application status update ───────────────────────────────────────────────
export interface ApplicationStatusUpdateParams {
  applicantName: string
  orgName: string
  cycleName: string
  newStatus: string
  note?: string
  dashboardUrl: string
}

export function applicationStatusUpdateEmail(params: ApplicationStatusUpdateParams): string {
  const { applicantName, orgName, cycleName, newStatus, note, dashboardUrl } = params
  return base(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;">Application Update</h1>
    <p style="margin:0 0 24px;font-size:16px;color:#6b7280;">Hi ${applicantName},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      There's an update on your application to <strong>${orgName}</strong> for <strong>${cycleName}</strong>.
    </p>
    <div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:24px 0;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;">New Status</p>
      ${statusBadge(newStatus)}
      ${note ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.7;color:#374151;border-top:1px solid #e5e7eb;padding-top:16px;">${note}</p>` : ''}
    </div>
    ${btn(dashboardUrl, 'View Application')}
    ${divider}
    <p style="margin:0;font-size:13px;color:#9ca3af;">
      If you believe this is an error or have questions, please contact the ${orgName} team through your dashboard.
    </p>
  `)
}

// ── 3. Reviewer invite ─────────────────────────────────────────────────────────
export interface ReviewerInviteParams {
  reviewerName: string
  inviterName: string
  orgName: string
  cycleName: string
  reviewUrl: string
}

export function reviewerInviteEmail(params: ReviewerInviteParams): string {
  const { reviewerName, inviterName, orgName, cycleName, reviewUrl } = params
  return base(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;">You've Been Invited to Review</h1>
    <p style="margin:0 0 24px;font-size:16px;color:#6b7280;">Hi ${reviewerName},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      <strong>${inviterName}</strong> has invited you to join the review team for <strong>${orgName}</strong>'s
      <strong>${cycleName}</strong> recruitment cycle on Marrow.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      As a reviewer, you'll be able to read applications, score candidates against the rubric, and leave recommendations
      to help the team make informed decisions.
    </p>
    ${btn(reviewUrl, 'Start Reviewing')}
    ${divider}
    <p style="margin:0;font-size:13px;color:#9ca3af;">
      This invite was sent by ${inviterName} on behalf of ${orgName}. If you weren't expecting this, you can safely ignore this email.
    </p>
  `)
}

// ── 4. Bulk message from org ───────────────────────────────────────────────────
export interface BulkMessageParams {
  recipientName: string
  orgName: string
  subject: string
  body: string
  unsubscribeUrl?: string
}

export function bulkMessageEmail(params: BulkMessageParams): string {
  const { recipientName, orgName, body, unsubscribeUrl } = params
  return base(`
    <p style="margin:0 0 24px;font-size:16px;color:#6b7280;">Hi ${recipientName},</p>
    <div style="font-size:15px;line-height:1.8;color:#374151;white-space:pre-wrap;">${body}</div>
    ${divider}
    <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;">
      This message was sent to you by <strong>${orgName}</strong> via Marrow.
    </p>
    ${
      unsubscribeUrl
        ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;"><a href="${unsubscribeUrl}" style="color:#9ca3af;">Unsubscribe</a></p>`
        : ''
    }
  `)
}

// ── 5. Acceptance ──────────────────────────────────────────────────────────────
export interface AcceptanceParams {
  applicantName: string
  orgName: string
  cycleName: string
  onboardingUrl: string
}

export function acceptanceEmail(params: AcceptanceParams): string {
  const { applicantName, orgName, cycleName, onboardingUrl } = params
  return base(`
    <div style="text-align:center;padding:8px 0 32px;">
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111827;">Congratulations, ${applicantName}!</h1>
      <p style="margin:0;font-size:16px;color:#6b7280;">You've been accepted.</p>
    </div>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      We're thrilled to let you know that you've been accepted to <strong>${orgName}</strong> through the
      <strong>${cycleName}</strong> recruitment cycle.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      The next step is to complete your onboarding — click the button below to get started. You'll find tasks,
      important information, and everything you need to hit the ground running.
    </p>
    ${btn(onboardingUrl, 'Begin Onboarding')}
    ${divider}
    <p style="margin:0;font-size:13px;color:#9ca3af;">
      Welcome to the team! If you have any questions, reach out to the ${orgName} team through your Marrow dashboard.
    </p>
  `)
}
