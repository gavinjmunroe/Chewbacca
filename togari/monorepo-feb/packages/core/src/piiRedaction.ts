/**
 * PII Redaction Utility
 * Automatically redacts sensitive information from logs and error messages
 *
 * Redacts:
 * - Email addresses
 * - Phone numbers
 * - Credit card numbers
 * - Social security numbers
 * - API keys and tokens
 * - Passwords
 * - IP addresses (optional)
 */

const REDACTED = '[REDACTED]';

// Patterns for sensitive data
const PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

  // API keys and tokens (various formats)
  apiKey: /\b[A-Za-z0-9_-]{32,}\b/g, // Long alphanumeric strings
  bearer: /Bearer\s+[A-Za-z0-9_-]+/gi,
  basicAuth: /Basic\s+[A-Za-z0-9+/=]+/gi,
};

// Field names that should be redacted (case-insensitive)
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'apikey',
  'api_key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'auth',
  'apiSecret',
  'api_secret',
  'privatekey',
  'private_key',
  'ssn',
  'social_security',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'pin',
]);

/**
 * Redact sensitive data from a string
 */
export function redactString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let redacted = text;

  // Redact email addresses
  redacted = redacted.replace(PATTERNS.email, REDACTED);

  // Redact phone numbers
  redacted = redacted.replace(PATTERNS.phone, REDACTED);

  // Redact credit card numbers
  redacted = redacted.replace(PATTERNS.creditCard, REDACTED);

  // Redact SSN
  redacted = redacted.replace(PATTERNS.ssn, REDACTED);

  // Redact Bearer tokens
  redacted = redacted.replace(PATTERNS.bearer, `Bearer ${REDACTED}`);

  // Redact Basic Auth
  redacted = redacted.replace(PATTERNS.basicAuth, `Basic ${REDACTED}`);

  return redacted;
}

/**
 * Redact sensitive fields from an object
 * Creates a deep copy with sensitive values replaced
 */
export function redactObject<T = unknown>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitive types
  if (typeof obj !== 'object') {
    return (typeof obj === 'string' ? redactString(obj) : obj) as T;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as T;
  }

  // Handle objects
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if field name is sensitive
    if (SENSITIVE_FIELDS.has(lowerKey)) {
      redacted[key] = REDACTED;
      continue;
    }

    // Recursively redact nested objects
    if (value !== null && typeof value === 'object') {
      redacted[key] = redactObject(value);
    } else if (typeof value === 'string') {
      redacted[key] = redactString(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted as T;
}

/**
 * Redact sensitive data from error objects
 */
export function redactError(error: Error): Record<string, unknown> {
  const errorAsRecord = error as unknown as Record<string, unknown>;

  return {
    name: error.name,
    message: redactString(error.message),
    stack: error.stack ? redactString(error.stack) : undefined,
    ...redactObject(
      Object.keys(error).reduce((acc: Record<string, unknown>, key) => {
        if (key !== 'message' && key !== 'stack' && key !== 'name') {
          acc[key] = errorAsRecord[key];
        }
        return acc;
      }, {})
    ),
  };
}
