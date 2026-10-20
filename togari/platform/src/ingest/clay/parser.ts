/**
 * @togari/admin — Clay payload parsing helpers
 *
 * Deterministic canonical JSON (sorted keys) for payload hashing so replays
 * of the same Clay run produce the same hash and the persister can no-op.
 */

import crypto from "crypto";
import type { ClayCompany, ClayContact, ClayWebhookPayload } from "./schema";

/** Recursively sort object keys to produce a stable JSON string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function hashPayload(payload: ClayWebhookPayload): string {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex");
}

/**
 * Build a stable dedupe key for a company within a tenant.
 * Order of precedence: website → domain → lowercased name.
 * Returns null only if the company has no usable identifier (shouldn't happen
 * because name is required, but defensive).
 */
export function companyDedupeKey(company: ClayCompany): string | null {
  if (company.website) return normalizeDomainLike(company.website);
  if (company.domain) return normalizeDomainLike(company.domain);
  if (company.name) return company.name.trim().toLowerCase();
  return null;
}

/**
 * Build a stable dedupe key for a contact within a tenant + company.
 * Order of precedence: email → linkedin_url → lowercased full_name.
 */
export function contactDedupeKey(contact: ClayContact): string | null {
  if (contact.email) return contact.email.trim().toLowerCase();
  if (contact.linkedin_url) return contact.linkedin_url.trim().toLowerCase();
  if (contact.full_name) return contact.full_name.trim().toLowerCase();
  return null;
}

/** Strip protocol, leading "www.", trailing slash. Used for dedupe key only. */
export function normalizeDomainLike(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\/$/, "");
}

/**
 * Split a Clay row's contacts into normalized full names so we always have
 * something to land in `contacts.full_name`. If neither full_name nor
 * first/last is provided we drop the contact.
 */
export function normalizeContactName(
  contact: ClayContact,
): { full: string; first: string | null; last: string | null } | null {
  if (contact.full_name) {
    const parts = contact.full_name.trim().split(/\s+/);
    return {
      full: contact.full_name.trim(),
      first: contact.first_name ?? parts[0] ?? null,
      last:
        contact.last_name ??
        (parts.length > 1 ? parts.slice(1).join(" ") : null),
    };
  }
  if (contact.first_name || contact.last_name) {
    const full = [contact.first_name, contact.last_name]
      .filter(Boolean)
      .join(" ");
    return {
      full,
      first: contact.first_name ?? null,
      last: contact.last_name ?? null,
    };
  }
  return null;
}
