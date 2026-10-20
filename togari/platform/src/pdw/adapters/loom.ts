/**
 * @togari/admin — Loom Source Adapter
 *
 * Fetches video recordings via the Loom Developer API (REST) for incremental
 * ingestion into the Personal Data Warehouse.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../observability/logger';
import { SourceAdapter } from '../ingest-orchestrator';
import { emailToPersonId } from '../person-resolver';
import type {
  LoomIngestConfig,
  Interaction,
  Person,
  RawRecord,
} from '../types';

const logger = createLogger('LoomAdapter');

const DEFAULT_BASE_URL = 'https://developer.loom.com/v1';

/** Shape of a Loom recording from the REST API */
interface LoomRecording {
  id: string;
  title: string;
  created_at: string;          // ISO timestamp
  duration: number;            // seconds
  owner_email: string;
  shared_with?: Array<{
    email: string;
    name?: string;
    access_level?: string;
  }>;
  transcript?: {
    text?: string;
    segments?: Array<{
      text: string;
      start_ms: number;
      end_ms: number;
    }>;
  };
  embed_url?: string;
  thumbnail_url?: string;
  privacy?: string;
}

interface LoomListResponse {
  videos: LoomRecording[];
  next_cursor?: string;
}

export class LoomAdapter extends SourceAdapter {
  readonly source = 'loom' as const;

  private apiKey: string;
  private baseUrl: string;
  private ownerId: string;
  private ownerEmail: string;
  private maxResults: number;

  constructor(config: LoomIngestConfig, ownerId: string, ownerEmail: string) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.ownerId = ownerId;
    this.ownerEmail = ownerEmail;
    this.maxResults = config.maxResults ?? 50;
  }

  async fetchIncremental(watermark: string | null): Promise<RawRecord[]> {
    const records: RawRecord[] = [];
    let cursor: string | undefined;
    let totalFetched = 0;

    do {
      const url = new URL(`${this.baseUrl}/videos`);
      url.searchParams.set('limit', String(Math.min(this.maxResults - totalFetched, 50)));
      if (cursor) url.searchParams.set('cursor', cursor);
      // Sort by created_at descending for incremental
      url.searchParams.set('sort', 'created_at');
      url.searchParams.set('order', 'desc');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Loom API error: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as LoomListResponse;
      const videos = result.videos ?? [];

      if (videos.length === 0) break;

      for (const video of videos) {
        // Filter by watermark
        if (watermark && new Date(video.created_at) <= new Date(watermark)) {
          // We've reached records before the watermark; stop
          cursor = undefined;
          break;
        }

        // Fetch individual recording details (for transcript, shared_with)
        try {
          const detailResponse = await fetch(`${this.baseUrl}/videos/${video.id}`, {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          });

          let fullVideo = video;
          if (detailResponse.ok) {
            fullVideo = (await detailResponse.json()) as LoomRecording;
          }

          records.push({
            source_id: video.id,
            source: 'loom',
            raw_data: fullVideo as unknown as Record<string, unknown>,
            fetched_at: new Date().toISOString(),
          });
          totalFetched++;
        } catch (err) {
          logger.error(`Failed to fetch Loom video ${video.id}`, err);
        }

        if (totalFetched >= this.maxResults) break;
      }

      cursor = result.next_cursor;
    } while (cursor && totalFetched < this.maxResults);

    logger.info(`Loom: fetched ${records.length} recordings`);
    return records;
  }

  async transform(raw: RawRecord[]): Promise<Interaction[]> {
    const interactions: Interaction[] = [];

    for (const record of raw) {
      try {
        const video = record.raw_data as unknown as LoomRecording;

        // Gather participant emails
        const participantEmails: string[] = [];
        if (video.owner_email) {
          participantEmails.push(video.owner_email.toLowerCase());
        }
        if (video.shared_with) {
          for (const share of video.shared_with) {
            if (share.email) participantEmails.push(share.email.toLowerCase());
          }
        }
        const uniqueParticipants = [...new Set(participantEmails)];

        // Primary person: first shared-with counterparty
        const counterparties = uniqueParticipants.filter(
          (e) => e !== this.ownerEmail.toLowerCase(),
        );
        const primaryEmail = counterparties[0] ?? uniqueParticipants[0] ?? '';
        const primaryPersonId = emailToPersonId(primaryEmail);

        // Direction: if owner created the video, it's outbound
        const isOwnerVideo =
          video.owner_email?.toLowerCase() === this.ownerEmail.toLowerCase();
        const direction = isOwnerVideo ? 'outbound' : 'inbound';

        // Transcript text
        let transcriptText: string | null = null;
        if (video.transcript?.text) {
          transcriptText = video.transcript.text;
        } else if (video.transcript?.segments) {
          transcriptText = video.transcript.segments.map((s) => s.text).join(' ');
        }

        const interaction: Interaction = {
          interaction_id: uuidv4(),
          owner_id: this.ownerId,
          person_id: primaryPersonId,
          counterparty_person_ids: counterparties.slice(1).map((e) => emailToPersonId(e)),
          channel: 'loom',
          direction,
          interaction_type: 'video',
          subject: video.title ?? null,
          summary: transcriptText
            ? transcriptText.substring(0, 500) + (transcriptText.length > 500 ? '...' : '')
            : null,
          raw_content_gcs_uri: null,
          sentiment: null,
          topics: [],
          action_items: [],
          duration_seconds: video.duration ?? null,
          participants: uniqueParticipants,
          source_id: video.id,
          source_metadata: {
            embed_url: video.embed_url,
            thumbnail_url: video.thumbnail_url,
            privacy: video.privacy,
            has_transcript: !!video.transcript,
          },
          occurred_at: video.created_at
            ? new Date(video.created_at).toISOString()
            : new Date().toISOString(),
          ingested_at: new Date().toISOString(),
        };

        interactions.push(interaction);
      } catch (err) {
        logger.error(`Failed to transform Loom video ${record.source_id}`, err);
      }
    }

    return interactions;
  }

  async extractPersons(interactions: Interaction[]): Promise<Person[]> {
    const personMap = new Map<string, Person>();
    const now = new Date().toISOString();

    for (const ix of interactions) {
      // Also try to get names from raw shared_with data
      const sharedWith = new Map<string, string | undefined>();
      // We can access the source_metadata for name hints but these are minimal for Loom

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
            full_name: sharedWith.get(normalized) ?? null,
            email_addresses: [normalized],
            phone_numbers: [],
            linkedin_url: null,
            company: extractDomainCompany(normalized),
            title: null,
            relationship_score: null,
            last_interaction_at: ix.occurred_at,
            first_interaction_at: ix.occurred_at,
            interaction_count: 1,
            tags: ['loom-viewer'],
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
