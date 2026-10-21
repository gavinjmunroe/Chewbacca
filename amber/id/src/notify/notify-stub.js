/**
 * FUNCTION 3, NOTIFY (spec §3): the DECISION predicate (item 175).
 *
 * Three distinct functions in PeopleRank:
 *   SEARCH   ranks the caller's own contacts for a query (request path, fast).
 *   ENRICH   does the deeper, lazy per-person web pull + Agent brief + re-embed
 *            (src/enrichment/enrich-person.js).
 *   NOTIFY   is a CONSUMER of ENRICH OUTPUTS. When an enrichment surfaces
 *            something noteworthy about a contact, a job change, a funding
 *            round, a launch, a big public moment, NOTIFY decides whether to
 *            proactively tell the user, and at what salience.
 *
 * What is implemented here:
 *   - A PURE, testable DECISION predicate (`evaluateEnrichmentForNotify`) that
 *     reads an ENRICH result's `whats_new` / `signals` and the prior known
 *     state of the contact, and produces a typed NotifyIntent. The decision is
 *     driven by the enrichment, NOT by the SEARCH ranking weight, so NOTIFY
 *     stays decoupled from ranking changes.
 *
 * What is deliberately STILL out of scope (owned elsewhere, per CLAUDE.md
 * transport rules):
 *   - DELIVERY. amber-id only RESOLVES identity and produces the intent; it
 *     never sends. NOTIFY EMITS a typed intent and hands off; it does not call
 *     Photon / push / Retell.
 *   - CADENCE / persistence. Rate-limiting and dedupe across sends live in a
 *     DID-scoped Firestore store owned by the transport seam. The `prior`
 *     argument is the seam for that diff, but this module keeps no state.
 */

/**
 * @typedef {Object} NotifyIntent
 * @property {string|null} contactId  The DID-scoped contact this concerns.
 * @property {boolean} shouldNotify   Whether NOTIFY would surface this.
 * @property {string}  reason         Machine reason code (e.g. "job_change").
 * @property {"low"|"medium"|"high"} salience  Suggested prominence.
 * @property {string|null} headline   One-line nudge text, or null when none.
 * @property {string}  source         "peoplerank_notify" (origin function).
 */

/** Stable identifier for the NOTIFY function, distinct from SEARCH/ENRICH. */
export const NOTIFY_FUNCTION = "peoplerank_notify";

// Noteworthy-event lexicon. Each entry maps a reason code to the phrases whose
// presence in a "what's new" brief signals that kind of event. Order matters:
// the first matching category wins, most-salient first.
const EVENT_PATTERNS = [
  {
    reason: "funding",
    salience: "high",
    re: /\b(raised|raises|funding round|series [a-e]\b|seed round|led the round|valuation|closed a round)\b/i,
  },
  {
    reason: "job_change",
    salience: "high",
    re: /\b(joined|joins|named|appointed|new role|stepping down|departs|left .* to|now (the )?(ceo|cto|cfo|coo|vp|head of|president|founder|partner))\b/i,
  },
  {
    reason: "launch",
    salience: "medium",
    re: /\b(launched|launches|unveiled|released|shipped|went live|announced .* (product|app|feature|company))\b/i,
  },
  {
    reason: "acquisition",
    salience: "high",
    re: /\b(acquired|acquires|acquisition|bought by|merger|merged with)\b/i,
  },
  {
    reason: "recognition",
    salience: "medium",
    re: /\b(award|awarded|honored|named to|forbes 30|30 under 30|keynote|spoke at|featured in)\b/i,
  },
];

// A fresh, credible source plus a momentum spike is itself noteworthy even when
// the brief text is thin, these thresholds gate the "momentum_spike" fallback.
const MOMENTUM_SPIKE_MIN = 3; // distinct fresh domains
const RECENCY_FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function classifyEvent(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  for (const p of EVENT_PATTERNS) {
    if (p.re.test(text)) return p;
  }
  return null;
}

/** Build a clean one-line headline from a contact name + the brief's lead sentence. */
function buildHeadline(name, whatsNew) {
  const who = (name || "A contact").trim();
  const lead = String(whatsNew || "")
    .split(/(?<=[.!?])\s/)[0]
    .trim()
    .replace(/\s+/g, " ");
  if (!lead) return `${who} has a noteworthy update.`;
  // Avoid duplicating the name if the brief already leads with it.
  return lead.toLowerCase().startsWith(who.toLowerCase())
    ? lead
    : `${who}: ${lead}`;
}

/** A fully-shaped declined intent. */
function decline(contactId, reason = "not_noteworthy") {
  return Object.freeze({
    contactId: contactId ?? null,
    shouldNotify: false,
    reason,
    salience: "low",
    headline: null,
    source: NOTIFY_FUNCTION,
  });
}

/**
 * Decide whether an ENRICH result is worth proactively surfacing (item 175).
 * Pure + never throws. Returns a fully-shaped, frozen NotifyIntent.
 *
 *   evaluateEnrichmentForNotify(enrichResult, { prior?, nowMs? }) -> NotifyIntent
 *
 * `prior` is the last-known enrichment for this contact (or null on first
 * sight). When the prior brief is identical to the current one, NOTIFY declines
 * ("unchanged") so the same news can't fire twice, the real cadence/dedupe
 * store lives in the transport seam, this is just the content-level guard.
 *
 * @param {object} enrichResult  The object returned by enrichPerson().
 * @param {{prior?: object|null, nowMs?: number}} [opts]
 * @returns {NotifyIntent}
 */
export function evaluateEnrichmentForNotify(enrichResult, opts = {}) {
  const { prior = null, nowMs = Date.now() } = opts;
  const contactId = enrichResult?.contactId ?? null;

  if (!enrichResult || enrichResult.status !== "ok") {
    return decline(contactId, "no_enrichment");
  }

  const whatsNew = enrichResult.whats_new;
  const signals = enrichResult.signals || {};

  // Content-level dedupe: same brief as last time -> nothing new to say.
  if (
    prior &&
    typeof prior.whats_new === "string" &&
    prior.whats_new === whatsNew
  ) {
    return decline(contactId, "unchanged");
  }

  // 1. Event detected in the narrative brief, the strongest signal.
  const event = classifyEvent(whatsNew);
  if (event) {
    return Object.freeze({
      contactId,
      shouldNotify: true,
      reason: event.reason,
      salience: event.salience,
      headline: buildHeadline(enrichResult.name, whatsNew),
      source: NOTIFY_FUNCTION,
    });
  }

  // 2. No explicit event phrase, but a momentum spike on fresh, credible sources.
  const momentum = Number(signals.momentum) || 0;
  const recency = typeof signals.recency === "number" ? signals.recency : null;
  const isFresh = recency != null && nowMs - recency <= RECENCY_FRESH_MS;
  if (momentum >= MOMENTUM_SPIKE_MIN && isFresh) {
    return Object.freeze({
      contactId,
      shouldNotify: true,
      reason: "momentum_spike",
      salience: "low",
      headline: buildHeadline(
        enrichResult.name,
        whatsNew ||
          `${enrichResult.name || "This contact"} is in the news right now.`,
      ),
      source: NOTIFY_FUNCTION,
    });
  }

  return decline(contactId, "not_noteworthy");
}
