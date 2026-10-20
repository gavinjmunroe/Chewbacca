/**
 * Shared types for the enrichment agent and its scoring utilities.
 *
 * Ported from autotier/apps/worker/src/processors/enrichment/types.ts but
 * trimmed to the surface that's actually used by the modules we lift:
 * ContactInfoJson and its constituent parts, plus the provenance shape used
 * by quality + cross-source validation.
 *
 * Provider-specific request/response shapes (ZoomInfo, Enformion) are NOT
 * carried over here — Togari's enrichment plane uses Exa, CrustData,
 * Perplexity, and Grata, which Tab 5b will define separately.
 */

export type ContactMethodSource =
  | "ai"
  | "exa"
  | "crustdata"
  | "perplexity"
  | "grata"
  | "clay";

export interface PhoneWithMetadata {
  number: string;
  type?: "mobile" | "direct" | "office" | "landline" | "wireless";
  sources?: ContactMethodSource[];
  is_connected?: boolean;
  company?: string;
  first_reported_date?: string;
  last_reported_date?: string;
}

export interface EmailWithMetadata {
  address: string;
  type?: "work" | "personal" | "other";
  sources?: ContactMethodSource[];
}

export interface AddressData {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  coordinates?: { lat: number; lng: number };
  full_address?: string;
}

export interface ContactProvenance {
  source: ContactMethodSource;
  fetched_at?: string;
  confidence_score?: number | null;

  // Affiliation validation (set by affiliationScoring.ts)
  affiliation_score?: number;
  domain_verified?: boolean;
  email_domain_type?:
    | "company-match"
    | "company-mismatch"
    | "personal"
    | "unknown";

  // Cross-source validation (set by crossValidation.ts)
  address_distance_km?: number;
  cross_source_verified?: boolean;
  corroborating_sources?: string[];
  business_role?: string;

  /**
   * Pass-through bag for enrichment providers that ship address-match /
   * identity scores. Carried over from autotier's Enformion-flavored shape
   * so the ported scoring code compiles unchanged; Togari's v1 enrichment
   * plane (Exa, CrustData, Perplexity, Grata) does not populate this.
   * Reserved for the next enrichment provider that does (e.g., when we
   * absorb a Lusha / People Data Labs / SignalHire-style source).
   */
  enformion?: {
    address_match_score?: number;
    identity_score?: number;
    [key: string]: unknown;
  };
}

export interface ContactInfoJson {
  schema_version?: 2;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  source_urls?: string[];
  notes?: string | null;
  provenance?: ContactProvenance;

  all_phones?: PhoneWithMetadata[];
  all_emails?: EmailWithMetadata[];
  address?: AddressData;

  /** Computed quality score (0-100) for ranking/merging. Set by qualityScoring. */
  qualityScore?: number;
}

export interface EnrichmentResult {
  companyId: string;
  contacts: ContactInfoJson[];
}
