/**
 * Agent registry + scope enforcement for the bio profile envelope.
 *
 * Slice 1: hardcoded map. Slice 2 will promote this to a Firestore
 * `agents` collection so users can grant per-agent scopes through a UI.
 *
 * Scope strings follow the pattern `<section>.<verb>`:
 *
 *   profile.read         — top-level user identity + display fields
 *   immutable.read       — birthday, birth time, birth location, alma mater, hometown
 *   personality.read     — MBTI / Enneagram / Big5 profiles
 *   preferences.read     — tone, schedule affinity, communication style
 *   relationships.read   — contact graph summary + Pinecone namespace
 *   permissions.read     — privacy tier + this agent's own granted scope
 *   memory.query         — read from Pinecone (used by /knowledge/query-as)
 *   memory.write         — write to Pinecone (used by /knowledge/ingest-as)
 *
 * Scopes are additive: an agent gets exactly what its entry lists.
 */

export const SCOPE_KEYS = Object.freeze([
  "profile.read",
  "immutable.read",
  "personality.read",
  "preferences.read",
  "relationships.read",
  "permissions.read",
  "memory.query",
  "memory.write",
]);

/**
 * Map of envelope section -> required scope. Used to strip sections from
 * the response when the calling agent lacks the scope.
 */
export const SECTION_SCOPE = Object.freeze({
  user: "profile.read",
  immutable: "immutable.read",
  personality: "personality.read",
  preferences: "preferences.read",
  relationships: "relationships.read",
  permissions: "permissions.read",
  memory: "memory.query",
});

const KNOWN_AGENTS = Object.freeze({
  medha: {
    id: "medha",
    displayName: "Medha",
    description:
      "Rytual Health agent — spiritual, emotional, physical dimensions.",
    defaultScope: Object.freeze([
      "profile.read",
      "immutable.read",
      "personality.read",
      "preferences.read",
      "relationships.read",
      "permissions.read",
      "memory.query",
      "memory.write",
    ]),
  },
  togari: {
    id: "togari",
    displayName: "Togari",
    description:
      "Blue Modern Advisory agent — intellectual, financial, social dimensions.",
    defaultScope: Object.freeze([
      "profile.read",
      "relationships.read",
      "permissions.read",
      "memory.query",
    ]),
  },
  "internal-cron": {
    id: "internal-cron",
    displayName: "Internal cron",
    description:
      "Scheduled background jobs (check-ins, reflection, training). No user-facing surface.",
    defaultScope: Object.freeze([
      "profile.read",
      "preferences.read",
      "memory.query",
      "memory.write",
    ]),
  },
});

/** Returns the agent record or null. */
export function getAgent(agentId) {
  if (typeof agentId !== "string" || agentId.length === 0) return null;
  return KNOWN_AGENTS[agentId] || null;
}

/** Returns true if the agent exists. */
export function isKnownAgent(agentId) {
  return getAgent(agentId) !== null;
}

/**
 * Resolve the effective scope for a call. Starts from the agent's
 * defaultScope, then intersects with `requestedScope` if provided (so
 * callers can narrow themselves further per call, e.g. a scheduled job
 * that only needs profile.read for one task). Returns a frozen array of
 * scope strings.
 *
 * Returns an empty array if the agent is unknown.
 */
export function effectiveScope(agentId, requestedScope) {
  const agent = getAgent(agentId);
  if (!agent) return Object.freeze([]);
  if (!Array.isArray(requestedScope) || requestedScope.length === 0) {
    return agent.defaultScope;
  }
  const allowed = new Set(agent.defaultScope);
  const result = [];
  for (const s of requestedScope) {
    if (typeof s === "string" && allowed.has(s)) result.push(s);
  }
  return Object.freeze(result);
}

/**
 * Filter a bio envelope object in place by removing sections whose
 * required scope is not in `scope`. Returns the names of sections that
 * were stripped — useful for the audit log entry.
 */
export function filterEnvelopeByScope(envelope, scope) {
  const scopeSet = new Set(scope);
  const stripped = [];
  for (const [section, requiredScope] of Object.entries(SECTION_SCOPE)) {
    if (!scopeSet.has(requiredScope)) {
      delete envelope[section];
      stripped.push(section);
    }
  }
  return stripped;
}

/**
 * Parse the X-Agent-Scope header value into an array of trimmed,
 * non-empty strings. Accepts comma- or space-separated values.
 */
export function parseScopeHeader(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
