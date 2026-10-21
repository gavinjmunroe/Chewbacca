/**
 * PURE privacy policy engine — the single decision layer for cross-user field
 * visibility. No DB, no network; fully unit-testable.
 *
 * SECURITY: DEFAULT-DENY. Any field not explicitly classified is treated as
 * 'private' and never exposed. Contact methods (phone/email) are NEVER released
 * by canView — surfacing them is the intro flow (F4c), deliberately separate.
 */

// Canonical field → class. Keys are the canonical (snake_case) names; both
// snake_case and camelCase aliases normalize onto these before lookup.
export const FIELD_CLASS = Object.freeze({
  // ── baseline: shown to connected viewers when the owner opts to share ──
  name: "baseline",
  full_name: "baseline",
  username: "baseline",
  occupation: "baseline",
  title: "baseline",
  company: "baseline",
  industry: "baseline",
  tags: "baseline",
  linkedin_url: "baseline",
  twitter_url: "baseline",
  github_url: "baseline",
  website: "baseline",
  city: "baseline",
  current_city: "baseline",
  hometown: "baseline",
  school: "baseline",
  avatar_url: "baseline",
  bio: "baseline",

  // ── contact_method: NEVER released by canView (intro flow = F4c) ──
  phone: "contact_method",
  phone_primary: "contact_method",
  phones_all: "contact_method",
  email: "contact_method",
  emails: "contact_method",

  // ── private: never exposed cross-user ──
  notes: "private",
  apple_notes: "private",
  enrichment: "private",
  enrichment_candidates: "private",
  metadata: "private",
  raw: "private",
  relationship_score: "private",
  message_frequency: "private",
  interaction_count: "private",
  last_contacted_at: "private",
  last_interaction_at: "private",
  birthday: "private",
  horoscope: "private",
  facts: "private",
});

// camelCase → canonical snake_case for the fields whose two spellings differ.
// (Single-word fields like name/phone/email/tags/company are identical in both.)
const _ALIAS = Object.freeze({
  fullname: "full_name",
  phoneprimary: "phone_primary",
  phonesall: "phones_all",
  phonenumbers: "phones_all",
  linkedinurl: "linkedin_url",
  twitterurl: "twitter_url",
  githuburl: "github_url",
  currentcity: "current_city",
  avatarurl: "avatar_url",
  applenotes: "apple_notes",
  enrichmentcandidates: "enrichment_candidates",
  relationshipscore: "relationship_score",
  messagefrequency: "message_frequency",
  interactioncount: "interaction_count",
  lastcontactedat: "last_contacted_at",
  lastinteractionat: "last_interaction_at",
});

// Normalize a field name (snake_case or camelCase) to its canonical key.
function normalizeField(field) {
  if (typeof field !== "string") return "";
  const raw = field.trim();
  if (!raw) return "";
  // Lowercase + strip separators to derive a comparison key, then map through
  // the alias table; fall back to a snake_case form for direct FIELD_CLASS hits.
  const compact = raw.toLowerCase().replace(/[_-]/g, "");
  if (_ALIAS[compact]) return _ALIAS[compact];
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/-/g, "_");
  return snake;
}

/**
 * Classify a field into 'baseline' | 'contact_method' | 'private'.
 * UNKNOWN / unclassified fields return 'private' (fail-closed).
 */
export function classifyField(field) {
  const key = normalizeField(field);
  return FIELD_CLASS[key] || "private";
}

/**
 * Decide whether `viewerId` may see `field` of `ownerId`'s record.
 *   - owner viewing self → always true.
 *   - else: 'baseline' → (connected && ownerShares); everything else → false.
 * Contact methods and private fields are never released here.
 */
/**
 * MAY THIS VIEWER SEE THIS FIELD?
 *
 * `audience` is what src/privacy/audience.js resolved -- the one shared answer
 * to "what is this viewer to this owner". `connected` and `ownerShares` are
 * still accepted for callers that have not been moved over; passing the
 * audience is the path that agrees with the notes and feeds side.
 *
 * WHAT AN AUDIENCE DOES AND DOES NOT UNLOCK. Being in one of the owner's
 * circles or cohorts means they put you in an audience, so baseline fields
 * open. It does NOT open contact_method or private: a phone number is released
 * by the intro flow and by nothing else, and that is deliberately not something
 * an audience can grant, because the whole point of a cohort is that it is
 * derived -- nobody reviewed the list one by one, and a derived audience must
 * never be able to hand out phone numbers.
 */
export function canView({ viewerId, ownerId, field, connected, ownerShares, audience } = {}) {
  if (viewerId != null && ownerId != null && viewerId === ownerId) return true;
  if (audience?.self) return true;
  const cls = classifyField(field);
  if (cls !== "baseline") return false; // contact_method, private, unclassified

  if (audience) {
    if (audience.connected && audience.ownerSharesBaseline) return true;
    return (
      (audience.circleIds?.length ?? 0) > 0 ||
      (audience.cohortIds?.length ?? 0) > 0
    );
  }
  return Boolean(connected && ownerShares);
}

/**
 * Return a NEW object with only the keys `canView` permits for the viewer.
 * Never mutates `record`.
 */
export function filterForViewer(record, { viewerId, ownerId, connected, ownerShares, audience } = {}) {
  if (!record || typeof record !== "object") return {};
  const out = {};
  for (const key of Object.keys(record)) {
    if (canView({ viewerId, ownerId, field: key, connected, ownerShares, audience })) {
      out[key] = record[key];
    }
  }
  return out;
}
