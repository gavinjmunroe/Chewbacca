/**
 * Patch L — Fireflies webhook handler.
 *
 * Fireflies posts to this endpoint when a meeting completes / transcript
 * is ready. We:
 *   1. Verify the signature (HMAC SHA-256 over the raw body; header
 *      'x-fireflies-signature' per their docs). In dev mode (no secret
 *      configured) we warn and skip verification.
 *   2. ACK immediately with 200 — Fireflies retries on timeouts.
 *   3. Process asynchronously: fetch the full transcript, dedup against
 *      togari_captures by (source='fireflies', source_id=meetingId),
 *      resolve the company name from the title, upsert external
 *      attendees as contacts, insert the capture, back-link contacts.
 *
 * The route is registered in src/server.ts and wrapped with the same
 * tenantStorage pattern Smartlead uses (tenantId from
 * FIREFLIES_DEFAULT_TENANT_ID, default 'bma'). The handler itself is
 * tenant-agnostic.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createLogger } from '../../observability/logger';
import { findCompanyByName, upsertCompany } from '../../core/tools/company-ops';
import {
  upsertContact,
  linkContactToCapture,
} from '../../core/tools/contact-ops';
import {
  insertCapture,
  findBySource,
} from '../../core/tools/capture-ops';

const logger = createLogger('webhooks/fireflies');

const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql';

interface FirefliesAttendee {
  email?: string;
  name?: string;
  displayName?: string;
}

interface FirefliesMeeting {
  id: string;
  title: string;
  date: string;
  duration?: number;
  transcript_url?: string;
  attendees?: FirefliesAttendee[];
  sentences?: { speaker_name?: string; text?: string }[];
  meeting_attendees?: FirefliesAttendee[];
}

async function fetchFirefliesMeeting(meetingId: string): Promise<FirefliesMeeting | null> {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    logger.warn('FIREFLIES_API_KEY not set — cannot fetch meeting');
    return null;
  }
  const query = `
    query {
      transcript(id: "${meetingId}") {
        id
        title
        date
        duration
        transcript_url
        meeting_attendees {
          email
          name
          displayName
        }
        sentences {
          speaker_name
          text
        }
      }
    }
  `;
  const res = await fetch(FIREFLIES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fireflies API HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { data?: { transcript?: FirefliesMeeting }; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Fireflies GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json.data?.transcript ?? null;
}

/**
 * Parse the canonical company name out of a meeting title. BMA's
 * convention is "Client / BMA" or "Client <> BMA", with several
 * separators in active use. Strips the BMA side; returns the client.
 */
export function parseCompanyFromTitle(title: string): string | null {
  if (!title) return null;
  const separators = [' / ', ' <> ', ' - ', ' — ', ' + ', ' x ', ' & '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep).map((p) => p.trim());
      const nonBma = parts.filter((p) => !/^(bma|blue\s*modern)/i.test(p));
      if (nonBma.length > 0) return nonBma[0];
    }
  }
  const cleaned = title.replace(/\s*(bma|blue\s*modern.*)\s*$/i, '').trim();
  return cleaned || title;
}

function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn(
      'FIREFLIES_WEBHOOK_SECRET not set — skipping signature verification (dev mode)',
    );
    return true;
  }
  if (!signatureHeader) {
    logger.warn('Missing fireflies signature header — rejecting');
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signatureHeader, 'utf8'),
    );
  } catch {
    return false;
  }
}

interface FirefliesWebhookBody {
  meetingId?: string;
  eventType?: string;
  // Fireflies may post a richer payload; we only need the id.
}

/**
 * Express handler. The route in server.ts uses express.json() — req.body
 * is already parsed; we re-stringify it for HMAC verification.
 */
export async function firefliesWebhookHandler(req: Request, res: Response): Promise<void> {
  const rawString = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body ?? {});
  const signature =
    (req.headers['x-fireflies-signature'] as string | undefined) ??
    (req.headers['x-hub-signature-256'] as string | undefined);

  if (!verifySignature(rawString, signature)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // ACK immediately — Fireflies retries on timeouts.
  res.status(200).json({ received: true });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as FirefliesWebhookBody | null;
  const meetingId = body?.meetingId;
  if (!meetingId) {
    logger.warn('Fireflies webhook missing meetingId', { body });
    return;
  }

  setImmediate(() => {
    processFirefliesMeeting(meetingId).catch((err) => {
      logger.error(
        'Fireflies async processing failed',
        err instanceof Error ? err : new Error(String(err)),
        { meetingId },
      );
    });
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * The actual ingestion. Exported so the backfill script
 * (scripts/backfill-fireflies-captures.ts) can call it directly without
 * going through the webhook route.
 */
export async function processFirefliesMeeting(meetingId: string): Promise<{ skipped: boolean; captureId?: string }> {
  const existing = await findBySource('fireflies', meetingId);
  if (existing) {
    logger.info('Fireflies capture already exists, skipping', { meetingId, captureId: existing.capture_id });
    return { skipped: true, captureId: existing.capture_id };
  }

  const meeting = await fetchFirefliesMeeting(meetingId);
  if (!meeting) {
    logger.warn('Fireflies fetch returned no meeting', { meetingId });
    return { skipped: true };
  }

  const companyName = parseCompanyFromTitle(meeting.title);

  let companyId: string | undefined;
  if (companyName) {
    try {
      const found = await findCompanyByName(companyName);
      const company = found ?? (await upsertCompany({ name: companyName }));
      companyId = company.company_id;
    } catch (err) {
      logger.warn('Fireflies company resolution failed', {
        meetingId,
        companyName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const attendeeList = meeting.meeting_attendees ?? meeting.attendees ?? [];
  const emails = attendeeList.map((a) => a.email).filter((e): e is string => !!e);
  const internal = emails.filter((e) => e.toLowerCase().endsWith('@bluemodernadvisory.com'));
  const external = emails.filter((e) => !e.toLowerCase().endsWith('@bluemodernadvisory.com'));

  // Upsert external attendees as contacts. We require either company_id
  // or capture_id on the contact for the linkage invariant — at this
  // point we have at least companyId in the normal case. If we don't
  // (parseCompanyFromTitle returned null), we'll insert the capture
  // first below and then upsert contacts referencing capture_ids.
  const contactIds: string[] = [];
  if (companyId) {
    for (const email of external) {
      const matchingAttendee = attendeeList.find((a) => a.email === email);
      const fullName = matchingAttendee?.name ?? matchingAttendee?.displayName ?? email;
      try {
        const contact = await upsertContact({
          full_name: fullName,
          email,
          company_id: companyId,
          sources: ['fireflies'],
        });
        contactIds.push(contact.contact_id);
      } catch (err) {
        logger.warn('Fireflies contact upsert failed', {
          meetingId,
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Build transcript text for the raw_blob.
  const transcriptText = (meeting.sentences ?? [])
    .map((s) => `${s.speaker_name ?? 'Unknown'}: ${s.text ?? ''}`)
    .join('\n');

  // Invariant requires at least one of {company_id, contact_ids[], deal_id}.
  // If we have neither company nor contacts (orphan meeting with only the
  // BMA team or no attendees), skip rather than throw — there's nothing
  // useful to file the capture against.
  if (!companyId && contactIds.length === 0) {
    logger.warn('Fireflies meeting has no resolvable company or external attendees — skipping', {
      meetingId,
      title: meeting.title,
    });
    return { skipped: true };
  }

  const capture = await insertCapture({
    source: 'fireflies',
    source_id: meetingId,
    captured_at: meeting.date ? new Date(meeting.date) : new Date(),
    company_id: companyId,
    company_raw: companyName ?? undefined,
    contact_ids: contactIds.length > 0 ? contactIds : undefined,
    attendees: emails,
    internal_attendees: internal,
    title: meeting.title,
    raw_blob: transcriptText || undefined,
    metadata: {
      url: meeting.transcript_url,
      duration: meeting.duration,
    },
  });

  // Back-link contacts → capture.
  for (const cid of contactIds) {
    try {
      await linkContactToCapture(cid, capture.capture_id);
    } catch (err) {
      logger.warn('Fireflies linkContactToCapture failed', {
        meetingId,
        contactId: cid,
        captureId: capture.capture_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Fireflies capture ingested', {
    captureId: capture.capture_id,
    meetingId,
    companyId,
    contactCount: contactIds.length,
  });
  return { skipped: false, captureId: capture.capture_id };
}
