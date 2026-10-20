/**
 * @togari/storage — togari_company_aliases read-only fetch
 *
 * Replaces the hardcoded company shorthand block in
 * src/core/intent-router.ts:63-73. Tool descriptions reference
 * shorthands inline (so Claude can hit the obvious cases without a
 * lookup), and the resolver tools (deal-ops::searchDeal,
 * company-ops::findCompanyByName) consult the alias map for the long
 * tail.
 *
 * In-memory cache with a 5-minute TTL — the table is tiny (a few dozen
 * rows even at scale) and the read path is per-message, so a per-call
 * BQ round-trip is wasteful.
 *
 * Schema: sql/migrations/0026_togari_company_aliases.sql.
 */

import { BigQueryClient } from '../bigquery/client';
import { resolveDataset } from '../services/dataset-resolver';
import { createLogger } from '../observability/logger';

const logger = createLogger('storage/company-aliases');
const PROJECT_ID = 'midyear-glazing-485303-u3';

interface CacheEntry {
  loadedAt: number;
  aliases: Map<string, string>; // alias (lowercased) → canonical_name
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>(); // tenant_id → entry

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function table(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_company_aliases\``;
}

/**
 * Load all aliases for a tenant, caching for 5 minutes. Falls back to
 * an empty map if the read fails (callers degrade gracefully — without
 * aliases the resolver still works on canonical names).
 */
export async function loadCompanyAliases(tenantId: string): Promise<Map<string, string>> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) {
    return cached.aliases;
  }

  const aliases = new Map<string, string>();
  try {
    const result = await getBqClient().executeQuery(
      `SELECT alias, canonical_name FROM ${table()} WHERE tenant_id = @tenant_id`,
      { tenant_id: tenantId },
    );
    for (const row of result.rows) {
      const alias = String((row as Record<string, unknown>).alias ?? '').toLowerCase().trim();
      const canonical = String((row as Record<string, unknown>).canonical_name ?? '').trim();
      if (alias && canonical) aliases.set(alias, canonical);
    }
  } catch (err) {
    logger.warn('loadCompanyAliases failed — returning empty map', {
      tenant_id: tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  cache.set(tenantId, { loadedAt: Date.now(), aliases });
  return aliases;
}

/**
 * Resolve a single company shorthand to its canonical name. Returns the
 * input unchanged when no alias matches.
 */
export async function resolveCompanyAlias(
  input: string,
  tenantId: string,
): Promise<string> {
  if (!input) return input;
  const aliases = await loadCompanyAliases(tenantId);
  const hit = aliases.get(input.toLowerCase().trim());
  return hit ?? input;
}

/** Test-only: clear the in-memory cache. */
export function _clearCompanyAliasCache(): void {
  cache.clear();
}
