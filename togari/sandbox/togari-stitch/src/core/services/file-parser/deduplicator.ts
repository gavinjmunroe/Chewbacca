/**
 * @togari/core/services/file-parser/deduplicator
 * Within-file duplicate detection based on work_email + linkedin_url composite key.
 * Tenant-scoped — only deduplicates within the same upload/client.
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('Deduplicator');

// ============================================================================
// TYPES
// ============================================================================

export interface DuplicateEntry {
  /** Row index of the duplicate (0-based) */
  row: number;
  /** Row index of the original that this duplicates */
  duplicateOf: number;
  /** The composite key that matched */
  key: string;
}

export interface DeduplicationResult {
  /** Rows with duplicates removed */
  unique: Record<string, unknown>[];
  /** Info about detected duplicates */
  duplicates: DuplicateEntry[];
}

// ============================================================================
// DEDUPLICATOR
// ============================================================================

/**
 * Extracts a dedup key from a row using email + linkedin fields.
 * Returns null if neither field has a usable value.
 */
function extractKey(row: Record<string, unknown>): string | null {
  // Try multiple field name variants for email
  const email = (
    row.work_email || row.workEmail || row.email || row.Email || row.work_Email || ''
  ) as string;

  // Try multiple field name variants for LinkedIn
  const linkedin = (
    row.linkedin_url || row.linkedinUrl || row.linkedin || row.LinkedIn || row.linkedIn_url || ''
  ) as string;

  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
  const normalizedLinkedin = typeof linkedin === 'string' ? linkedin.toLowerCase().trim() : '';

  // Need at least one field to form a key
  if (!normalizedEmail && !normalizedLinkedin) return null;

  return `${normalizedEmail}|${normalizedLinkedin}`;
}

/**
 * Deduplicate rows within a single file upload.
 * Uses a composite key of work_email + linkedin_url.
 * First occurrence wins — subsequent duplicates are flagged.
 */
export function deduplicateRows(rows: Record<string, unknown>[]): DeduplicationResult {
  const seen = new Map<string, number>(); // key → first row index
  const unique: Record<string, unknown>[] = [];
  const duplicates: DuplicateEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const key = extractKey(rows[i]);

    if (key === null) {
      // No dedup key — keep the row (can't determine uniqueness)
      unique.push(rows[i]);
      continue;
    }

    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // Duplicate found
      duplicates.push({
        row: i,
        duplicateOf: existingIndex,
        key,
      });
    } else {
      seen.set(key, i);
      unique.push(rows[i]);
    }
  }

  if (duplicates.length > 0) {
    logger.info('Duplicates detected in file', {
      totalRows: rows.length,
      uniqueRows: unique.length,
      duplicateCount: duplicates.length,
    });
  }

  return { unique, duplicates };
}
