/**
 * @togari/admin — Slack client for email engine notifications
 *
 * Sends rich Slack messages for draft-ready and manual-response emails.
 */

import { WebClient } from '@slack/web-api';
import { createLogger } from '../observability/logger';
import type { ParsedEmail } from './gmail-client';

const logger = createLogger('SlackClient');

let slackClient: WebClient | null = null;

function getClient(): WebClient {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN not set');
    slackClient = new WebClient(token);
  }
  return slackClient;
}

export interface ProcessingStats {
  totalEmails: number;
  trash: number;
  easy: number;
  complex: number;
  errors: number;
  inboxes: string[];
}

export async function notifyDraftReady(
  channel: string,
  slackUserId: string,
  email: ParsedEmail,
  draftText: string,
  summary: string,
): Promise<void> {
  const client = getClient();

  const gmailDraftsUrl = 'https://mail.google.com/mail/u/0/#drafts';

  try {
    await client.chat.postMessage({
      channel,
      text: `<@${slackUserId}> — Draft ready to send`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:envelope: <@${slackUserId}> — *Draft ready to send*`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*From:* ${email.fromName} <${email.from}>` },
            { type: 'mrkdwn', text: `*Subject:* ${email.subject}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Summary:* ${summary}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Draft reply:*\n>${draftText.split('\n').join('\n>')}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open Drafts in Gmail' },
              url: gmailDraftsUrl,
              action_id: 'open_gmail_drafts',
            },
          ],
        },
        { type: 'divider' },
      ],
    });

    logger.info('Sent draft-ready notification', { channel, subject: email.subject });
  } catch (err) {
    logger.error('Failed to send draft-ready notification', err, { channel });
  }
}

export async function notifyManualResponse(
  channel: string,
  slackUserId: string,
  email: ParsedEmail,
  summary: string,
): Promise<void> {
  const client = getClient();

  const gmailSearchUrl = `https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(email.from)}+subject:${encodeURIComponent(email.subject)}`;

  try {
    await client.chat.postMessage({
      channel,
      text: `<@${slackUserId}> — Manual response needed`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:rotating_light: <@${slackUserId}> — *Manual response needed*`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*From:* ${email.fromName} <${email.from}>` },
            { type: 'mrkdwn', text: `*Subject:* ${email.subject}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Summary:* ${summary}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Find in Gmail' },
              url: gmailSearchUrl,
              action_id: 'open_gmail_search',
            },
          ],
        },
        { type: 'divider' },
      ],
    });

    logger.info('Sent manual-response notification', { channel, subject: email.subject });
  } catch (err) {
    logger.error('Failed to send manual-response notification', err, { channel });
  }
}

export async function notifySummary(
  channel: string,
  stats: ProcessingStats,
): Promise<void> {
  const client = getClient();

  try {
    await client.chat.postMessage({
      channel,
      text: 'Email triage summary',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `:mailbox_with_mail: *Email Triage Summary*`,
              `*Inboxes checked:* ${stats.inboxes.join(', ')}`,
              `*Total emails:* ${stats.totalEmails}`,
              `:wastebasket: Trash: ${stats.trash} | :white_check_mark: Drafted: ${stats.easy} | :raised_hand: Manual: ${stats.complex}`,
              stats.errors > 0 ? `:warning: Errors: ${stats.errors}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
        { type: 'divider' },
      ],
    });

    logger.info('Sent processing summary', { stats });
  } catch (err) {
    logger.error('Failed to send summary notification', err, { channel });
  }
}
