/**
 * Validates an email address using RFC 5322 basic validation
 *
 * @param email - The email address to validate
 * @returns True if the email is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidEmail('user@example.com') // true
 * isValidEmail('invalid.email') // false
 * ```
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // RFC 5322 simplified regex for basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates a domain name format
 *
 * @param domain - The domain to validate
 * @returns True if the domain format is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidDomain('example.com') // true
 * isValidDomain('sub.example.com') // true
 * isValidDomain('invalid domain') // false
 * ```
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  // Domain regex: alphanumeric, hyphens, and dots
  // Must have at least one dot and valid TLD
  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
  return domainRegex.test(domain);
}

/**
 * Validates a URL with http or https protocol
 *
 * @param url - The URL to validate
 * @returns True if the URL is valid with http/https protocol, false otherwise
 *
 * @example
 * ```typescript
 * isValidUrl('https://example.com') // true
 * isValidUrl('http://example.com/path') // true
 * isValidUrl('ftp://example.com') // false
 * ```
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a LinkedIn URL for either a company or profile
 *
 * @param url - The LinkedIn URL to validate
 * @param type - The type of LinkedIn URL ('company' or 'profile')
 * @returns True if the URL is a valid LinkedIn URL of the specified type
 *
 * @example
 * ```typescript
 * isValidLinkedInUrl('https://www.linkedin.com/company/acme', 'company') // true
 * isValidLinkedInUrl('https://www.linkedin.com/in/johndoe', 'profile') // true
 * isValidLinkedInUrl('https://example.com', 'profile') // false
 * ```
 */
export function isValidLinkedInUrl(url: string, type: 'company' | 'profile'): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsedUrl = new URL(url);

    // Check if it's a LinkedIn domain
    if (!parsedUrl.hostname.includes('linkedin.com')) {
      return false;
    }

    const pathname = parsedUrl.pathname;

    if (type === 'company') {
      // Company URLs: /company/{name} or /company/{name}/
      return /^\/company\/[a-zA-Z0-9_-]+(\/)?$/.test(pathname);
    } else {
      // Profile URLs: /in/{name} or /in/{name}/
      return /^\/in\/[a-zA-Z0-9_-]+(\/)?$/.test(pathname);
    }
  } catch {
    return false;
  }
}

/**
 * Normalizes a domain by removing protocol, www prefix, and trailing slash
 *
 * @param input - The domain or URL to normalize
 * @returns Normalized domain in lowercase
 *
 * @example
 * ```typescript
 * normalizeDomain('https://www.example.com/') // 'example.com'
 * normalizeDomain('HTTP://Example.COM') // 'example.com'
 * normalizeDomain('www.example.com') // 'example.com'
 * ```
 */
export function normalizeDomain(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let normalized = input.trim().toLowerCase();

  // Remove protocol (http://, https://)
  normalized = normalized.replace(/^https?:\/\//, '');

  // Remove www.
  normalized = normalized.replace(/^www\./, '');

  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '');

  return normalized;
}

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase
 *
 * @param email - The email address to normalize
 * @returns Normalized email in lowercase
 *
 * @example
 * ```typescript
 * normalizeEmail('  User@Example.COM  ') // 'user@example.com'
 * normalizeEmail('John.Doe@ACME.COM') // 'john.doe@acme.com'
 * ```
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return '';
  }

  return email.trim().toLowerCase();
}

/**
 * Normalizes a LinkedIn URL by standardizing format
 *
 * @param url - The LinkedIn URL to normalize
 * @returns Normalized LinkedIn URL
 *
 * @example
 * ```typescript
 * normalizeLinkedInUrl('http://www.linkedin.com/in/johndoe/') // 'https://linkedin.com/in/johndoe'
 * normalizeLinkedInUrl('linkedin.com/in/johndoe?ref=123') // 'https://linkedin.com/in/johndoe'
 * ```
 */
export function normalizeLinkedInUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  let normalized = url.trim().toLowerCase();

  // Ensure https
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  if (!normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  // Remove www.
  normalized = normalized.replace('://www.', '://');

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Remove query parameters
  const queryIndex = normalized.indexOf('?');
  if (queryIndex !== -1) {
    normalized = normalized.slice(0, queryIndex);
  }

  return normalized;
}

/**
 * Extracts domain from email address
 *
 * @param email - The email address
 * @returns The domain part of the email
 *
 * @example
 * ```typescript
 * extractDomainFromEmail('user@example.com') // 'example.com'
 * ```
 */
export function extractDomainFromEmail(email: string): string {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return '';
  }
  return email.split('@')[1]?.toLowerCase() || '';
}

/**
 * Generates a unique ID with optional prefix
 *
 * @param prefix - Optional prefix for the ID
 * @returns A unique string ID
 */
export function generateId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/**
 * Parses a full name into first and last name
 *
 * @param fullName - The full name to parse
 * @returns Object with firstName and lastName
 */
export function parseName(fullName: string): { firstName: string; lastName: string } {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: '', lastName: '' };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * Calculates the number of days between two dates
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @returns Number of days between the dates
 */
export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
  const diffDays = Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
  return diffDays;
}

/**
 * Formats a date to ISO format (YYYY-MM-DD)
 *
 * @param date - The date to format
 * @returns ISO formatted date string
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Delays execution for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
