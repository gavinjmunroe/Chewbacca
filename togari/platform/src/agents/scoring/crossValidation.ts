/**
 * Cross-source validation logic for enrichment data.
 *
 * Compares data from multiple sources (ZoomInfo, Enformion, AI) to:
 * - Validate contact information across sources
 * - Boost confidence for corroborated data
 * - Flag discrepancies for review
 * - Calculate address proximity scores
 */

import type {
  AddressData,
  ContactInfoJson,
  EmailWithMetadata,
  PhoneWithMetadata,
} from "../enrichment/types";

/**
 * Result of corroborating a field across sources
 */
export type CorroborationResult = {
  /** Whether any match was found */
  matched: boolean;
  /** The matching values found across sources */
  matchedValues: string[];
  /** Confidence boost based on number of sources corroborating */
  confidenceBoost: number;
  /** Source names that corroborated the value */
  sources: string[];
};

/**
 * Cross-validation summary for a contact
 */
export type CrossValidationSummary = {
  /** Overall cross-source verification status */
  isVerified: boolean;
  /** Email corroboration result */
  email: CorroborationResult;
  /** Phone corroboration result */
  phone: CorroborationResult;
  /** Name fuzzy match result */
  nameMatch: {
    matched: boolean;
    similarity: number;
  };
  /** Address proximity score (0-100) */
  addressProximityScore: number;
  /** Total confidence boost from cross-validation */
  totalConfidenceBoost: number;
  /** List of discrepancies found */
  discrepancies: string[];
  /** Sources that corroborated this contact */
  corroboratingSources: string[];
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) {
    const row = dp[i];
    if (row) row[0] = i;
  }
  const firstRow = dp[0];
  if (firstRow) {
    for (let j = 0; j <= n; j++) firstRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    const currRow = dp[i];
    const prevRow = dp[i - 1];
    if (!currRow || !prevRow) continue;
    for (let j = 1; j <= n; j++) {
      const s1Char = str1[i - 1];
      const s2Char = str2[j - 1];
      if (s1Char === s2Char) {
        currRow[j] = prevRow[j - 1] ?? 0;
      } else {
        currRow[j] =
          1 +
          Math.min(
            prevRow[j] ?? Infinity,
            currRow[j - 1] ?? Infinity,
            prevRow[j - 1] ?? Infinity,
          );
      }
    }
  }

  const lastRow = dp[m];
  return lastRow?.[n] ?? Math.max(m, n);
}

/**
 * Calculate normalized similarity (0-1) using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

/**
 * Normalize a name for comparison
 * - Lowercase
 * - Remove titles (Mr., Mrs., Dr., etc.)
 * - Remove extra whitespace
 * - Remove common suffixes (Jr., Sr., III, etc.)
 */
function normalizeName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?)\b/gi, "")
    .replace(/\b(jr\.?|sr\.?|iii|ii|iv|esq\.?)\b/gi, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Perform fuzzy name matching between two names
 * Uses Levenshtein distance with a threshold for similarity
 *
 * @param name1 First name to compare
 * @param name2 Second name to compare
 * @param threshold Minimum similarity (0-1) to consider a match. Default 0.8
 * @returns Whether the names match and the similarity score
 */
export function fuzzyNameMatch(
  name1: string | null | undefined,
  name2: string | null | undefined,
  threshold = 0.8,
): { matched: boolean; similarity: number } {
  if (!name1 || !name2) {
    return { matched: false, similarity: 0 };
  }

  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);

  if (!normalized1 || !normalized2) {
    return { matched: false, similarity: 0 };
  }

  // Exact match after normalization
  if (normalized1 === normalized2) {
    return { matched: true, similarity: 1 };
  }

  const similarity = calculateSimilarity(normalized1, normalized2);
  return {
    matched: similarity >= threshold,
    similarity,
  };
}

/**
 * Normalize an email for comparison
 */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Normalize a phone number for comparison (digits only)
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  // Handle US numbers: strip leading 1 if present and 11 digits
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Corroborate emails across sources
 *
 * @param emails1 Emails from first source
 * @param emails2 Emails from second source
 * @param source1Name Name of first source
 * @param source2Name Name of second source
 */
export function emailCorroboration(
  emails1: Array<string | EmailWithMetadata>,
  emails2: Array<string | EmailWithMetadata>,
  source1Name: string,
  source2Name: string,
): CorroborationResult {
  const normalized1 = emails1.map((e) =>
    normalizeEmail(typeof e === "string" ? e : e.address),
  );
  const normalized2 = emails2.map((e) =>
    normalizeEmail(typeof e === "string" ? e : e.address),
  );

  const matchedValues: string[] = [];
  const sources = new Set<string>();

  for (const email of normalized1) {
    if (normalized2.includes(email)) {
      matchedValues.push(email);
      sources.add(source1Name);
      sources.add(source2Name);
    }
  }

  const matched = matchedValues.length > 0;

  return {
    matched,
    matchedValues,
    confidenceBoost: matched ? 0.15 : 0,
    sources: Array.from(sources),
  };
}

/**
 * Corroborate phone numbers across sources
 *
 * @param phones1 Phones from first source
 * @param phones2 Phones from second source
 * @param source1Name Name of first source
 * @param source2Name Name of second source
 */
export function phoneCorroboration(
  phones1: Array<string | PhoneWithMetadata>,
  phones2: Array<string | PhoneWithMetadata>,
  source1Name: string,
  source2Name: string,
): CorroborationResult {
  const normalized1 = phones1.map((p) =>
    normalizePhone(typeof p === "string" ? p : p.number),
  );
  const normalized2 = phones2.map((p) =>
    normalizePhone(typeof p === "string" ? p : p.number),
  );

  const matchedValues: string[] = [];
  const sources = new Set<string>();

  for (const phone of normalized1) {
    if (phone.length >= 7) {
      // Avoid matching short/invalid numbers
      // Check for exact match or last 10 digits match
      const matches = normalized2.some((p2) => {
        if (p2.length < 7) return false;
        return phone === p2 || phone.slice(-10) === p2.slice(-10);
      });
      if (matches) {
        matchedValues.push(phone);
        sources.add(source1Name);
        sources.add(source2Name);
      }
    }
  }

  const matched = matchedValues.length > 0;

  return {
    matched,
    matchedValues,
    confidenceBoost: matched ? 0.15 : 0,
    sources: Array.from(sources),
  };
}

/**
 * Calculate distance between two coordinates using Haversine formula
 *
 * @param coord1 First coordinate { lat, lng }
 * @param coord2 Second coordinate { lat, lng }
 * @returns Distance in kilometers
 */
export function calculateDistance(
  coord1: { lat: number; lng: number },
  coord2: { lat: number; lng: number },
): number {
  const R = 6371; // Earth's radius in kilometers

  const lat1Rad = (coord1.lat * Math.PI) / 180;
  const lat2Rad = (coord2.lat * Math.PI) / 180;
  const deltaLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const deltaLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate address proximity score based on coordinates or city/state match
 *
 * @param addr1 First address
 * @param addr2 Second address (e.g., company address)
 * @returns Score 0-100 (100 = within 10km, decreasing with distance)
 */
export function addressProximityScore(
  addr1: AddressData | undefined,
  addr2: AddressData | undefined,
): number {
  if (!addr1 || !addr2) {
    return 0;
  }

  // If both have coordinates, calculate actual distance
  if (addr1.coordinates && addr2.coordinates) {
    const distance = calculateDistance(addr1.coordinates, addr2.coordinates);

    // Score based on distance:
    // <= 10km = 100
    // <= 50km = 80
    // <= 100km = 50
    // <= 200km = 25
    // > 200km = 10
    if (distance <= 10) return 100;
    if (distance <= 50) return 80;
    if (distance <= 100) return 50;
    if (distance <= 200) return 25;
    return 10;
  }

  // Fall back to city/state matching
  const city1 = addr1.city?.toLowerCase().trim();
  const city2 = addr2.city?.toLowerCase().trim();
  const state1 = addr1.state?.toUpperCase().trim();
  const state2 = addr2.state?.toUpperCase().trim();

  // Exact city and state match
  if (city1 && city2 && state1 && state2) {
    if (city1 === city2 && state1 === state2) {
      return 100;
    }
    if (state1 === state2) {
      return 50; // Same state, different city
    }
  }

  return 0;
}

/**
 * Extract emails from a ContactInfoJson
 */
function extractEmails(contact: ContactInfoJson): string[] {
  const emails: string[] = [];
  if (contact.email) emails.push(contact.email);
  if (contact.all_emails) {
    for (const e of contact.all_emails) {
      if (!emails.includes(e.address)) {
        emails.push(e.address);
      }
    }
  }
  return emails;
}

/**
 * Extract phones from a ContactInfoJson
 */
function extractPhones(contact: ContactInfoJson): string[] {
  const phones: string[] = [];
  if (contact.phone) phones.push(contact.phone);
  if (contact.all_phones) {
    for (const p of contact.all_phones) {
      if (!phones.includes(p.number)) {
        phones.push(p.number);
      }
    }
  }
  return phones;
}

/**
 * Perform comprehensive cross-validation between contacts from different sources
 *
 * @param contacts Map of source name to ContactInfoJson
 * @param businessAddress Optional business address for proximity scoring
 * @returns Cross-validation summary with confidence boosts
 */
export function performCrossValidation(
  contacts: Map<string, ContactInfoJson>,
  businessAddress?: AddressData,
): CrossValidationSummary {
  const sources = Array.from(contacts.keys());
  const contactList = Array.from(contacts.values());

  const discrepancies: string[] = [];
  const corroboratingSources = new Set<string>();
  let totalConfidenceBoost = 0;

  // Email corroboration across all source pairs
  let emailResult: CorroborationResult = {
    matched: false,
    matchedValues: [],
    confidenceBoost: 0,
    sources: [],
  };

  // Phone corroboration across all source pairs
  let phoneResult: CorroborationResult = {
    matched: false,
    matchedValues: [],
    confidenceBoost: 0,
    sources: [],
  };

  // Name matching across sources
  let nameMatchResult = { matched: false, similarity: 0 };

  // Compare each pair of sources
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const source1 = sources[i];
      const source2 = sources[j];
      const contact1 = contactList[i];
      const contact2 = contactList[j];

      if (!source1 || !source2 || !contact1 || !contact2) continue;

      // Email corroboration
      const emails1 = extractEmails(contact1);
      const emails2 = extractEmails(contact2);
      if (emails1.length > 0 && emails2.length > 0) {
        const emailCorr = emailCorroboration(
          emails1,
          emails2,
          source1,
          source2,
        );
        if (emailCorr.matched) {
          emailResult = {
            ...emailCorr,
            matchedValues: [
              ...new Set([
                ...emailResult.matchedValues,
                ...emailCorr.matchedValues,
              ]),
            ],
            sources: [
              ...new Set([...emailResult.sources, ...emailCorr.sources]),
            ],
          };
          corroboratingSources.add(source1);
          corroboratingSources.add(source2);
        }
      }

      // Phone corroboration
      const phones1 = extractPhones(contact1);
      const phones2 = extractPhones(contact2);
      if (phones1.length > 0 && phones2.length > 0) {
        const phoneCorr = phoneCorroboration(
          phones1,
          phones2,
          source1,
          source2,
        );
        if (phoneCorr.matched) {
          phoneResult = {
            ...phoneCorr,
            matchedValues: [
              ...new Set([
                ...phoneResult.matchedValues,
                ...phoneCorr.matchedValues,
              ]),
            ],
            sources: [
              ...new Set([...phoneResult.sources, ...phoneCorr.sources]),
            ],
          };
          corroboratingSources.add(source1);
          corroboratingSources.add(source2);
        }
      }

      // Name matching
      const nameMatch = fuzzyNameMatch(contact1.name, contact2.name);
      if (
        nameMatch.matched &&
        nameMatch.similarity > nameMatchResult.similarity
      ) {
        nameMatchResult = nameMatch;
        corroboratingSources.add(source1);
        corroboratingSources.add(source2);
      } else if (!nameMatch.matched && contact1.name && contact2.name) {
        // Flag name discrepancy
        discrepancies.push(
          `Name mismatch: "${contact1.name}" (${source1}) vs "${contact2.name}" (${source2})`,
        );
      }
    }
  }

  // Calculate address proximity score for each contact against business address
  let maxAddressScore = 0;
  if (businessAddress) {
    for (const contact of contactList) {
      if (contact.address) {
        const score = addressProximityScore(contact.address, businessAddress);
        if (score > maxAddressScore) {
          maxAddressScore = score;
        }
      }
    }
  }

  // Calculate total confidence boost
  // +0.25: Contact found in both ZoomInfo AND Enformion
  if (corroboratingSources.size >= 2) {
    totalConfidenceBoost += 0.25;
  }

  // +0.15: Email matches across sources
  if (emailResult.matched) {
    totalConfidenceBoost += emailResult.confidenceBoost;
  }

  // +0.15: Phone matches across sources
  if (phoneResult.matched) {
    totalConfidenceBoost += phoneResult.confidenceBoost;
  }

  // +0.10: Name fuzzy-matches across sources
  if (nameMatchResult.matched) {
    totalConfidenceBoost += 0.1;
  }

  // +0.10: Address within 50km of business location
  if (maxAddressScore >= 80) {
    totalConfidenceBoost += 0.1;
  }

  // -0.20: Conflicting data between sources (flag for review)
  if (discrepancies.length > 0) {
    totalConfidenceBoost -= 0.2;
  }

  // Ensure boost doesn't go below -1 or above 1
  totalConfidenceBoost = Math.max(-1, Math.min(1, totalConfidenceBoost));

  return {
    isVerified: corroboratingSources.size >= 2,
    email: emailResult,
    phone: phoneResult,
    nameMatch: nameMatchResult,
    addressProximityScore: maxAddressScore,
    totalConfidenceBoost,
    discrepancies,
    corroboratingSources: Array.from(corroboratingSources),
  };
}

/**
 * Apply cross-validation results to a contact's provenance
 *
 * @param contact Contact to update
 * @param validation Cross-validation summary
 * @param addressDistanceKm Distance from business address in km (if calculated)
 * @returns Updated contact with cross-validation data in provenance
 */
export function applyCrossValidation(
  contact: ContactInfoJson,
  validation: CrossValidationSummary,
  addressDistanceKm?: number,
): ContactInfoJson {
  if (!contact.provenance) {
    return contact;
  }

  // Build updated provenance incrementally for exactOptionalPropertyTypes
  const updatedProvenance = {
    ...contact.provenance,
    cross_source_verified: validation.isVerified,
  };

  if (validation.corroboratingSources.length > 0) {
    updatedProvenance.corroborating_sources = validation.corroboratingSources;
  }

  if (addressDistanceKm !== undefined) {
    updatedProvenance.address_distance_km = addressDistanceKm;
  }

  return {
    ...contact,
    provenance: updatedProvenance,
  };
}
