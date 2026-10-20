/**
 * Notification Sender — Dispatches opportunity notifications via email or Slack.
 * Writes delivery records to notification_history table.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import type {
  Subscription,
  NotificationPayload,
  NotificationMatch,
  EnrichmentRunStats,
} from './types';

// ─── BigQuery Helpers ─────────────────────────────────────────────────────

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };
  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gcpCredentialsBase64) {
    const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (credentialsPath) {
    options.keyFilename = credentialsPath;
  }
  return new BigQuery(options);
}

// ─── Slack Sender ─────────────────────────────────────────────────────────

async function slackApiPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set');

  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error (${endpoint}): ${data.error}`);
  }
  return data;
}

function buildSlackBlocks(payload: NotificationPayload): unknown[] {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${payload.total_matches} New Job Opportunities`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${payload.date}* — Discovered ${payload.companies_discovered} companies, found ${payload.total_matches} matching job postings.`,
      },
    },
    { type: 'divider' },
  ];

  for (const match of payload.matches.slice(0, 10)) {
    const { job_posting, recruiter, outreach_draft } = match;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${job_posting.url}|${job_posting.title}>*\n${job_posting.company}${job_posting.posted_date ? ` • Posted ${job_posting.posted_date}` : ''}`,
      },
    });

    if (recruiter) {
      const contactParts: string[] = [];
      if (recruiter.name) contactParts.push(`*${recruiter.name}*`);
      if (recruiter.title) contactParts.push(recruiter.title);
      if (recruiter.email) contactParts.push(`<mailto:${recruiter.email}|${recruiter.email}>`);
      if (recruiter.linkedin_url) contactParts.push(`<${recruiter.linkedin_url}|LinkedIn>`);

      if (contactParts.length > 0) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `:bust_in_silhouette: ${contactParts.join(' • ')}`,
          }],
        });
      }
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Draft message:*\n> _Subject: ${outreach_draft.subject}_\n> ${outreach_draft.body.split('\n').join('\n> ')}`,
      },
    });

    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Next notification: ${payload.next_notification_date} • Powered by Togari`,
    }],
  });

  return blocks;
}

async function sendSlackNotification(
  payload: NotificationPayload,
  channelId: string,
): Promise<void> {
  const blocks = buildSlackBlocks(payload);
  const fallbackText = `${payload.total_matches} new job opportunities matching your criteria`;

  await slackApiPost('chat.postMessage', {
    channel: channelId,
    text: fallbackText,
    blocks,
  });
}

// ─── Email Sender ─────────────────────────────────────────────────────────

function buildNotificationEmailHtml(payload: NotificationPayload): string {
  const matchRows = payload.matches.map(match => {
    const { job_posting, recruiter, outreach_draft } = match;

    const recruiterHtml = recruiter
      ? `<p style="color:#666;font-size:13px;margin:4px 0;">
          Contact: ${recruiter.name || 'Hiring Manager'}${recruiter.title ? ` — ${recruiter.title}` : ''}
          ${recruiter.email ? ` • <a href="mailto:${recruiter.email}">${recruiter.email}</a>` : ''}
          ${recruiter.linkedin_url ? ` • <a href="${recruiter.linkedin_url}">LinkedIn</a>` : ''}
        </p>`
      : '';

    return `
      <div style="border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:16px;">
        <h3 style="margin:0 0 4px;">
          <a href="${job_posting.url}" style="color:#1a73e8;text-decoration:none;">${job_posting.title}</a>
        </h3>
        <p style="color:#333;margin:4px 0;font-size:14px;">${job_posting.company}${job_posting.posted_date ? ` • Posted ${job_posting.posted_date}` : ''}</p>
        ${recruiterHtml}
        <div style="background:#f8f9fa;border-radius:6px;padding:12px;margin-top:8px;">
          <p style="font-size:12px;color:#666;margin:0 0 4px;">Draft outreach message:</p>
          <p style="font-size:13px;color:#333;margin:0 0 2px;"><strong>Subject:</strong> ${outreach_draft.subject}</p>
          <p style="font-size:13px;color:#333;margin:0;white-space:pre-line;">${outreach_draft.body}</p>
        </div>
      </div>`;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#333;">
      <h1 style="font-size:22px;color:#1a1a1a;">${payload.total_matches} New Job Opportunities</h1>
      <p style="color:#666;font-size:14px;">${payload.date} — matching your criteria</p>
      ${matchRows}
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">
      <p style="font-size:12px;color:#999;">
        Next notification: ${payload.next_notification_date}<br>
        Powered by Togari • <a href="#" style="color:#999;">Unsubscribe</a>
      </p>
    </body>
    </html>`;
}

function buildNotificationEmailText(payload: NotificationPayload): string {
  const lines: string[] = [
    `${payload.total_matches} New Job Opportunities — ${payload.date}`,
    '',
    '---',
    '',
  ];

  for (const match of payload.matches) {
    const { job_posting, recruiter, outreach_draft } = match;
    lines.push(`${job_posting.title} at ${job_posting.company}`);
    lines.push(job_posting.url);
    if (recruiter) {
      const parts = [recruiter.name, recruiter.title, recruiter.email, recruiter.linkedin_url].filter(Boolean);
      lines.push(`Contact: ${parts.join(' • ')}`);
    }
    lines.push('');
    lines.push(`Draft subject: ${outreach_draft.subject}`);
    lines.push(outreach_draft.body);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`Next notification: ${payload.next_notification_date}`);
  return lines.join('\n');
}

async function sendEmailNotification(
  payload: NotificationPayload,
  toEmail: string,
): Promise<void> {
  const gmailToken = process.env.GMAIL_ACCESS_TOKEN || process.env.GMAIL_REFRESH_TOKEN;

  if (!gmailToken) {
    process.stderr.write(
      `Email notification would be sent to ${toEmail}: ${payload.total_matches} matches\n`
    );
    process.stderr.write(`Subject: ${payload.total_matches} new job opportunities matching your criteria\n`);
    throw new Error('Gmail not configured — set GMAIL_ACCESS_TOKEN or GMAIL_REFRESH_TOKEN');
  }

  const subject = `${payload.total_matches} new job opportunities matching your criteria`;
  const htmlBody = buildNotificationEmailHtml(payload);
  const textBody = buildNotificationEmailText(payload);

  const mimeMessage = [
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="togari-boundary"',
    '',
    '--togari-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody,
    '--togari-boundary',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '--togari-boundary--',
  ].join('\r\n');

  const encoded = Buffer.from(mimeMessage).toString('base64url');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${gmailToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${errBody}`);
  }
}

// ─── Send + Record ────────────────────────────────────────────────────────

export async function sendNotification(
  subscription: Subscription,
  payload: NotificationPayload,
  stats: EnrichmentRunStats,
): Promise<{ status: 'sent' | 'failed' | 'skipped'; error?: string }> {
  if (payload.matches.length === 0) {
    await writeNotificationHistory(subscription, 'email', [], stats, 'skipped');
    return { status: 'skipped' };
  }

  // Expand 'both' shorthand and narrow to concrete channel types
  const channels = subscription.notification_channels
    .flatMap(c => c === 'both' ? ['email', 'slack'] as const : [c as 'email' | 'slack']);
  let lastStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  let lastError: string | undefined;

  for (const channel of channels) {
    try {
      if (channel === 'slack') {
        if (!subscription.slack_channel_id) {
          process.stderr.write(`[slack-skip] No slack_channel_id on subscription ${subscription.subscription_id} — skipping Slack notification\n`);
          continue;
        }
        await sendSlackNotification(payload, subscription.slack_channel_id);
      } else if (channel === 'email') {
        const toEmail = subscription.notification_email || subscription.subscriber_email;
        await sendEmailNotification(payload, toEmail);
      } else {
        continue;
      }

      await writeNotificationHistory(subscription, channel, payload.matches, stats, 'sent');
      lastStatus = 'sent';
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeNotificationHistory(subscription, channel, payload.matches, stats, 'failed', errorMsg);
      lastStatus = 'failed';
      lastError = errorMsg;
    }
  }

  return { status: lastStatus, error: lastError };
}

async function writeNotificationHistory(
  subscription: Subscription,
  channel: 'email' | 'slack',
  matches: NotificationMatch[],
  stats: EnrichmentRunStats,
  status: 'sent' | 'failed' | 'skipped',
  errorMessage?: string,
): Promise<void> {
  try {
    const bq = getBqClient();
    const now = new Date().toISOString();
    const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';

    await bq.dataset(dataset).table('notification_history').insert([{
      notification_id: randomUUID(),
      subscription_id: subscription.subscription_id,
      channel,
      status,
      error_message: errorMessage || null,
      matches_count: matches.length,
      matches_json: JSON.stringify(matches),
      exa_calls_used: stats.exa_calls,
      clay_calls_used: stats.clay_calls,
      enrichment_cost_usd: Math.round(stats.cost_usd * 10000) / 10000,
      sent_at: now,
      created_at: now,
    }]);
  } catch (err) {
    process.stderr.write(`Failed to write notification history: ${err instanceof Error ? err.message : err}\n`);
  }
}
