/**
 * @togari/admin — Shared types for the enrichment layer.
 *
 * These types describe the input/output shape of the AI-driven enrichment
 * pipeline (Perplexity reasoner, primary-contact resolver, tier assigner)
 * and the cold-call script builder. They are deliberately decoupled from
 * the BigQuery row shape so this layer can be unit-tested without a
 * BigQuery client.
 */
export interface ThesisRevenueRange {
  min?: number;
  max?: number;
}

export interface ThesisHeadcountRange {
  min?: number;
  max?: number;
}

/**
 * Structured criteria attached to a thesis. Mirrors `theses.search_criteria`
 * (JSON) plus the typed columns (`industry_codes`, `geo_constraints`,
 * `revenue_range`, `headcount_range`) so the reasoner can pass a single
 * object end-to-end.
 */
export interface ThesisCriteria {
  industry_codes?: string[];
  geo_constraints?: string[];
  revenue_range?: ThesisRevenueRange;
  headcount_range?: ThesisHeadcountRange;
  /** Free-text qualitative signals (e.g. "founder-owned", "no PE backing"). */
  must_have_signals?: string[];
  /** Free-text disqualifiers (e.g. "publicly traded", "venture-backed"). */
  exclude_signals?: string[];
  /** Title keywords used by the primary-contact resolver. Defaults to CEO/Founder/Owner/President if omitted. */
  owner_target_titles?: string[];
}

/** Minimal company shape used as input to fit evaluation. */
export interface ThesisCandidateCompany {
  name: string;
  domain?: string;
  city?: string;
  state?: string;
  country?: string;
  /** Anything else Exa returned that's worth letting the reasoner see. */
  hint?: string;
}

/** Subset of the BigQuery `companies` row used by tier assignment. */
export interface EnrichedCompany {
  company_id: string;
  company_name: string;
  domain?: string;
  description?: string;
  industry?: string;
  naics_code?: string;
  city?: string;
  state?: string;
  country?: string;
  estimated_revenue?: number;
  estimated_headcount?: number;
  founded_year?: number;
  linkedin_url?: string;
}

/** Subset of the BigQuery `company_contacts` row used by the resolver. */
export interface CompanyContact {
  contact_id: string;
  company_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: "c_suite" | "vp" | "director" | "manager" | "ic" | string;
  email?: string;
  email_verified?: boolean;
  mobile_phone?: string;
  business_phone?: string;
  linkedin_url?: string;
  /**
   * Years at the current company. Used by the resolver's tenure bonus.
   * Source: Clay or LinkedIn. Optional — missing values skip the bonus.
   */
  tenure_years?: number;
  /**
   * ISO timestamp of the contact's last LinkedIn / social activity, if Clay
   * surfaced one. Used by the resolver's "active in last 90 days" bonus.
   */
  last_activity_at?: string;
}
