/**
 * THE ORG SHARING VOCABULARY, IN ONE PLACE.
 *
 * Two lists and one comparison. They are here rather than in a store because
 * three different layers need the same answer -- the policy editor validating
 * what an admin typed, the share path refusing a scope above the ceiling, and
 * (next migration) the read predicate -- and the cohort work already proved
 * what happens when a scope vocabulary exists in two files: one of them accepts
 * a value the other cannot resolve, and the share silently reaches nobody.
 *
 * THE LADDER IS TOTAL AND ITS ORDER IS A PRODUCT DECISION, not an alphabet:
 *
 *   self            nobody but the author
 *   group           one named group inside the company
 *   org             everybody in the company
 *   customer        one named customer, outside the company, by link
 *   customer_group  a named set of customers, by link
 *
 * `customer` sits ABOVE `org` even though it usually reaches fewer people. The
 * ceiling is about blast radius, not headcount: a thing that leaves the
 * building has left, and the admin who caps something at `org` means "this does
 * not go to customers" -- which is exactly what an ordering by headcount would
 * get backwards.
 */

/** The scopes a share may be addressed to, widest-last. Index IS the rank. */
export const ORG_SHARE_SCOPES = Object.freeze([
  "self",
  "group",
  "org",
  "customer",
  "customer_group",
]);

/** What kind of thing is being shared. The axis the ceiling is set along. */
export const CLASSIFICATIONS = Object.freeze([
  "public",
  "internal",
  "customer_safe",
  "private",
]);

/**
 * What a brand-new organization starts with.
 *
 * DELIBERATELY TIGHT. A new company's ceiling should be the one that cannot
 * embarrass them on day one, because the admin who has not opened the policy
 * editor yet has not agreed to anything. `private` capped at `self` is the
 * point of the word; `internal` stops at the company edge; only `public` and
 * things an admin has explicitly marked customer-safe may leave it.
 */
export const DEFAULT_POLICY = Object.freeze({
  public: "customer_group",
  internal: "org",
  customer_safe: "customer_group",
  private: "self",
});

export function isScope(value) {
  return ORG_SHARE_SCOPES.includes(value);
}

export function isClassification(value) {
  return CLASSIFICATIONS.includes(value);
}

/**
 * May something classified `classification` be shared at `scope`, given this
 * org's policy?
 *
 * FAILS CLOSED, THREE WAYS. An unknown scope, an unknown classification, or a
 * classification the policy has no row for all return false. The alternative --
 * treating a missing policy row as "no ceiling" -- means a classification added
 * next quarter is unrestricted everywhere until somebody remembers to seed it.
 *
 * @param {object} policy  { [classification]: maxScope }
 */
export function scopePermitted(policy, classification, scope) {
  if (!isClassification(classification) || !isScope(scope)) return false;
  const cap = policy?.[classification];
  if (!isScope(cap)) return false;
  return ORG_SHARE_SCOPES.indexOf(scope) <= ORG_SHARE_SCOPES.indexOf(cap);
}

/** The scopes a member may actually pick for this classification. Drives the UI. */
export function permittedScopes(policy, classification) {
  return ORG_SHARE_SCOPES.filter((s) => scopePermitted(policy, classification, s));
}

/**
 * HOW FAR EVERY AUDIENCE REACHES, including the four the consumer product
 * already had.
 *
 * ORG_SHARE_SCOPES above is the ladder an ADMIN sets a cap along -- five values,
 * the vocabulary of the policy editor. This is the wider table the ENFORCEMENT
 * needs, because an org member can also address a contact, a circle, a cohort
 * or their whole network, and a ceiling that only governed the five would be a
 * ceiling with four doors cut in it: "private, only me" would still permit
 * sending the thing to one contact.
 *
 * THIS TABLE IS DUPLICATED IN SQL, as org_scope_rank() in migration 063, because
 * the read predicate has to make the same comparison and cannot call into
 * JavaScript. Two copies of a rule drift -- so org-scopes.test.js parses the
 * migration and asserts the two agree, value by value. That test is the only
 * reason it is safe to have written this twice.
 */
export const AUDIENCE_RANK = Object.freeze({
  self: 0,
  group: 1,
  org: 2,
  contact: 3,
  customer: 3,
  circle: 4,
  cohort: 4,
  customer_group: 4,
  network: 4,
});

/** Unknown audiences rank beyond every cap, so they are permitted by none. */
export function audienceRank(scopeType) {
  const r = AUDIENCE_RANK[scopeType];
  return Number.isInteger(r) ? r : 99;
}

/**
 * May something classified `classification` be shared to `scopeType` -- any
 * scope type, not just the five on the admin's ladder -- under this policy?
 *
 * Fails closed on an unknown classification, an unknown cap, a missing policy
 * row and an unknown scope type, for the reason the predicate gives: a share
 * that reaches nobody is reported within the hour, and a share that reaches
 * everybody is not reported at all.
 */
export function audiencePermitted(policy, classification, scopeType) {
  if (!isClassification(classification)) return false;
  const cap = policy?.[classification];
  if (!isScope(cap)) return false;
  return audienceRank(scopeType) <= audienceRank(cap);
}
