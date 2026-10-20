import { createHash } from 'crypto';

/**
 * Generates a SHA-256 hash of the input string
 *
 * @param input - The string to hash
 * @returns Hexadecimal hash string
 *
 * @example
 * ```typescript
 * const hash = hashString('hello world');
 * // Returns: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
 * ```
 */
export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Lead object for hashing
 */
export interface LeadHashInput {
  type: string;
  name?: string;
  domain?: string;
  email?: string;
  fullName?: string;
  companyName?: string;
}

/**
 * Generates a unique hash identifier for a lead
 *
 * For companies: Hashes lowercase(name + domain)
 * For contacts: Hashes lowercase(email) OR lowercase(fullName + companyName)
 *
 * @param lead - The lead object to hash
 * @returns First 16 characters of the SHA-256 hash
 *
 * @example
 * ```typescript
 * // Company lead
 * const companyHash = hashLead({
 *   type: 'company',
 *   name: 'Acme Corp',
 *   domain: 'acme.com'
 * });
 *
 * // Contact lead with email
 * const contactHash1 = hashLead({
 *   type: 'contact',
 *   email: 'john@example.com'
 * });
 *
 * // Contact lead without email
 * const contactHash2 = hashLead({
 *   type: 'contact',
 *   fullName: 'John Doe',
 *   companyName: 'Acme Corp'
 * });
 * ```
 */
export function hashLead(lead: LeadHashInput): string {
  let hashInput = '';

  if (lead.type === 'company') {
    // For companies: hash lowercase(name + domain)
    const name = lead.name || '';
    const domain = lead.domain || '';
    hashInput = (name + domain).toLowerCase();
  } else {
    // For contacts: hash lowercase(email) OR lowercase(fullName + companyName)
    if (lead.email) {
      hashInput = lead.email.toLowerCase();
    } else {
      const fullName = lead.fullName || '';
      const companyName = lead.companyName || '';
      hashInput = (fullName + companyName).toLowerCase();
    }
  }

  // Generate hash and return first 16 characters
  const fullHash = hashString(hashInput);
  return fullHash.substring(0, 16);
}
