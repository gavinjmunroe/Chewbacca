/**
 * @togari/admin — Google Drive Source Adapter
 *
 * Fetches files and metadata via the Google Drive API (googleapis) for
 * incremental ingestion into the Personal Data Warehouse.
 */

import { google, drive_v3 } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../observability/logger';
import { SourceAdapter } from '../ingest-orchestrator';
import { emailToPersonId } from '../person-resolver';
import type {
  GDriveIngestConfig,
  Interaction,
  Person,
  RawRecord,
} from '../types';

const logger = createLogger('GDriveAdapter');

export class GDriveAdapter extends SourceAdapter {
  readonly source = 'gdrive' as const;

  private drive: drive_v3.Drive;
  private ownerId: string;
  private ownerEmail: string;
  private maxResults: number;
  private exportContent: boolean;

  constructor(config: GDriveIngestConfig, ownerId: string, ownerEmail: string) {
    super();
    this.ownerId = ownerId;
    this.ownerEmail = ownerEmail;
    this.maxResults = config.maxResults ?? 100;
    this.exportContent = config.exportContent ?? true;

    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
    auth.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken,
    });
    this.drive = google.drive({ version: 'v3', auth });
  }

  async fetchIncremental(watermark: string | null): Promise<RawRecord[]> {
    const records: RawRecord[] = [];
    let pageToken: string | undefined;
    let totalFetched = 0;

    // Build query for files modified after the watermark
    let query = "trashed = false";
    if (watermark) {
      query += ` and modifiedTime > '${watermark}'`;
    }

    do {
      const listResponse = await this.drive.files.list({
        q: query,
        pageSize: Math.min(this.maxResults - totalFetched, 100),
        pageToken,
        fields:
          'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, owners, sharingUser, shared, permissions, webViewLink, size)',
        orderBy: 'modifiedTime desc',
      });

      const files = listResponse.data.files ?? [];

      for (const file of files) {
        if (!file.id) continue;

        const rawData: Record<string, unknown> = {
          ...file,
        };

        // For Google Docs, optionally export as plain text
        if (
          this.exportContent &&
          file.mimeType === 'application/vnd.google-apps.document'
        ) {
          try {
            const exportResponse = await this.drive.files.export({
              fileId: file.id,
              mimeType: 'text/plain',
            });
            rawData.exported_text = exportResponse.data;
          } catch (err) {
            logger.error(`Failed to export doc ${file.id} as text`, err);
          }
        }

        // Fetch permissions to get sharing info
        try {
          const permResponse = await this.drive.permissions.list({
            fileId: file.id,
            fields: 'permissions(id, emailAddress, displayName, role, type)',
          });
          rawData.permissions_list = permResponse.data.permissions ?? [];
        } catch (err) {
          logger.error(`Failed to fetch permissions for ${file.id}`, err);
        }

        records.push({
          source_id: file.id,
          source: 'gdrive',
          raw_data: rawData,
          fetched_at: new Date().toISOString(),
        });
        totalFetched++;

        if (totalFetched >= this.maxResults) break;
      }

      pageToken = listResponse.data.nextPageToken ?? undefined;
    } while (pageToken && totalFetched < this.maxResults);

    logger.info(`GDrive: fetched ${records.length} files`);
    return records;
  }

  async transform(raw: RawRecord[]): Promise<Interaction[]> {
    const interactions: Interaction[] = [];

    for (const record of raw) {
      try {
        const file = record.raw_data as Record<string, unknown>;
        const permissions = (file.permissions_list as Array<{
          emailAddress?: string;
          displayName?: string;
          role?: string;
          type?: string;
        }>) ?? [];
        const owners = (file.owners as Array<{ emailAddress?: string; displayName?: string }>) ?? [];

        // Gather all participant emails
        const participantEmails: string[] = [];
        for (const owner of owners) {
          if (owner.emailAddress) participantEmails.push(owner.emailAddress.toLowerCase());
        }
        for (const perm of permissions) {
          if (perm.emailAddress && perm.type === 'user') {
            participantEmails.push(perm.emailAddress.toLowerCase());
          }
        }
        const uniqueParticipants = [...new Set(participantEmails)];

        // Primary person: the first non-owner counterparty
        const counterparties = uniqueParticipants.filter(
          (e) => e !== this.ownerEmail.toLowerCase(),
        );
        const primaryEmail = counterparties[0] ?? uniqueParticipants[0] ?? '';
        const primaryPersonId = emailToPersonId(primaryEmail);

        // Determine direction
        const ownerEmails = owners.map((o) => o.emailAddress?.toLowerCase() ?? '');
        const isOwnedByUs = ownerEmails.includes(this.ownerEmail.toLowerCase());
        const direction = isOwnedByUs ? 'outbound' : 'inbound';

        const modifiedTime = file.modifiedTime as string | undefined;

        const interaction: Interaction = {
          interaction_id: uuidv4(),
          owner_id: this.ownerId,
          person_id: primaryPersonId,
          counterparty_person_ids: counterparties.slice(1).map((e) => emailToPersonId(e)),
          channel: 'gdrive',
          direction,
          interaction_type: 'document_share',
          subject: (file.name as string) ?? null,
          summary: null,
          raw_content_gcs_uri: null,
          sentiment: null,
          topics: [],
          action_items: [],
          duration_seconds: null,
          participants: uniqueParticipants,
          source_id: record.source_id,
          source_metadata: {
            mime_type: file.mimeType,
            web_view_link: file.webViewLink,
            size: file.size,
            created_time: file.createdTime,
            has_exported_text: !!file.exported_text,
          },
          occurred_at: modifiedTime
            ? new Date(modifiedTime).toISOString()
            : new Date().toISOString(),
          ingested_at: new Date().toISOString(),
        };

        interactions.push(interaction);
      } catch (err) {
        logger.error(`Failed to transform GDrive file ${record.source_id}`, err);
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
            tags: ['document-collaborator'],
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
