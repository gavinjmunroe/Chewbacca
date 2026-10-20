/**
 * @togari/admin — Gmail client for email engine
 *
 * Domain-wide delegation via service account to read inboxes
 * and create draft replies. NEVER sends emails — drafts only.
 */

import { google, gmail_v1 } from 'googleapis';
import { createLogger } from '../observability/logger';

const logger = createLogger('GmailClient');

export interface ParsedEmail {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

function getCredentials(): Record<string, unknown> {
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!b64) throw new Error('GCP_CREDENTIALS_BASE64 not set');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function buildClient(userEmail: string): gmail_v1.Gmail {
  const creds = getCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email as string,
    key: creds.private_key as string,
    scopes: SCOPES,
    subject: userEmail,
  });
  return google.gmail({ version: 'v1', auth });
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Simple body (no parts)
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart — prefer text/plain, fallback to text/html
  if (payload.parts) {
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      return Buffer.from(plainPart.body.data, 'base64url').toString('utf-8');
    }
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Recursively check nested parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function parseFromHeader(from: string): { email: string; name: string } {
  // "John Doe <john@example.com>" or "john@example.com"
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  }
  return { name: from.trim(), email: from.trim() };
}

export async function getRecentEmails(
  userEmail: string,
  hoursBack: number,
): Promise<ParsedEmail[]> {
  const gmail = buildClient(userEmail);
  const afterTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);
  const query = `is:inbox is:unread after:${afterTimestamp}`;

  logger.info('Fetching emails', { userEmail, query });

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messageIds = listRes.data.messages ?? [];
  if (messageIds.length === 0) {
    logger.info('No unread emails found', { userEmail });
    return [];
  }

  logger.info(`Found ${messageIds.length} unread emails`, { userEmail });

  const emails: ParsedEmail[] = [];
  for (const msg of messageIds) {
    if (!msg.id) continue;
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload?.headers;
      const fromRaw = getHeader(headers, 'From');
      const parsed = parseFromHeader(fromRaw);
      let body = extractBody(full.data.payload ?? undefined);
      if (body.length > 3000) {
        body = body.substring(0, 3000) + '... [truncated]';
      }

      emails.push({
        messageId: full.data.id ?? msg.id,
        threadId: full.data.threadId ?? '',
        from: parsed.email,
        fromName: parsed.name,
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        body,
      });
    } catch (err) {
      logger.error('Failed to fetch message', err, { messageId: msg.id, userEmail });
    }
  }

  return emails;
}

export async function createDraftReply(
  userEmail: string,
  threadId: string,
  to: string,
  subject: string,
  body: string,
): Promise<string | null> {
  const gmail = buildClient(userEmail);

  // Build RFC 2822 message
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const rawMessage = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    '',
    body,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  logger.info('Creating draft reply', { userEmail, threadId, to });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId,
      },
    },
  });

  return res.data.id ?? null;
}
