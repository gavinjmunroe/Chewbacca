/**
 * Patch L — Central registry of entity ID prefixes. Every entity in the
 * warehouse has a typed prefixed ID — the prefix alone tells you what
 * kind of entity the ID points to, anywhere in the system. Add a new
 * entry here when introducing a new entity type; do NOT invent prefixes
 * inline at the call site.
 *
 * The typed PK column IS the cross-entity linkage — no separate
 * "togari_id" column is needed because the prefix gives every PK a
 * globally unique meaning across all tables.
 */

import { randomUUID } from 'crypto';

export const ID_PREFIXES = {
  company: 'tco',
  contact: 'tct',
  deal: 'tdl',
  capture: 'tcp',
  // Future: 'ttp' template, 'tac' activity, 'tem' email, 'tmt' meeting alias, 'tin' interaction, etc.
  // Reserve new prefixes here BEFORE writing any code that uses them.
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;

/**
 * Slugify a name for inclusion in an ID. Lowercase, alphanumeric +
 * underscores, max 50 chars. "Serif Health Inc" → "serif_health".
 */
function slugify(name: string): string {
  const corp = / (inc|llc|ltd|co|corp|corporation|company|group)\.?$/i;
  let s = name.toLowerCase().replace(corp, '');
  s = s.replace(/[^a-z0-9]+/g, '_');
  s = s.replace(/^_+|_+$/g, '');
  return s.slice(0, 50);
}

/**
 * Generate a prefixed ID. If a `name` hint is provided, slugify it for
 * a human-readable ID (e.g. "tco_serif_health"). Otherwise emit a
 * UUID-suffixed ID (e.g. "tcp_a8f3b2c1").
 *
 * For name-based IDs, the caller is responsible for handling collisions
 * (typically by appending a suffix or by using upsert semantics).
 */
export function generateId(kind: EntityKind, name?: string): string {
  const prefix = ID_PREFIXES[kind];
  if (name) {
    const slug = slugify(name);
    if (slug) return `${prefix}_${slug}`;
  }
  return `${prefix}_${randomUUID().split('-')[0]}`;
}

/**
 * Identify what kind of entity an ID points to by its prefix. Returns
 * null for malformed input or unknown prefixes.
 */
export function identifyEntity(id: string): EntityKind | null {
  if (!id || typeof id !== 'string') return null;
  const prefix = id.split('_')[0];
  for (const [kind, p] of Object.entries(ID_PREFIXES)) {
    if (p === prefix) return kind as EntityKind;
  }
  return null;
}

/** True iff `id` is a valid prefixed entity ID. */
export function isValidEntityId(id: string): boolean {
  return identifyEntity(id) !== null;
}
