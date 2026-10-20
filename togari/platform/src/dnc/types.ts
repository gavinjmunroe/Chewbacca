/**
 * DNC (do-not-contact) domain types.
 *
 * These describe the inputs and outputs of the Togari DNC service:
 *   - a "check" answers "is this email/domain/contact suppressed?"
 *   - a "suppression" adds an email/domain to the do-not-contact list.
 *
 * The suppression list lives in the literal BigQuery dataset `togari_dnc`,
 * table `contacts`, scoped by `org_id` (canonical tenancy key = client_id/org).
 */

/** What the caller wants to check for suppression. Any subset may be provided. */
export interface DncCheckInput {
  /** Contact email. Matched case-insensitively against togari_dnc.contacts.email. */
  email?: string;
  /** Company domain (e.g. "acme.com"). Matched against company_domain. */
  domain?: string;
  /** togari_dnc.contacts.id — an exact row-id match. */
  contactId?: string;
}

/** A single reason a check came back suppressed. */
export interface DncMatch {
  /** Which field triggered the match. */
  matchedOn: "email" | "domain" | "contact_id";
  /** The value that matched (normalized where applicable). */
  value: string;
  /** dnc_reason stored on the row, if any. */
  reason?: string;
  /** ISO timestamp the suppression was added (from dnc_added_at). */
  addedAt?: string;
  /** togari_dnc.contacts.id of the matched row. */
  contactId?: string;
}

/** The decision returned by DncService.check(). */
export interface DncDecision {
  /** True when at least one match was found. */
  suppressed: boolean;
  /** All matches that contributed to the decision. */
  matches: DncMatch[];
  /** Convenience: the reason of the first match, if any. */
  reason?: string;
}

/** What the caller wants to suppress. `reason` is required for auditability. */
export interface DncSuppressionInput {
  /** Email to suppress. If given, the suppression is keyed on the lowercased email. */
  email?: string;
  /** Domain to suppress. Blocks all emails under this domain going forward. */
  domain?: string;
  /** Existing togari_dnc.contacts.id to flip to is_dnc = TRUE. */
  contactId?: string;
  /** Human-readable reason (e.g. "client request 2026-07-10"). Required. */
  reason: string;
  /** Optional actor who added the suppression (audit only). */
  addedBy?: string;
  /**
   * Optional expiry. There is no expiry column yet, so this is encoded into
   * dnc_reason as a " [expires:<iso>]" suffix rather than stored separately.
   */
  expiresAt?: string;
}
