// Placeholder detection for stub-enriched contact data.
//
// The enrichment stub backfills unenriched contacts with a single fabricated
// pair — company "Globex", title "Product Manager" — so the contacts list
// rendered page after page of identical "Product Manager · Globex" against real
// people's names. Showing nothing is better than showing something invented.
//
// Kept in its own import-free module so the rule is unit-testable and lives
// outside any component.

/** Company names the stub enricher invents. Widen if the stub grows. */
const PLACEHOLDER_COMPANIES = new Set(['globex']);

/** The blanket title the stub applies to everyone. */
const PLACEHOLDER_TITLES = new Set(['product manager']);

// Deliberately narrow: blanket-blocking plausible real company names (Acme,
// Initech) would hide genuine data, which is the opposite failure. A contact
// genuinely at a company called Globex loses one line; a thousand contacts
// falsely labeled do not.
export function isPlaceholderCompany(company?: string): boolean {
  return PLACEHOLDER_COMPANIES.has((company ?? '').trim().toLowerCase());
}

export function isPlaceholderTitle(title?: string): boolean {
  return PLACEHOLDER_TITLES.has((title ?? '').trim().toLowerCase());
}

/**
 * The "title · company" secondary line, with stub values dropped. Returns '' when
 * nothing real survives — callers must render no line rather than a filler.
 * A stub title paired with a real company keeps only the company, and vice versa.
 */
export function realRole(title?: string, company?: string): string {
  const t = (title ?? '').trim();
  const c = (company ?? '').trim();
  return [isPlaceholderTitle(t) ? '' : t, isPlaceholderCompany(c) ? '' : c]
    .filter(Boolean)
    .join(' · ');
}
