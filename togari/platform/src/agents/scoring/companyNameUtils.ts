/**
 * Utility functions for normalizing and generating search-friendly variants
 * of company names.
 *
 * Many enrichment APIs (ZoomInfo, Enformion BusinessV2) use string-matching
 * against their indexed company names, which are often stored differently from
 * the name we have on file. Small differences — legal suffixes, punctuation in
 * abbreviations, "&" vs "and", spaces in short-prefix acronyms — cause 0-result
 * or wrong-company responses. This module generates plausible alternate forms
 * so the calling code can retry with a cleaner name.
 */

/**
 * Legal entity suffixes that appear at the end of company names.
 * Ordered from longest to shortest so we strip the most specific form first.
 */
const LEGAL_SUFFIXES = [
  // Multi-word / punctuated forms
  /,?\s+co\.,?\s+inc\.?$/i,
  /,?\s+co\.,?\s+llc\.?$/i,
  /,?\s+l\.l\.c\.?$/i,
  /,?\s+inc\.?$/i,
  /,?\s+llc\.?$/i,
  /,?\s+ltd\.?$/i,
  /,?\s+corp\.?$/i,
  /,?\s+co\.?$/i,
  /,?\s+lp\.?$/i,
  /,?\s+llp\.?$/i,
  // Without leading comma/space (e.g. "AcmeLLC")
  /\s+incorporated$/i,
  /\s+corporation$/i,
  /\s+company$/i,
  /\s+limited$/i,
];

/**
 * Remove trailing legal entity suffixes from a company name.
 * Returns the stripped name, or the original if no suffix matched.
 *
 * @example
 * stripLegalSuffix("Bluefin Mechanical, LLC.") // "Bluefin Mechanical"
 * stripLegalSuffix("JS Thomas Service, Inc.")  // "JS Thomas Service"
 * stripLegalSuffix("M. B. Kiser Heating & Air Conditioning Co. Inc.") // "M. B. Kiser Heating & Air Conditioning"
 */
export function stripLegalSuffix(name: string): string {
  let result = name.trim();
  for (const pattern of LEGAL_SUFFIXES) {
    const stripped = result.replace(pattern, "").trim();
    if (stripped.length > 0 && stripped !== result) {
      result = stripped;
      // Strip multiple suffixes (e.g. "Co., Inc.")
      for (const p2 of LEGAL_SUFFIXES) {
        const s2 = result.replace(p2, "").trim();
        if (s2.length > 0 && s2 !== result) {
          result = s2;
        }
      }
      break;
    }
  }
  return result;
}

/**
 * Normalize abbreviation punctuation in company names.
 * Removes periods inside abbreviations so "M. B. Kiser" → "MB Kiser"
 * and "J.S. Thomas" → "JS Thomas".
 *
 * Also normalises multiple spaces left after period removal.
 */
export function normalizeAbbreviations(name: string): string {
  // "M. B." → "MB" — single letters followed by period and space/letter
  return name
    .replace(/\b([A-Z])\.\s+(?=[A-Z])/g, "$1") // "M. B." → "MB "
    .replace(/\b([A-Z])\.\s*\b/g, "$1") // "J.S." → "JS"
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Normalise ampersand in company names (swap "&" ↔ "and").
 * Returns both forms so the caller can try either.
 *
 * @example
 * ampersandVariants("Heating & Cooling")  // ["Heating & Cooling", "Heating and Cooling"]
 * ampersandVariants("Heating and Cooling") // ["Heating and Cooling", "Heating & Cooling"]
 */
export function ampersandVariants(name: string): [string, string] {
  if (name.includes(" & ")) {
    return [name, name.replace(/ & /g, " and ")];
  }
  if (/ and /i.test(name)) {
    return [name, name.replace(/ and /gi, " & ")];
  }
  return [name, name];
}

/**
 * If the company name starts with a short (2–3 char) word that looks like
 * an acronym or state abbreviation followed by more words, generate a
 * no-spaces variant for that prefix.
 *
 * This helps with Enformion Business (SOS) searches where short acronym
 * prefixes are sometimes concatenated.
 *
 * @example
 * noSpacePrefixVariant("GA Central Mechanical") // "GACentral Mechanical"
 * noSpacePrefixVariant("JS Thomas Service")      // "JSThomas Service"
 * noSpacePrefixVariant("Bluefin Mechanical")     // null (first word is long)
 */
export function noSpacePrefixVariant(name: string): string | null {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return null;
  const firstWord = words[0] ?? "";
  if (
    firstWord.length >= 2 &&
    firstWord.length <= 3 &&
    /^[A-Z]+$/.test(firstWord)
  ) {
    return [firstWord + (words[1] ?? ""), ...words.slice(2)].join(" ");
  }
  return null;
}

/**
 * Generate an ordered list of search-friendly company name variants.
 *
 * The first element is always the original name. Subsequent elements are
 * progressively normalized alternatives the caller should try when the
 * initial search returns 0 results.
 *
 * Deduplication is applied so the same string never appears twice.
 *
 * @param name - The canonical company name
 * @returns Deduplicated array of name variants, original first
 *
 * @example
 * generateCompanyNameVariants("JS Thomas Service, Inc.")
 * // ["JS Thomas Service, Inc.", "JS Thomas Service", "JSThomas Service"]
 *
 * generateCompanyNameVariants("M. B. Kiser Heating & Air Conditioning Co. Inc.")
 * // ["M. B. Kiser Heating & Air Conditioning Co. Inc.",
 * //  "M. B. Kiser Heating & Air Conditioning",
 * //  "MB Kiser Heating & Air Conditioning",
 * //  "MB Kiser Heating and Air Conditioning"]
 */
export function generateCompanyNameVariants(name: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];

  function add(v: string): void {
    const trimmed = v.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      variants.push(trimmed);
    }
  }

  // 1. Original name
  add(name);

  // 2. Strip legal suffix
  const stripped = stripLegalSuffix(name);
  add(stripped);

  // 3. Normalize abbreviation punctuation (applied to both orignal and stripped)
  const normalizedOriginal = normalizeAbbreviations(name);
  add(normalizedOriginal);

  const normalizedStripped = normalizeAbbreviations(stripped);
  add(normalizedStripped);

  // 4. Ampersand variants of the normalized+stripped form
  const [amp1, amp2] = ampersandVariants(normalizedStripped);
  add(amp1);
  add(amp2);

  // Also try ampersand variants of the original stripped (before abbrev normalization)
  const [ampS1, ampS2] = ampersandVariants(stripped);
  add(ampS1);
  add(ampS2);

  // 5. No-space prefix variant (for short acronym prefixes like "GA", "JS")
  for (const base of [normalizedStripped, stripped, name]) {
    const nsp = noSpacePrefixVariant(base);
    if (nsp) add(nsp);
  }

  return variants;
}
