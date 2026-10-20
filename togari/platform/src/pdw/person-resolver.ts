/**
 * @togari/admin — Person Resolver
 *
 * Handles person deduplication via email-based matching.
 * Primary key is SHA-256 of the lowercase primary email.
 */

import { createHash } from 'crypto';
import { BigQuery } from '@google-cloud/bigquery';
import { createLogger } from '../observability/logger';
import type { Person, PersonResolution } from './types';

const logger = createLogger('PersonResolver');

/** Generate a deterministic person_id from an email address */
export function emailToPersonId(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export class PersonResolver {
  private bq: BigQuery;
  private dataset: string;
  private ownerId: string;

  /** In-memory cache of email -> person_id for current run */
  private emailIndex: Map<string, string> = new Map();

  constructor(bq: BigQuery, ownerId: string, dataset = 'togari_pdw') {
    this.bq = bq;
    this.ownerId = ownerId;
    this.dataset = dataset;
  }

  /**
   * Load the email -> person_id index from BigQuery into memory.
   * Call once before processing a batch.
   */
  async loadIndex(): Promise<void> {
    const query = `
      SELECT person_id, email_addresses
      FROM \`${this.dataset}.persons\`
      WHERE owner_id = @ownerId
    `;
    const [rows] = await this.bq.query({ query, params: { ownerId: this.ownerId } });
    this.emailIndex.clear();
    for (const row of rows as Array<{ person_id: string; email_addresses: string[] }>) {
      for (const email of row.email_addresses ?? []) {
        this.emailIndex.set(email.toLowerCase().trim(), row.person_id);
      }
    }
    logger.info(`Loaded ${this.emailIndex.size} email mappings for owner ${this.ownerId}`);
  }

  /**
   * Resolve a single email to a person_id.
   * Returns existing person_id if known, or generates a new one.
   */
  resolvePersonId(email: string): PersonResolution {
    const normalized = email.toLowerCase().trim();
    const existing = this.emailIndex.get(normalized);
    if (existing) {
      return { email: normalized, person_id: existing, is_new: false };
    }
    const person_id = emailToPersonId(normalized);
    // Register in the in-memory cache so subsequent calls find it
    this.emailIndex.set(normalized, person_id);
    return { email: normalized, person_id, is_new: true };
  }

  /**
   * Merge two Person records, keeping the most recent non-null values.
   * The existing record is the "base" and incoming is overlaid on top.
   */
  mergePersons(existing: Person, incoming: Partial<Person>): Person {
    const merged: Person = { ...existing };

    // Scalar fields: keep incoming if non-null
    if (incoming.full_name) merged.full_name = incoming.full_name;
    if (incoming.linkedin_url) merged.linkedin_url = incoming.linkedin_url;
    if (incoming.company) merged.company = incoming.company;
    if (incoming.title) merged.title = incoming.title;

    // Merge email arrays (union, deduplicated)
    if (incoming.email_addresses?.length) {
      const emailSet = new Set(merged.email_addresses.map((e) => e.toLowerCase().trim()));
      for (const e of incoming.email_addresses) {
        emailSet.add(e.toLowerCase().trim());
      }
      merged.email_addresses = Array.from(emailSet);
    }

    // Merge phone numbers
    if (incoming.phone_numbers?.length) {
      const phoneSet = new Set(merged.phone_numbers);
      for (const p of incoming.phone_numbers) phoneSet.add(p);
      merged.phone_numbers = Array.from(phoneSet);
    }

    // Merge tags
    if (incoming.tags?.length) {
      const tagSet = new Set(merged.tags);
      for (const t of incoming.tags) tagSet.add(t);
      merged.tags = Array.from(tagSet);
    }

    // Interaction bookkeeping
    if (incoming.interaction_count) {
      merged.interaction_count += incoming.interaction_count;
    }
    if (incoming.last_interaction_at) {
      if (!merged.last_interaction_at || incoming.last_interaction_at > merged.last_interaction_at) {
        merged.last_interaction_at = incoming.last_interaction_at;
      }
    }
    if (incoming.first_interaction_at) {
      if (
        !merged.first_interaction_at ||
        incoming.first_interaction_at < merged.first_interaction_at
      ) {
        merged.first_interaction_at = incoming.first_interaction_at;
      }
    }

    // Merge metadata
    if (incoming.metadata) {
      merged.metadata = { ...(merged.metadata ?? {}), ...incoming.metadata };
    }

    merged.updated_at = new Date().toISOString();
    return merged;
  }

  /**
   * Deduplicate a list of Person records by person_id.
   * Multiple records with the same person_id are merged together.
   */
  deduplicatePersons(persons: Person[]): Person[] {
    const map = new Map<string, Person>();
    for (const p of persons) {
      const existing = map.get(p.person_id);
      if (existing) {
        map.set(p.person_id, this.mergePersons(existing, p));
      } else {
        map.set(p.person_id, p);
      }
    }
    return Array.from(map.values());
  }
}
