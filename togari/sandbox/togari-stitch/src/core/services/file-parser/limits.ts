/**
 * @togari/core/services/file-parser/limits
 * File size and row count limits for file processing pipeline.
 */

import { ValidationError } from '../../errors';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum file size in bytes (50 MB) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Threshold for switching to streaming mode (5 MB) */
export const STREAMING_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** Row count limits per tenant tier */
export const ROW_LIMITS: Record<TenantTier, number> = {
  free: 10_000,
  pro: 100_000,
  enterprise: 1_000_000,
} as const;

export type TenantTier = 'free' | 'pro' | 'enterprise';

// ============================================================================
// VALIDATORS
// ============================================================================

/**
 * Validate file size against the 50MB maximum.
 * @throws ValidationError if file exceeds limit
 */
export function validateFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
    throw new ValidationError(
      `File size ${sizeMB}MB exceeds maximum allowed size of 50MB`
    );
  }
}

/**
 * Validate row count against the tenant tier limit.
 * @throws ValidationError if row count exceeds tier limit
 */
export function validateRowCount(rowCount: number, tier: TenantTier = 'pro'): void {
  const limit = ROW_LIMITS[tier];
  if (rowCount > limit) {
    throw new ValidationError(
      `Row count ${rowCount.toLocaleString()} exceeds the ${tier} tier limit of ${limit.toLocaleString()} rows`
    );
  }
}
