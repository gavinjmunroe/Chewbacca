/**
 * String normalization helpers used for fuzzy matching across companies,
 * contacts, captures, and any future entity. Pure functions, no I/O — safe
 * to import anywhere in the codebase.
 */

const CORP_SUFFIXES = [
  ' inc', ' inc.', ' llc', ' l.l.c.', ' ltd', ' ltd.', ' co', ' co.',
  ' corp', ' corp.', ' corporation', ' company', ' .com', '.com',
  ' the', ' group', ' partners', ' holdings',
];

// Characters we strip out of names before comparison. Listed explicitly
// (rather than as a regex range) so a typo doesn't silently expand the
// set — e.g. an unescaped `=-_` would have collapsed the entire ASCII
// run from '=' to '_' into the strip-set.
const NAME_PUNCT_RE = /[.,/#!$%^&*;:{}=\-_`~()\[\]'"]/g;

/**
 * Lowercase + collapse whitespace + strip common corporate suffixes + strip
 * punctuation. Used as the canonical comparison form for entity names.
 * Returns empty string for null/undefined.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  // Strip suffixes iteratively — "Acme Inc Corp" → "acme"
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of CORP_SUFFIXES) {
      if (s.endsWith(suf)) {
        s = s.slice(0, -suf.length).trim();
        changed = true;
      }
    }
  }
  // Strip remaining punctuation, collapse whitespace.
  s = s.replace(NAME_PUNCT_RE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Normalize a person's name: lowercase, trim, collapse whitespace, strip
 * common suffixes (Jr., Sr., III). First-name-only matching falls out
 * naturally from this + the substring check in fuzzyMatch.
 */
export function normalizePersonName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/\b(jr|sr|iii|ii|iv)\.?$/i, '').trim();
  s = s.replace(/[.,]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Levenshtein distance — edits required to turn a into b.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = Array.from(
    { length: a.length + 1 },
    () => new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Length-scaled fuzzy match. Substring match always wins; otherwise
 * Levenshtein with a threshold tied to the target's length.
 *
 *   - target ≤ 4 chars  → exact match only after normalization
 *   - target ≤ 8 chars  → allow 1 edit
 *   - target ≤ 16 chars → allow 2 edits
 *   - longer            → allow 3 edits OR 25% of length, whichever is larger
 */
export function fuzzyMatch(
  query: string,
  target: string,
  options: { normalizer?: (s: string) => string } = {},
): boolean {
  const norm = options.normalizer ?? normalizeCompanyName;
  const q = norm(query);
  const t = norm(target);
  if (!q || !t) return false;
  if (q === t) return true;
  // Substring counts as a match (handles "serif" → "serif health").
  if (t.includes(q) || q.includes(t)) return true;
  const threshold =
    t.length <= 4 ? 0 :
    t.length <= 8 ? 1 :
    t.length <= 16 ? 2 :
    Math.max(3, Math.floor(t.length * 0.25));
  return levenshtein(q, t) <= threshold;
}

/**
 * Score a fuzzy match (0 = no match, 1 = exact). Used to rank candidates
 * when multiple targets match the same query. Higher is better.
 */
export function fuzzyScore(
  query: string,
  target: string,
  options: { normalizer?: (s: string) => string } = {},
): number {
  const norm = options.normalizer ?? normalizeCompanyName;
  const q = norm(query);
  const t = norm(target);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q) || q.includes(t)) {
    // Shorter target with the query as substring is a better match.
    return 0.9 - Math.min(0.4, Math.abs(t.length - q.length) / Math.max(t.length, 1) * 0.4);
  }
  const dist = levenshtein(q, t);
  const maxLen = Math.max(q.length, t.length, 1);
  return Math.max(0, 1 - dist / maxLen) * 0.7;  // cap non-substring matches at 0.7
}
