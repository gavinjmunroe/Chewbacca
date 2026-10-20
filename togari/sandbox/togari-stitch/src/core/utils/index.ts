/**
 * Shared utility functions for @togari/core
 */

// Re-export retry utilities
export { withRetry } from './retry';
export type { RetryOptions } from './retry';

// Re-export hashing utilities
export { hashString, hashLead } from './hashing';
export type { LeadHashInput } from './hashing';

// Re-export logger utilities
export { createLogger, default as logger } from './logger';
export type { Logger, LogLevel } from './logger';

// Re-export validation utilities
export {
  isValidEmail,
  isValidDomain,
  isValidUrl,
  isValidLinkedInUrl,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedInUrl,
  extractDomainFromEmail,
  generateId,
  parseName,
  daysBetween,
  formatDateISO,
  sleep,
} from './validation';
