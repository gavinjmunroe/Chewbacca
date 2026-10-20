/**
 * @togari/admin — Fireflies Source Adapter
 *
 * Fetches meeting transcripts via the Fireflies GraphQL API for incremental
 * ingestion into the Personal Data Warehouse.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../observability/logger';
import { SourceAdapter } from '../ingest-orchestrator';
import { emailToPersonId } from '../person-resolver';
import type {
  FirefliesIngestConfig,
  Interaction,
  Person,
  RawRecord,
} from '../types';

const logger = createLogger('FirefliesAdapter');

const DEFAULT_ENDPOINT = 'https://api.fireflies.ai/graphql';

/** Shape of a Fireflies transcript from the GraphQL API */
interface FirefliesTranscript {
  id: string;
  title: string;
  date: string; // ISO timestamp
  duration: number; // seconds
  participants: string[]; // email addresses
  summary?: {
    overview?: string;
    action_items?: string[];
    keywords?: string[];
  };
  sentences?: Array<{
    text: string;
    speaker_name?: string;
    start_time?: number;
    end_time?: number;
  }>;
  transcript_url?: string;
}

export class FirefliesAdapter extends SourceAdapter {
  readonly source = 'fireflies' as const;

  private apiKey: string;
  private endpoint: string;
  private ownerId: string;
  private ownerEmail: string;
  private maxResults: number;

  constructor(config: FirefliesIngestConfig, ownerId: string, ownerEmail: string) {
    super();
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.ownerId = ownerId;
    this.ownerEmail = ownerEmail;
    this.maxResults = config.maxResults ?? 50;
  }

  async fetchIncremental(watermark: string | null): Promise<RawRecord[]> {
    const records: RawRecord[] = [];

    // Fireflies GraphQL query for transcripts
    const query = `
      query Transcripts($limit: Int, $skip: Int) {
        transcripts(limit: $limit, skip: $skip) {
          id
          title
          date
          duration
          participants
          summary {
            overview
            action_items
            keywords
          }
          sentences {
            text
            speaker_name
            start_time
            end_time
          }
          transcript_url
        }
      }
    `;

    let skip = 0;
    let hasMore = true;

    while (hasMore && records.length < this.maxResults) {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            limit: Math.min(this.maxResults - records.length, 50),
            skip,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Fireflies API error: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as {
        data?: { transcripts?: FirefliesTranscript[] };
        errors?: Array<{ message: string }>;
      };

      if (result.errors?.length) {
        throw new Error(`Fireflies GraphQL error: ${result.errors[0].message}`);
      }

      const transcripts = result.data?.transcripts ?? [];

      if (transcripts.length === 0) {
        hasMore = false;
        break;
      }

      for (const t of transcripts) {
        // Filter by watermark: only include transcripts after the watermark date
        if (watermark && t.date && new Date(t.date) <= new Date(watermark)) {
          hasMore = false;
          break;
        }

        records.push({
          source_id: t.id,
          source: 'fireflies',
          raw_data: t as unknown as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
        });
      }

      skip += transcripts.length;
      if (transcripts.length < 50) hasMore = false;
    }

    logger.info(`Fireflies: fetched ${records.length} transcripts`);
    return records;
  }

  async transform(raw: RawRecord[]): Promise<Interaction[]> {
    const interactions: Interaction[] = [];

    for (const record of raw) {
      try {
        const t = record.raw_data as unknown as FirefliesTranscript;
        const participantEmails = (t.participants ?? []).map((p) => p.toLowerCase().trim());
        const counterparties = participantEmails.filter(
          (e) => e !== this.ownerEmail.toLowerCase(),
        );
        const primaryEmail = counterparties[0] ?? participantEmails[0] ?? '';
        const primaryPersonId = emailToPersonId(primaryEmail);

        // Build full transcript text from sentences
        const fullText = t.sentences
          ? t.sentences.map((s) => `${s.speaker_name ?? 'Unknown'}: ${s.text}`).join('\n')
          : '';

        const interaction: Interaction = {
          interaction_id: uuidv4(),
          owner_id: this.ownerId,
          person_id: primaryPersonId,
          counterparty_person_ids: counterparties.slice(1).map((e) => emailToPersonId(e)),
          channel: 'fireflies',
          direction: 'bilateral',
          interaction_type: 'meeting',
          subject: t.title ?? null,
          summary: t.summary?.overview ?? null,
          raw_content_gcs_uri: null,
          sentiment: null,
          topics: t.summary?.keywords ?? [],
          action_items: t.summary?.action_items ?? [],
          duration_seconds: t.duration ?? null,
          participants: participantEmails,
          source_id: t.id,
          source_metadata: {
            transcript_url: t.transcript_url,
            sentence_count: t.sentences?.length ?? 0,
          },
          occurred_at: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
          ingested_at: new Date().toISOString(),
        };

        interactions.push(interaction);
      } catch (err) {
        logger.error(`Failed to transform Fireflies transcript ${record.source_id}`, err);
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
            full_name: null,
            email_addresses: [normalized],
            phone_numbers: [],
            linkedin_url: null,
            company: extractDomainCompany(normalized),
            title: null,
            relationship_score: null,
            last_interaction_at: ix.occurred_at,
            first_interaction_at: ix.occurred_at,
            interaction_count: 1,
            tags: ['meeting-participant'],
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

function extractDomainCompany(email: string): string | null {
  const domain = email.split('@')[1];
  if (!domain) return null;
  const generic = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com'];
  if (generic.includes(domain.toLowerCase())) return null;
  return domain.split('.')[0] ?? null;
}
