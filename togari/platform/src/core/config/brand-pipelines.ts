/**
 * Canonical brand → pipeline mapping. BMA operates three in-house brands
 * (Amber, Rytual, Togari) as special clients alongside external clients.
 * Each brand has the same four pipelines.
 *
 * When this list changes (new brand, new pipeline type), edit this file
 * and update the BRAND DETECTION + PIPELINE VOCABULARY MAP sections of
 * the classifier system prompt to match. Currently 16 brand+pipeline
 * combos; if this grows past ~50 or starts to vary per-tenant, move to
 * a BQ table (togari_brand_pipelines) instead.
 */

export const ALL_BRANDS = ['bma', 'amber', 'rytual', 'togari'] as const;
export type ClientBrand = typeof ALL_BRANDS[number];

export const ALL_PIPELINES = ['inbound', 'outbound', 'partnership', 'fundraising'] as const;
export type Pipeline = typeof ALL_PIPELINES[number];

export const BRAND_PIPELINES: Record<ClientBrand, readonly Pipeline[]> = {
  bma:    ['inbound', 'outbound', 'partnership', 'fundraising'],
  amber:  ['inbound', 'outbound', 'partnership', 'fundraising'],
  rytual: ['inbound', 'outbound', 'partnership', 'fundraising'],
  togari: ['inbound', 'outbound', 'partnership', 'fundraising'],
};

export const DEFAULT_BRAND: ClientBrand = 'bma';
export const DEFAULT_PIPELINE: Pipeline = 'inbound';

export function isValidBrand(s: string | null | undefined): s is ClientBrand {
  return !!s && (ALL_BRANDS as readonly string[]).includes(s);
}

export function isValidPipeline(s: string | null | undefined): s is Pipeline {
  return !!s && (ALL_PIPELINES as readonly string[]).includes(s);
}

/**
 * Normalize colloquial / legacy pipeline strings to the canonical singular form.
 *
 *   - "partnerships" (legacy plural) → "partnership"
 *   - "partners" / "partnering" / "partner" → "partnership"
 *   - Case-insensitive, trimmed
 *   - Returns null for empty/null input so callers can default
 *   - Returns null for unknown strings so callers can throw a clear error
 *
 * NOTE: this is the single chokepoint for legacy-vocab repair. If we ever
 * see another colloquialism appear in production data (e.g. "fundraises"
 * for "fundraising"), add the alias here rather than every callsite.
 */
export function normalizePipeline(raw: string | null | undefined): Pipeline | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (t === '') return null;
  // Singularize the partnership family.
  if (t === 'partnerships' || t === 'partners' || t === 'partnering' || t === 'partner') {
    return 'partnership';
  }
  // Already canonical?
  if ((ALL_PIPELINES as readonly string[]).includes(t)) return t as Pipeline;
  return null;
}

/**
 * Brand+pipeline validator. Pipeline is normalized first so legacy
 * plural ("partnerships") and colloquial forms don't false-reject a
 * legitimate brand-only update on a pre-Patch-H row.
 */
export function isValidBrandPipelineCombo(brand: string, pipeline: string): boolean {
  const normalized = normalizePipeline(pipeline);
  if (!normalized) return false;
  return isValidBrand(brand) && BRAND_PIPELINES[brand].includes(normalized);
}
