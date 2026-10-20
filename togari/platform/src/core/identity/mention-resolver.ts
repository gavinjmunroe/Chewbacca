/**
 * @togari/core/identity — resolve reminder owners from @mentions or plain-text names.
 *
 * Deterministic first: Slack `<@U...>` tokens are extracted by regex and
 * resolved against the directory via slack_user_id. Plain-text names go
 * through a fuzzy matcher with adversarial-safe rules (see `scoreName`
 * below).
 *
 * Every resolve call emits a structured audit entry via `logAudit` so
 * fuzzy decisions are reviewable after the fact. Runtime-controlled via
 * env var FEATURE_REMINDER_OWNER_ROUTING (default `true`); when false,
 * callers should skip this module and fall back to sender-as-owner.
 */

import { randomUUID } from 'crypto';
import { logAudit, type AuditEntry } from '../../middleware/audit';
import { listUsers, type UserRow, DEFAULT_TENANT_ID } from './user-directory';

// ── Feature flag ────────────────────────────────────────────────

export function isOwnerRoutingEnabled(): boolean {
  const raw = process.env.FEATURE_REMINDER_OWNER_ROUTING;
  if (raw === undefined || raw === null || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

// ── Canonical BMA team → Slack ID overrides ─────────────────────
//
// The canonical override map is now built dynamically from
// togari_data_lake.users via `listUsers(tenantId)` and cached for 5
// minutes (matches `slack-profile.ts` timezone cache TTL). The map
// keys are lowercased first_name, "first last", and slack_display_name
// — every alias the previous hardcoded block carried.
//
// The hardcoded NAME_TO_SLACK_ID stays as a FALLBACK ONLY for callers
// or test paths that need a synchronous override (the BQ-backed
// resolver layer below is async). Production code paths go through
// `getCanonicalOverrideMap` first; the fallback only fires if the BQ
// load failed or hasn't seeded a recently-added team member.
//
// Mirrors the TEAM MEMBER MAPPING block in src/core/intent-router.ts —
// keep both in sync when team membership changes.
export const NAME_TO_SLACK_ID: Record<string, string> = {
  karthik: 'U08L8PFMWBE',
  'karthik dev': 'U08L8PFMWBE',
  'karthik devarakonda': 'U08L8PFMWBE',
  sagar: 'U087Z8LPMMY',
  'sagar tiwari': 'U087Z8LPMMY',
  maggie: 'U093A6B2WBZ',
  'maggie chen': 'U093A6B2WBZ',
  drew: 'U0AFWNY49SM',
  shirley: 'U0AK2VCNPCZ',
  'shirley park': 'U0AK2VCNPCZ',
  caleb: 'U0AEBS2UXRB',
  'caleb newton': 'U0AEBS2UXRB',
  tyler: 'U0AQMFPGKQS',
  reem: 'U0AEU6W05C1',
  rania: 'U0AEJSYUTAQ',
  kevin: 'U088N3LT0SU',
  'kevin cong': 'U088N3LT0SU',
};

// ── BQ-backed canonical-override cache ──────────────────────────

interface CanonicalCacheEntry {
  loadedAt: number;
  map: Record<string, string>; // lowercased alias → slack_user_id
}

const CANONICAL_CACHE_TTL_MS = 5 * 60 * 1000;
const canonicalCache = new Map<string, CanonicalCacheEntry>(); // tenantId → entry

/**
 * Build a lowercased alias → slack_user_id map from the live BQ
 * directory. Keys include first_name, last_name, "first last", and
 * slack_display_name (each lowercased). Skips users with no
 * slack_user_id.
 */
function buildCanonicalMapFromUsers(users: UserRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of users) {
    if (!u.slack_user_id) continue;
    const sid = u.slack_user_id;
    const fn = u.first_name?.trim().toLowerCase();
    const ln = u.last_name?.trim().toLowerCase();
    const dn = u.slack_display_name?.trim().toLowerCase();
    if (fn) map[fn] = sid;
    if (ln) map[ln] = sid;
    if (fn && ln) map[`${fn} ${ln}`] = sid;
    if (dn) map[dn] = sid;
  }
  return map;
}

/**
 * Returns the canonical override map for a tenant. Cached for 5 minutes
 * to amortize listUsers calls. Falls back to the hardcoded
 * NAME_TO_SLACK_ID if the BQ read fails — production must keep
 * resolving names even when the warehouse is unreachable.
 */
async function getCanonicalOverrideMap(tenantId: string): Promise<Record<string, string>> {
  const cached = canonicalCache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CANONICAL_CACHE_TTL_MS) {
    return cached.map;
  }
  try {
    const users = await listUsers(tenantId);
    const map = buildCanonicalMapFromUsers(users);
    canonicalCache.set(tenantId, { loadedAt: Date.now(), map });
    return map;
  } catch {
    // Degrade gracefully: hardcoded fallback. Logged by the caller
    // (resolveReminderOwner) via the audit entry it emits.
    return NAME_TO_SLACK_ID;
  }
}

/** Test-only: clear the BQ-backed canonical map cache. */
export function _clearCanonicalOverrideCache(): void {
  canonicalCache.clear();
}

/**
 * Slack user ids that the engine should refuse to assign NEW actions to
 * (Kevin departed BMA but is still referenced historically). Resolver
 * still maps "kevin" → U088N3LT0SU so audit-log references work, but
 * any callsite using the resolution for a new reminder / new deal owner
 * / new ownership transfer should consult this set and warn the user.
 *
 * TODO(togari/identity): Migrate this set to togari_data_lake.users by
 * adding an `is_active` (BOOLEAN) or `status` (STRING) column. The
 * UserRow type today has no such field — see
 * src/core/identity/user-directory.ts. Until that column ships, the
 * hardcoded set is the source of truth for "who has left BMA".
 */
export const INACTIVE_OPERATORS: Set<string> = new Set(['U088N3LT0SU']);

export function isInactiveOperator(slackId: string | null | undefined): boolean {
  return !!slackId && INACTIVE_OPERATORS.has(slackId);
}

// ── Vocabulary that must never resolve to a specific user ───────

const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself']);
const GROUP_WORDS = new Set([
  'we', 'our', 'us', 'ourselves',
  'team', 'everyone', 'everybody', 'all', 'the team', 'the group',
  'y\'all', 'yall',
]);

const BANNED_TOKENS = new Set<string>([
  ...FIRST_PERSON,
  ...GROUP_WORDS,
]);

export function isFirstPersonToken(token: string): boolean {
  return FIRST_PERSON.has(token.trim().toLowerCase());
}

export function isGroupToken(token: string): boolean {
  return GROUP_WORDS.has(token.trim().toLowerCase());
}

// ── Unicode-safe distance / equality ────────────────────────────

/**
 * Normalise a name for comparison: lower-case, trim, NFC-normalise.
 * We intentionally do NOT strip diacritics or fold confusables — "Kevın"
 * (Turkish dotless i) and "Кevin" (Cyrillic Ке) must retain their
 * distinguishing codepoints so the Levenshtein distance correctly
 * reports them as different.
 */
function normalise(s: string): string {
  return s.normalize('NFC').trim().toLowerCase();
}

/** Codepoint-aware Levenshtein. Operates on arrays of codepoints so that
 *  `'Kevın'.length !== 5` bugs don't skew the distance. */
function levenshtein(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  const m = aa.length;
  const n = bb.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    prev = curr.slice();
  }
  return prev[n];
}

// ── Mention extraction ──────────────────────────────────────────

/**
 * Extract Slack `<@U...>` mention tokens from the raw Slack text. Strips
 * the `<@` / `>` wrappers; returns only the user IDs.
 *
 * IMPORTANT: only the Slack-webhook-resolved `<@...>` form counts. A bare
 * `U088N3LT0SU` substring in the plain text MUST NOT be treated as a
 * mention — see TEST 32. Users can type literal IDs; only the webhook
 * emits the angle-bracket form.
 */
export function extractSlackMentions(rawText: string): string[] {
  if (!rawText) return [];
  const matches: string[] = [];
  const re = /<@([A-Z0-9]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

// ── Fuzzy name scoring ──────────────────────────────────────────

export type MatchConfidence = 'high' | 'low' | 'none';

export interface NameCandidate {
  user: UserRow;
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Score a single candidate user against an input token. Adversarial rules:
 *
 *   - Exact first_name / last_name / slack_display_name       → high
 *   - Prefix match on first_name                              → high ONLY if
 *         prefix is ≥4 chars AND the prefix is unique across all users
 *         (uniqueness is enforced later in `scoreAll`).
 *   - Levenshtein distance ≤2 on first_name (post-normalise)  → low
 *   - Last-name substring match                               → low (caller
 *         must also ensure the last name is unique across users)
 *   - Anything else                                           → none
 *
 * Group/first-person tokens and user-id-looking tokens must be filtered
 * by the caller before reaching this function.
 */
function scoreSingle(token: string, user: UserRow): NameCandidate {
  const needle = normalise(token);
  const fn = user.first_name ? normalise(user.first_name) : '';
  const ln = user.last_name ? normalise(user.last_name) : '';
  const dn = user.slack_display_name ? normalise(user.slack_display_name) : '';

  if (!needle) return { user, confidence: 'none', reason: 'empty token' };

  if (fn && fn === needle) return { user, confidence: 'high', reason: 'first_name exact' };
  if (ln && ln === needle) return { user, confidence: 'high', reason: 'last_name exact' };
  if (dn && dn === needle) return { user, confidence: 'high', reason: 'slack_display_name exact' };

  if (fn && needle.length >= 4 && fn.startsWith(needle)) {
    return { user, confidence: 'high', reason: 'first_name prefix ≥4' };
  }

  if (fn) {
    const d = levenshtein(fn, needle);
    if (d > 0 && d <= 2) {
      return { user, confidence: 'low', reason: `first_name levenshtein=${d}` };
    }
  }

  if (ln && needle.length >= 4 && ln.includes(needle)) {
    return { user, confidence: 'low', reason: 'last_name substring' };
  }

  return { user, confidence: 'none', reason: 'no match' };
}

export interface NameResolution {
  status: 'resolved' | 'ambiguous' | 'none';
  userId?: string;
  user?: UserRow;
  candidates: NameCandidate[];
  reason: string;
}

/**
 * Resolve a plain-text name against the whole directory.
 *
 *   - If the token is first-person ("me", "my", ...) → returns 'none' with
 *     reason 'first_person', caller should fall back to sender.
 *   - Group/everyone words → 'none' with reason 'group', caller should fall
 *     back to sender and attach a TODO note (team fanout lands in a later
 *     phase; see brief).
 *   - Tokens that look like Slack user IDs (match /^U[A-Z0-9]{8,}$/) are
 *     rejected — TEST 32 guards against literal U… typed in plain text
 *     being treated as a mention.
 *   - Exactly one candidate with 'high' confidence and every other
 *     candidate 'none' → resolved.
 *   - 2+ candidates at 'high' confidence, or any 'low' confidence match
 *     (regardless of count) → ambiguous (caller asks for clarification).
 *   - Otherwise → 'none'.
 */
export function resolveName(
  token: string,
  users: UserRow[],
): NameResolution {
  const needle = token.trim();
  if (!needle) {
    return { status: 'none', candidates: [], reason: 'empty token' };
  }
  if (isFirstPersonToken(needle)) {
    return { status: 'none', candidates: [], reason: 'first_person' };
  }
  if (isGroupToken(needle)) {
    return { status: 'none', candidates: [], reason: 'group' };
  }
  if (/^U[A-Z0-9]{8,}$/.test(needle)) {
    // Looks like a Slack user ID typed as plain text — not a valid mention
    // (see TEST 32 in tests/smoke/slack.test.ts).
    return { status: 'none', candidates: [], reason: 'looks_like_user_id_not_mention' };
  }

  const scored = users.map((u) => scoreSingle(needle, u)).filter((c) => c.confidence !== 'none');

  // Disambiguation rule: a prefix-only match is only trustworthy if unique.
  // If two users share the same first_name prefix, demote both to 'low'.
  const highPrefix = scored.filter((c) => c.reason.startsWith('first_name prefix'));
  if (highPrefix.length > 1) {
    for (const c of highPrefix) c.confidence = 'low';
  }

  const highs = scored.filter((c) => c.confidence === 'high');
  const lows = scored.filter((c) => c.confidence === 'low');

  if (highs.length === 1 && lows.length === 0) {
    return { status: 'resolved', userId: highs[0].user.user_id, user: highs[0].user, candidates: scored, reason: highs[0].reason };
  }

  if (highs.length >= 2 || lows.length >= 1) {
    return { status: 'ambiguous', candidates: scored, reason: `${highs.length} high + ${lows.length} low candidates` };
  }

  return { status: 'none', candidates: scored, reason: 'no candidates' };
}

// ── Audit logging ───────────────────────────────────────────────

function logFuzzyDecision(params: {
  inputText: string;
  tenantId: string;
  resolution: NameResolution;
  senderUserId: string;
}): void {
  const entry: AuditEntry = {
    audit_id: randomUUID(),
    audit: 'true',
    client_id: params.tenantId,
    user_id: params.senderUserId,
    tool_name: 'fuzzy_name_resolver',
    action: 'resolve_reminder_owner',
    duration_ms: 0,
    status: params.resolution.status === 'resolved' ? 'success' : 'success', // audit outcome, not error
    timestamp: new Date().toISOString(),
    metadata: {
      input_text: params.inputText,
      status: params.resolution.status,
      matched_user_id: params.resolution.userId ?? null,
      reason: params.resolution.reason,
      alternative_candidates: params.resolution.candidates.map((c) => ({
        user_id: c.user.user_id,
        confidence: c.confidence,
        reason: c.reason,
      })),
    },
  };
  logAudit(entry);
}

// ── Top-level: resolve owners for a set of reminder clauses ─────

export interface ReminderOwnerInput {
  /** The literal token / name candidate extracted from the LLM's output or the raw text. */
  token: string;
  /** Original text surrounding the reminder (for audit). */
  originalClause: string;
  /** Any Slack `<@U...>` IDs already extracted from the raw webhook text. */
  slackMentionIds?: string[];
}

export interface ReminderOwnerResolution {
  /**
   * - `resolved` — token mapped to a known Slack id (canonical override,
   *   fuzzy match in togari.users, or a Slack `<@U...>` mention).
   * - `ambiguous` — fuzzy resolver found multiple candidates; caller asks
   *   the user to disambiguate.
   * - `fallback_to_sender` — first-person ("me", "myself") or group word
   *   ("we", "team"); silently routing to the sender is correct here.
   * - `unresolved_name` — token LOOKED like a third-party name but the
   *   resolver couldn't map it (not in canonical override, not in BQ
   *   directory, no fuzzy candidate). Callers MUST NOT silently fall
   *   back to the sender — that's the wrong-person-got-reminded bug.
   *   Return an error and ask the user to clarify instead.
   */
  status: 'resolved' | 'ambiguous' | 'fallback_to_sender' | 'unresolved_name';
  ownerUserId: string | null;
  ownerSlackUserId: string | null;
  ambiguousCandidates?: Array<{
    user_id: string;
    display: string;
    slack_user_id: string | null;
  }>;
  /** The original token the LLM produced — useful for error messages. */
  inputToken?: string;
  reason: string;
}

/**
 * Given a token (possibly a Slack mention ID, a plain name, "me", etc.)
 * and the directory, decide who owns this reminder. Logs the decision.
 *
 * `senderSlackUserId` is the fallback when the token points at the sender
 * or is a group word.
 */
export async function resolveReminderOwner(params: {
  token: string | undefined | null;
  senderSlackUserId: string;
  rawText?: string;
  tenantId?: string;
  users?: UserRow[];                          // Pre-loaded directory (tests may inject)
}): Promise<ReminderOwnerResolution> {
  const tenantId = params.tenantId ?? DEFAULT_TENANT_ID;
  const users = params.users ?? (await listUsers(tenantId));

  // 1) Empty / undefined token → sender
  const tokenRaw = (params.token ?? '').trim();
  if (!tokenRaw) {
    return {
      status: 'fallback_to_sender',
      ownerUserId: null,
      ownerSlackUserId: params.senderSlackUserId,
      reason: 'empty token — defaulting to sender',
    };
  }

  // 2) Slack `<@U...>` mention → resolve via slack_user_id
  const mentionMatch = tokenRaw.match(/^<@([A-Z0-9]+)>$/);
  if (mentionMatch) {
    const slackId = mentionMatch[1];
    const user = users.find((u) => u.slack_user_id === slackId);
    const resolution: NameResolution = user
      ? { status: 'resolved', userId: user.user_id, user, candidates: [{ user, confidence: 'high', reason: 'slack_mention' }], reason: 'slack_mention' }
      : { status: 'none', candidates: [], reason: 'slack_mention_unknown' };
    logFuzzyDecision({ inputText: tokenRaw, tenantId, resolution, senderUserId: params.senderSlackUserId });

    if (user) {
      return {
        status: 'resolved',
        ownerUserId: user.user_id,
        ownerSlackUserId: user.slack_user_id,
        reason: 'slack_mention_matched',
      };
    }
    // Unknown Slack user id — trust the Slack token anyway; the delivery
    // path can still DM that user via `chat.scheduleMessage` even if they
    // are missing from togari.users. Record it and move on.
    return {
      status: 'resolved',
      ownerUserId: null,
      ownerSlackUserId: slackId,
      reason: 'slack_mention_not_in_directory',
    };
  }

  // 3) Bare Slack user ID pattern. Two sub-cases:
  //   a) Token appears as `<@U...>` in rawText → trusted (came from the
  //      Slack webhook mention-resolution path). Resolve and return.
  //   b) Token is a bare U-id without a corresponding <@U...> mention
  //      in rawText. Pre-Patch-G the resolver rejected these because
  //      the LLM was told to OUTPUT Slack IDs and a typed-by-user id
  //      was indistinguishable from an LLM-emitted one. Post-Patch-G
  //      the LLM is told to emit lowercase names, so a bare U-id
  //      arriving here is almost certainly the LLM defying the new
  //      prompt — accept it as resolved (defensive) but flag the
  //      reason so we can audit prompt-drift in logs.
  if (/^U[A-Z0-9]{8,}$/.test(tokenRaw)) {
    const mentionsInRaw = params.rawText ? extractSlackMentions(params.rawText) : [];
    const cameFromMention = mentionsInRaw.includes(tokenRaw);
    const user = users.find((u) => u.slack_user_id === tokenRaw);
    return user
      ? {
          status: 'resolved',
          ownerUserId: user.user_id,
          ownerSlackUserId: user.slack_user_id,
          reason: cameFromMention ? 'slack_mention_from_raw' : 'bare_slack_id_defensive_accept',
          inputToken: tokenRaw,
        }
      : {
          status: 'resolved',
          ownerUserId: null,
          ownerSlackUserId: tokenRaw,
          reason: cameFromMention ? 'slack_mention_from_raw_not_in_directory' : 'bare_slack_id_defensive_accept_not_in_directory',
          inputToken: tokenRaw,
        };
  }

  // 4) Strip a leading `@` if the user wrote "@kevin" as plain text
  const plainToken = tokenRaw.replace(/^@/, '').trim();

  // 5) "me" / group words → sender (with a reason so caller can emit TODO)
  if (isFirstPersonToken(plainToken)) {
    return {
      status: 'fallback_to_sender',
      ownerUserId: null,
      ownerSlackUserId: params.senderSlackUserId,
      reason: 'first_person',
    };
  }
  if (isGroupToken(plainToken) || BANNED_TOKENS.has(plainToken.toLowerCase())) {
    return {
      status: 'fallback_to_sender',
      ownerUserId: null,
      ownerSlackUserId: params.senderSlackUserId,
      reason: 'group_word_no_fanout_yet',
    };
  }

  // 6) Canonical override — wins over fuzzy match. The map is now
  // derived from togari_data_lake.users (cached 5min); falls back to
  // the hardcoded NAME_TO_SLACK_ID when the BQ read fails or the
  // canonical alias hasn't been seeded yet (e.g. a new hire's
  // "first last" pair).
  const tokenLower = plainToken.toLowerCase();
  const bqMap = await getCanonicalOverrideMap(tenantId);
  const canonical = bqMap[tokenLower] ?? NAME_TO_SLACK_ID[tokenLower];
  if (canonical) {
    const user = users.find((u) => u.slack_user_id === canonical);
    return {
      status: 'resolved',
      ownerUserId: user?.user_id ?? null,
      ownerSlackUserId: canonical,
      reason: user ? 'canonical_override' : 'canonical_override_not_in_directory',
      inputToken: plainToken,
    };
  }

  // 7) Fuzzy resolve
  const resolution = resolveName(plainToken, users);
  logFuzzyDecision({ inputText: plainToken, tenantId, resolution, senderUserId: params.senderSlackUserId });

  if (resolution.status === 'resolved' && resolution.user) {
    return {
      status: 'resolved',
      ownerUserId: resolution.user.user_id,
      ownerSlackUserId: resolution.user.slack_user_id,
      reason: `fuzzy_name_${resolution.reason}`,
      inputToken: plainToken,
    };
  }

  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      ownerUserId: null,
      ownerSlackUserId: null,
      ambiguousCandidates: resolution.candidates.map((c) => ({
        user_id: c.user.user_id,
        display: [c.user.first_name, c.user.last_name].filter(Boolean).join(' ') || c.user.email,
        slack_user_id: c.user.slack_user_id,
      })),
      reason: resolution.reason,
      inputToken: plainToken,
    };
  }

  // No match at all. PRE-G this fell back to the sender silently —
  // which produced the "I said remind Dave, why did I get the reminder"
  // bug. Post-G we return `unresolved_name` so callers refuse to send
  // the reminder anywhere and ask the user to clarify instead. The
  // genuine first-person path ("remind me") was handled earlier as
  // `fallback_to_sender`, so reaching here means we have a name-shaped
  // token that the directory + canonical override didn't recognise.
  return {
    status: 'unresolved_name',
    ownerUserId: null,
    ownerSlackUserId: null,
    inputToken: plainToken,
    reason: `no_match (${resolution.reason})`,
  };
}

// ── Exported for tests ──────────────────────────────────────────

export const __internal = { levenshtein, normalise, scoreSingle };
