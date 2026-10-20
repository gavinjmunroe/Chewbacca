/**
 * @togari/admin — Gmail Source Adapter
 *
 * Fetches emails via the Gmail API (googleapis) for incremental ingestion
 * into the Personal Data Warehouse.
 */

import { google, gmail_v1 } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../observability/logger';
import { SourceAdapter } from '../ingest-orchestrator';
import { emailToPersonId } from '../person-resolver';
import type {
  GmailIngestConfig,
  Interaction,
  Person,
  RawRecord,
} from '../types';

const logger = createLogger('GmailAdapter');

export class GmailAdapter extends SourceAdapter {
  readonly source = 'gmail' as const;

  private gmail: gmail_v1.Gmail;
  private ownerId: string;
  private ownerEmail: string;
  private maxResults: number;

  constructor(config: GmailIngestConfig, ownerId: string, ownerEmail: string) {
    super();
    this.ownerId = ownerId;
    this.ownerEmail = ownerEmail;
    this.maxResults = config.maxResults ?? 100;

    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
    auth.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken,
    });
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async fetchIncremental(watermark: string | null): Promise<RawRecord[]> {
    const records: RawRecord[] = [];

    // Build query: use `after:` with epoch seconds for incremental
    let query = '';
    if (watermark) {
      const epochSeconds = Math.floor(new Date(watermark).getTime() / 1000);
      query = `after:${epochSeconds}`;
    }

    let pageToken: string | undefined;
    let totalFetched = 0;

    do {
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query || undefined,
        maxResults: Math.min(this.maxResults - totalFetched, 100),
        pageToken,
      });

      const messages = listResponse.data.messages ?? [];

      for (const msg of messages) {
        if (!msg.id) continue;
        try {
          const fullMessage = await this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          });

          records.push({
            source_id: msg.id,
            source: 'gmail',
            raw_data: fullMessage.data as unknown as Record<string, unknown>,
            fetched_at: new Date().toISOString(),
          });
          totalFetched++;
        } catch (err) {
          logger.error(`Failed to fetch message ${msg.id}`, err);
        }

        if (totalFetched >= this.maxResults) break;
      }

      pageToken = listResponse.data.nextPageToken ?? undefined;
    } while (pageToken && totalFetched < this.maxResults);

    logger.info(`Gmail: fetched ${records.length} messages`);
    return records;
  }

  async transform(raw: RawRecord[]): Promise<Interaction[]> {
    const interactions: Interaction[] = [];

    for (const record of raw) {
      try {
        const msg = record.raw_data as unknown as gmail_v1.Schema$Message;
        const headers = msg.payload?.headers ?? [];

        const getHeader = (name: string): string | null => {
          const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
          return h?.value ?? null;
        };

        const from = getHeader('From') ?? '';
        const to = getHeader('To') ?? '';
        const cc = getHeader('Cc') ?? '';
        const subject = getHeader('Subject');
        const dateStr = getHeader('Date');
        const internalDate = msg.internalDate
          ? new Date(parseInt(msg.internalDate, 10)).toISOString()
          : new Date().toISOString();

        // Extract email addresses from header values
        const fromEmails = extractEmails(from);
        const toEmails = extractEmails(to);
        const ccEmails = extractEmails(cc);
        const allParticipants = [...new Set([...fromEmails, ...toEmails, ...ccEmails])];

        // Determine direction
        const ownerNormalized = this.ownerEmail.toLowerCase();
        const isFromOwner = fromEmails.some((e) => e.toLowerCase() === ownerNormalized);
        const isToOwner = toEmails.some((e) => e.toLowerCase() === ownerNormalized);
        let direction: 'inbound' | 'outbound' | 'bilateral' = 'bilateral';
        if (isFromOwner && !isToOwner) direction = 'outbound';
        else if (!isFromOwner && isToOwner) direction = 'inbound';

        // Primary person: the counterparty (not the owner)
        const counterpartyEmails = allParticipants.filter(
          (e) => e.toLowerCase() !== ownerNormalized,
        );
        const primaryEmail = counterpartyEmails[0] ?? fromEmails[0] ?? '';
        const primaryPersonId = emailToPersonId(primaryEmail);

        // Extract plain text body
        const body = extractPlainText(msg.payload ?? {});

        const interaction: Interaction = {
          interaction_id: uuidv4(),
          owner_id: this.ownerId,
          person_id: primaryPersonId,
          counterparty_person_ids: counterpartyEmails
            .slice(1)
            .map((e) => emailToPersonId(e)),
          channel: 'gmail',
          direction,
          interaction_type: 'email',
          subject: subject ?? null,
          summary: null, // AI-generated later
          raw_content_gcs_uri: null, // Set by orchestrator after GCS upload
          sentiment: null,
          topics: [],
          action_items: [],
          duration_seconds: null,
          participants: allParticipants,
          source_id: record.source_id,
          source_metadata: {
            thread_id: msg.threadId,
            label_ids: msg.labelIds,
            snippet: msg.snippet,
          },
          occurred_at: dateStr ? new Date(dateStr).toISOString() : internalDate,
          ingested_at: new Date().toISOString(),
        };

        interactions.push(interaction);
      } catch (err) {
        logger.error(`Failed to transform Gmail message ${record.source_id}`, err);
      }
    }

    return interactions;
  }

  async extractPersons(interactions: Interaction[]): Promise<Person[]> {
    const personMap = new Map<string, Person>();
    const now = new Date().toISOString();

    for (const ix of interactions) {
      for (const email of ix.participants) {
        const normalized = email.toLowerCase().trim();
        if (normalized === this.ownerEmail.toLowerCase()) continue;

        const personId = emailToPersonId(normalized);
        const existing = personMap.get(personId);

        if (existing) {
          existing.interaction_count++;
          if (ix.occurred_at > (existing.last_interaction_at ?? '')) {
            existing.last_interaction_at = ix.occurred_at;
          }
          if (ix.occurred_at < (existing.first_interaction_at ?? 'Z')) {
            existing.first_interaction_at = ix.occurred_at;
          }
        } else {
          personMap.set(personId, {
            person_id: personId,
            owner_id: this.ownerId,
            full_name: extractNameFromEmail(email),
            email_addresses: [normalized],
            phone_numbers: [],
            linkedin_url: null,
            company: extractDomainCompany(normalized),
            title: null,
            relationship_score: null,
            last_interaction_at: ix.occurred_at,
            first_interaction_at: ix.occurred_at,
            interaction_count: 1,
            tags: [],
            metadata: null,
            created_at: now,
            updated_at: now,
          });
        }
      }
    }

    return Array.from(personMap.values());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract email addresses from a header value like "John Doe <john@example.com>, jane@test.com" */
function extractEmails(headerValue: string): string[] {
  const emailRegex = /[\w.+-]+@[\w.-]+\.\w+/g;
  const matches = headerValue.match(emailRegex);
  return matches ? [...new Set(matches.map((e) => e.toLowerCase().trim()))] : [];
}

/** Extract a display name from "Name <email>" format, or derive from email */
function extractNameFromEmail(emailOrHeader: string): string | null {
  // Try "Display Name <email>" format
  const match = emailOrHeader.match(/^([^<]+)<[^>]+>/);
  if (match) return match[1].trim();
  // Derive from email prefix
  const prefix = emailOrHeader.split('@')[0];
  if (!prefix) return null;
  return prefix
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Derive a rough company name from email domain */
function extractDomainCompany(email: string): string | null {
  const domain = email.split('@')[1];
  if (!domain) return null;
  // Skip generic providers
  const generic = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com'];
  if (generic.includes(domain.toLowerCase())) return null;
  return domain.split('.')[0] ?? null;
}

/** Extract plain text from a Gmail message payload (recursive MIME walk) */
function extractPlainText(payload: gmail_v1.Schema$MessagePart): string {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return '';
}
