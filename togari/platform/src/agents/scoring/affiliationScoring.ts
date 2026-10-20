/**
 * Affiliation scoring utilities for validating contact-company relationships.
 * Used to filter out contacts from wrong companies before persistence.
 */

/**
 * Classification of email domain type
 */
export type EmailDomainType =
  | "company-match"
  | "company-mismatch"
  | "personal"
  | "unknown";

/**
 * Result of affiliation calculation
 */
export interface AffiliationResult {
  /** Overall affiliation score (0-100) */
  score: number;
  /** Classification of email domain */
  emailDomainType: EmailDomainType;
  /** Company name similarity (0-1) */
  companyNameSimilarity: number;
  /** True if contact should be automatically rejected */
  autoReject: boolean;
  /** Human-readable warning or null if none */
  warning: string | null;
}

/**
 * Personal email domains that are allowed but flagged
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  // Major free email providers
  "gmail.com",
  "yahoo.com",
  "aol.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "live.com",
  "msn.com",
  "mail.com",
  "protonmail.com",
  "proton.me",
  "ymail.com",
  "rocketmail.com",
  // Major US ISP / telecom email domains
  "comcast.net",
  "att.net",
  "verizon.net",
  "bellsouth.net",
  "sbcglobal.net",
  "cox.net",
  "charter.net",
  // Regional US ISP domains commonly returned by Enformion
  "flash.net",
  "frontiernet.net",
  "frontier.com",
  "earthlink.net",
  "peoplepc.com",
  "windstream.net",
  "centurylink.net",
  "centurytel.net",
  "embarqmail.com",
  "netzero.net",
  "juno.com",
  "optonline.net",
  "optimum.net",
  "suddenlink.net",
  "twc.com",
  "roadrunner.com",
  "rr.com",
  "cfl.rr.com",
  "wi.rr.com",
  "ny.rr.com",
  "nc.rr.com",
  "tx.rr.com",
  "consolidated.net",
  "snet.net",
  "swbell.net",
  "pacbell.net",
  "ameritech.net",
  "nvbell.net",
  "cableone.net",
  "mediacombb.net",
  "wowway.com",
  "wccs.net",
  "mchsi.com",
  "q.com",
  "lisco.com",
  "epix.net",
  "windstream.com",
  "hotmail.co.uk",
  "live.co.uk",
  "yahoo.co.uk",
  "googlemail.com",
]);

/**
 * Extract domain from a URL or website string
 * @param urlOrWebsite URL or domain string (e.g., "https://example.com" or "example.com")
 * @returns Normalized domain without www prefix, or null if invalid
 */
export function extractDomainFromUrl(
  urlOrWebsite: string | null | undefined,
): string | null {
  if (!urlOrWebsite) return null;

  let domain = urlOrWebsite.trim().toLowerCase();

  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, "");

  // Remove path, query, and fragment
  domain = domain.split("/")[0] || "";
  domain = domain.split("?")[0] || "";
  domain = domain.split("#")[0] || "";

  // Remove www prefix
  domain = domain.replace(/^www\./, "");

  // Basic validation: must have at least one dot and no spaces
  if (!domain.includes(".") || domain.includes(" ")) {
    return null;
  }

  return domain || null;
}

/**
 * Extract domain from an email address
 * @param email Email address
 * @returns Domain portion of email, or null if invalid
 */
export function extractDomainFromEmail(
  email: string | null | undefined,
): string | null {
  if (!email) return null;

  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");

  if (atIndex === -1 || atIndex === trimmed.length - 1) {
    return null;
  }

  const domain = trimmed.substring(atIndex + 1);

  // Basic validation
  if (!domain.includes(".") || domain.includes(" ")) {
    return null;
  }

  return domain;
}

/**
 * Check if an email domain is a personal/free email provider
 */
export function isPersonalEmailDomain(domain: string | null): boolean {
  if (!domain) return false;
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Calculate Jaro-Winkler similarity between two strings
 * @returns Similarity score between 0 and 1
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3;

  // Winkler modification: boost for common prefix
  let prefixLength = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefixLength++;
    else break;
  }

  return jaro + prefixLength * 0.1 * (1 - jaro);
}

/**
 * Normalize company name for comparison
 * Removes common suffixes, punctuation, and normalizes whitespace
 */
export function normalizeCompanyName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Remove common business suffixes
  const suffixes = [
    /\s+(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|company|incorporated|corporation)\.?\s*$/i,
    /\s+(& associates|and associates|associates)\.?\s*$/i,
    /\s+(services|solutions|consulting|group)\.?\s*$/i,
  ];

  for (const suffix of suffixes) {
    normalized = normalized.replace(suffix, "");
  }

  // Remove punctuation and extra whitespace
  normalized = normalized
    .replace(/[.,'"!?&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

/**
 * Check if a company name or email domain indicates an obvious mismatch
 * Returns a mismatch reason or null if no obvious mismatch
 */
export function detectObviousMismatch(
  contactCompanyName: string | null | undefined,
  contactEmailDomain: string | null | undefined,
  targetCompanyName: string,
  targetWebsiteDomain: string | null | undefined,
): string | null {
  const contactCompanyLower = (contactCompanyName ?? "").toLowerCase();
  const contactDomainLower = (contactEmailDomain ?? "").toLowerCase();
  const targetLower = targetCompanyName.toLowerCase();

  // Check for different industry indicators in contact's company name
  const industryMismatches = [
    {
      pattern: /\bequipment\b/i,
      industry: "equipment",
      notFor: /\bequipment\b/i,
    },
    {
      pattern: /\barchitectural\b|\belements\b/i,
      industry: "architecture",
      notFor: /\barchitectural\b/i,
    },
    {
      pattern:
        /\bcapital\b|\bpartners\b|\bholdings\b|\bequity\b|\binvestment\b/i,
      industry: "finance",
      notFor: /\bcapital\b|\bpartners\b/i,
    },
    {
      pattern: /\blaw\s*(firm|office|group)?\b/i,
      industry: "legal",
      notFor: /\blaw\b/i,
    },
    {
      pattern: /\binsurance\b/i,
      industry: "insurance",
      notFor: /\binsurance\b/i,
    },
    {
      pattern: /\breal\s*estate\b/i,
      industry: "real estate",
      notFor: /\breal\s*estate\b/i,
    },
  ];

  for (const { pattern, industry, notFor } of industryMismatches) {
    // If contact's company matches the industry pattern but target doesn't
    if (pattern.test(contactCompanyLower) && !notFor.test(targetLower)) {
      return `Contact is from ${industry} industry, not "${targetCompanyName}"`;
    }
  }

  // Check for completely different base company names
  // Extract core name (first 2-3 significant words)
  const targetWords = normalizeCompanyName(targetCompanyName)
    .split(" ")
    .filter((w) => w.length > 2);
  const contactWords = normalizeCompanyName(contactCompanyLower)
    .split(" ")
    .filter((w) => w.length > 2);

  if (targetWords.length > 0 && contactWords.length > 0) {
    // Check if first significant word is completely different
    const targetCore = targetWords[0];
    const contactCore = contactWords[0];

    // If both have distinct core names and they're very different
    if (
      targetCore &&
      contactCore &&
      targetCore.length > 3 &&
      contactCore.length > 3
    ) {
      const similarity = jaroWinklerSimilarity(targetCore, contactCore);
      if (similarity < 0.5) {
        // Also check if email domain has nothing to do with target
        if (targetWebsiteDomain && contactDomainLower) {
          const domainSimilarity = jaroWinklerSimilarity(
            extractDomainFromUrl(targetWebsiteDomain) ?? "",
            contactDomainLower,
          );
          if (domainSimilarity < 0.4) {
            return `Contact's company "${contactCompanyName}" doesn't match "${targetCompanyName}"`;
          }
        }
      }
    }
  }

  // Check for email domain that belongs to obviously different company
  if (contactDomainLower && targetWebsiteDomain) {
    const targetDomain = extractDomainFromUrl(targetWebsiteDomain);

    // If domains are completely different and not personal email
    if (targetDomain && !isPersonalEmailDomain(contactDomainLower)) {
      // Extract base domain (remove TLD)
      const getBaseDomain = (d: string) => d.split(".").slice(0, -1).join(".");
      const targetBase = getBaseDomain(targetDomain);
      const contactBase = getBaseDomain(contactDomainLower);

      if (targetBase && contactBase) {
        const domainSim = jaroWinklerSimilarity(targetBase, contactBase);

        // Very low similarity and different industries indicated by domain
        if (domainSim < 0.4) {
          // Check for industry keywords in domain
          const differentIndustryDomains = [
            { pattern: /doctor|medical|health|care/i, industry: "healthcare" },
            { pattern: /equip|machine|tool/i, industry: "equipment" },
            { pattern: /architect|design|build/i, industry: "architecture" },
            { pattern: /law|legal|attorney/i, industry: "legal" },
          ];

          for (const { pattern, industry } of differentIndustryDomains) {
            if (
              pattern.test(contactDomainLower) &&
              !pattern.test(targetDomain)
            ) {
              return `Email domain "${contactDomainLower}" suggests ${industry}, not target company`;
            }
          }

          // Generic mismatch if domains are very different
          if (domainSim < 0.3) {
            return `Email domain "${contactDomainLower}" doesn't match company domain "${targetDomain}"`;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Calculate affiliation score between a contact and target company
 * @param contact Contact information with email and company name
 * @param targetCompany Target company with name and website
 * @returns Affiliation result with score, classification, and warnings
 */
export function calculateAffiliation(
  contact: {
    email?: string | null | undefined;
    companyName?: string | null | undefined;
  },
  targetCompany: { name: string; website: string | null | undefined },
): AffiliationResult {
  const contactEmailDomain = extractDomainFromEmail(contact.email);
  const targetWebsiteDomain = extractDomainFromUrl(targetCompany.website);

  // Check for obvious mismatch (auto-reject)
  const mismatchReason = detectObviousMismatch(
    contact.companyName,
    contactEmailDomain,
    targetCompany.name,
    targetCompany.website,
  );

  if (mismatchReason) {
    return {
      score: 0,
      emailDomainType: "company-mismatch",
      companyNameSimilarity: 0,
      autoReject: true,
      warning: mismatchReason,
    };
  }

  // Determine email domain type
  let emailDomainType: EmailDomainType = "unknown";
  let domainScore = 0;

  if (contactEmailDomain) {
    if (isPersonalEmailDomain(contactEmailDomain)) {
      emailDomainType = "personal";
      domainScore = 50; // Allow but don't fully trust
    } else if (targetWebsiteDomain) {
      const targetDomain = extractDomainFromUrl(targetWebsiteDomain);
      if (targetDomain && contactEmailDomain === targetDomain) {
        emailDomainType = "company-match";
        domainScore = 100;
      } else if (targetDomain) {
        // Partial match check (subdomain or similar)
        const targetBase = targetDomain.split(".").slice(-2).join(".");
        const contactBase = contactEmailDomain.split(".").slice(-2).join(".");
        if (targetBase === contactBase) {
          emailDomainType = "company-match";
          domainScore = 90;
        } else {
          // Calculate similarity
          const similarity = jaroWinklerSimilarity(
            targetDomain,
            contactEmailDomain,
          );
          if (similarity > 0.8) {
            emailDomainType = "company-match";
            domainScore = Math.round(similarity * 100);
          } else if (similarity > 0.5) {
            emailDomainType = "unknown";
            domainScore = Math.round(similarity * 60);
          } else {
            emailDomainType = "company-mismatch";
            domainScore = 20;
          }
        }
      }
    }
  }

  // Calculate company name similarity
  let companyNameSimilarity = 0;
  if (contact.companyName && targetCompany.name) {
    const normalizedContact = normalizeCompanyName(contact.companyName);
    const normalizedTarget = normalizeCompanyName(targetCompany.name);
    companyNameSimilarity = jaroWinklerSimilarity(
      normalizedContact,
      normalizedTarget,
    );
  } else if (!contact.companyName) {
    // If no company name from contact, give benefit of doubt
    companyNameSimilarity = 0.5;
  }

  // Calculate overall score
  // Weight: 60% domain match, 40% company name similarity
  const score = Math.round(
    domainScore * 0.6 + companyNameSimilarity * 100 * 0.4,
  );

  // Generate warning for edge cases
  let warning: string | null = null;
  if (emailDomainType === "personal") {
    warning = `Personal email domain (${contactEmailDomain}) - cannot verify company affiliation`;
  } else if (emailDomainType === "unknown" && score < 70) {
    warning = `Low affiliation confidence (${score}%) - verify this contact belongs to ${targetCompany.name}`;
  } else if (emailDomainType === "company-mismatch") {
    warning = `Email domain doesn't match company website - verify affiliation`;
  }

  return {
    score,
    emailDomainType,
    companyNameSimilarity,
    autoReject: false,
    warning,
  };
}
