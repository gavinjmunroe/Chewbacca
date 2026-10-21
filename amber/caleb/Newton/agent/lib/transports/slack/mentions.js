/**
 * Slack mention -> email pre-resolver.
 *
 * Slack delivers inbound text with mention tokens baked in, not raw names:
 *
 *   "@Shirley Park"  arrives as  "<@U07ABC>"
 *   "@BMA Team"      arrives as  "<!subteam^S456DEF>"
 *   "#general"       arrives as  "<#C123|general>"
 *
 * The agent loop's calendar tool (`schedule_event` in lib/tools/gcal/tools.js)
 * expects `attendees: ["email1", "email2"]`. If the inbound text still
 * contains raw mention tokens by the time it reaches the loop, the model
 * either invents emails or asks the user to retype them, both of which
 * Sagar has now hit in production.
 *
 * This module resolves those tokens up front: parses them out, calls Slack's
 * users.info / usergroups.users.list endpoints with the same bot token the
 * responder uses, rewrites the message text so the model sees email
 * addresses inline, and surfaces a deduped `emails[]` + `unresolved[]` array
 * alongside the envelope's meta block for programmatic access.
 *
 * Performance notes:
 *   - All Slack calls run with AbortSignal.timeout(4000). The envelope-side
 *     `Promise.race` further caps total budget at 1.5s.
 *   - Resolved user emails are memoized in an in-process LRU (TTL 5min, cap
 *     200 entries) so a chatty thread doesn't re-burn API quota on the same
 *     IDs.
 *   - Subteam membership is NOT cached — it changes more often than email
 *     does, and we still hit the user cache for each member's profile.
 */

const USERS_INFO_URL = "https://slack.com/api/users.info";
const USERGROUPS_USERS_LIST_URL = "https://slack.com/api/usergroups.users.list";
const SLACK_FETCH_TIMEOUT_MS = 4_000;

// User-mention regex matches the canonical `<@U…>` form. Slack also emits
// `<@U…|label>` when a display name is present; we tolerate the optional
// `|label` segment. User IDs may start with U (humans) or W (Enterprise Grid),
// so accept both.
const USER_MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;
const SUBTEAM_MENTION_RE = /<!subteam\^([A-Z0-9]+)(?:\|[^>]+)?>/g;
const CHANNEL_MENTION_RE = /<#(C[A-Z0-9]+)(?:\|([a-z0-9_\-]+))?>/g;

// ── In-memory LRU for user email lookups ──────────────────────────────────
const USER_EMAIL_CACHE_MAX = 200;
const USER_EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const userEmailCache = new Map();

function cacheGet(key) {
  const entry = userEmailCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.t > USER_EMAIL_CACHE_TTL_MS) {
    userEmailCache.delete(key);
    return undefined;
  }
  // Re-insert to mark as most-recently-used.
  userEmailCache.delete(key);
  userEmailCache.set(key, entry);
  return entry.v;
}

function cacheSet(key, value) {
  if (userEmailCache.has(key)) userEmailCache.delete(key);
  userEmailCache.set(key, { v: value, t: Date.now() });
  while (userEmailCache.size > USER_EMAIL_CACHE_MAX) {
    const oldest = userEmailCache.keys().next().value;
    if (oldest === undefined) break;
    userEmailCache.delete(oldest);
  }
}

/**
 * Parse mention tokens out of a Slack message text. Pure / synchronous; no
 * network calls. Useful both internally and as a unit-test seam.
 *
 * @param {string} text
 * @returns {{
 *   userIds: string[],
 *   groupIds: string[],
 *   channels: Array<{ id: string, name: string | null }>
 * }}
 *   Each list is de-duplicated. `channels` preserves the inline `|name`
 *   label when Slack provided one, otherwise name is null.
 */
export function extractMentionTokens(text) {
  const empty = { userIds: [], groupIds: [], channels: [] };
  if (typeof text !== "string" || !text) return empty;

  const userIds = new Set();
  const groupIds = new Set();
  const channelMap = new Map();

  let m;
  USER_MENTION_RE.lastIndex = 0;
  while ((m = USER_MENTION_RE.exec(text)) !== null) {
    userIds.add(m[1]);
  }
  SUBTEAM_MENTION_RE.lastIndex = 0;
  while ((m = SUBTEAM_MENTION_RE.exec(text)) !== null) {
    groupIds.add(m[1]);
  }
  CHANNEL_MENTION_RE.lastIndex = 0;
  while ((m = CHANNEL_MENTION_RE.exec(text)) !== null) {
    const id = m[1];
    const name = m[2] || null;
    // Last-write-wins so a labelled mention overrides an earlier unlabeled one.
    if (!channelMap.has(id) || (name && !channelMap.get(id).name)) {
      channelMap.set(id, { id, name });
    }
  }

  return {
    userIds: Array.from(userIds),
    groupIds: Array.from(groupIds),
    channels: Array.from(channelMap.values()),
  };
}

/**
 * Resolve a Slack user id to an email via users.info. Cached.
 *
 * @param {string} userId
 * @param {string} botToken — xoxb-... from process.env.SLACK_BOT_TOKEN
 * @returns {Promise<string | null>}
 *   The user's profile email when Slack exposes one (requires `users:read.email`
 *   scope). null on missing scope, missing email, deactivated user, non-2xx,
 *   timeout, or any other failure mode. Callers must treat null as
 *   "unresolved" and surface that fact rather than fabricating an address.
 */
export async function resolveUserEmail(userId, botToken) {
  if (!userId || !botToken) return null;
  const cached = cacheGet(userId);
  if (cached !== undefined) return cached;

  const url = `${USERS_INFO_URL}?user=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[slack-mentions] users.info ${userId} http=${res.status}`);
      cacheSet(userId, null);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) {
      console.warn(
        `[slack-mentions] users.info ${userId} error=${data?.error || "unknown"}`,
      );
      cacheSet(userId, null);
      return null;
    }
    const email = data.user?.profile?.email || null;
    cacheSet(userId, email);
    return email;
  } catch (err) {
    console.warn(`[slack-mentions] users.info ${userId} threw: ${err.message}`);
    return null;
  }
}

/**
 * Resolve a Slack user-group (`<!subteam^S…>`) to the emails of its members.
 *
 * @param {string} subteamId — the `S…` id (without the `<!subteam^…>` wrapper)
 * @param {string} botToken
 * @returns {Promise<string[]>}
 *   Deduped list of non-null emails. Members without an exposed email (or
 *   whose lookup failed) are silently dropped, but the surrounding
 *   `resolveAllMentions` will mark the subteam token as unresolved when
 *   this returns an empty array.
 */
export async function resolveSubteamMembers(subteamId, botToken) {
  if (!subteamId || !botToken) return [];
  const url = `${USERGROUPS_USERS_LIST_URL}?usergroup=${encodeURIComponent(subteamId)}`;
  let memberIds = [];
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-mentions] usergroups.users.list ${subteamId} http=${res.status}`,
      );
      return [];
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) {
      console.warn(
        `[slack-mentions] usergroups.users.list ${subteamId} error=${data?.error || "unknown"}`,
      );
      return [];
    }
    memberIds = Array.isArray(data.users) ? data.users : [];
  } catch (err) {
    console.warn(
      `[slack-mentions] usergroups.users.list ${subteamId} threw: ${err.message}`,
    );
    return [];
  }

  if (memberIds.length === 0) return [];

  // Resolve every member in parallel; the per-user cache absorbs repeats.
  const emails = await Promise.all(
    memberIds.map((uid) => resolveUserEmail(uid, botToken)),
  );
  const deduped = new Set();
  for (const e of emails) {
    if (e && typeof e === "string") deduped.add(e);
  }
  return Array.from(deduped);
}

/**
 * Top-level orchestrator. Walks every mention token in `text`, resolves it,
 * and rewrites the text so the agent loop sees email addresses (or channel
 * names) inline. The resulting `emails` array is deduped and order-stable so
 * a downstream tool can pass it straight to `schedule_event`'s `attendees`.
 *
 * @param {string} text
 * @param {string} botToken
 * @returns {Promise<{
 *   resolvedText: string,
 *   emails: string[],
 *   unresolved: string[]
 * }>}
 *   `unresolved` lists the original token strings (e.g. "<@U07ABC>" or
 *   "<!subteam^S456>") that we could not turn into at least one email, so
 *   the agent can ask the user for clarification instead of silently
 *   dropping participants.
 */
export async function resolveAllMentions(text, botToken) {
  if (typeof text !== "string" || !text) {
    return { resolvedText: text || "", emails: [], unresolved: [] };
  }

  const { userIds, groupIds, channels } = extractMentionTokens(text);
  if (userIds.length === 0 && groupIds.length === 0 && channels.length === 0) {
    return { resolvedText: text, emails: [], unresolved: [] };
  }

  // Resolve users and subteams in parallel.
  const [userEmailEntries, subteamEmailEntries] = await Promise.all([
    Promise.all(
      userIds.map(async (uid) => [uid, await resolveUserEmail(uid, botToken)]),
    ),
    Promise.all(
      groupIds.map(async (sid) => [
        sid,
        await resolveSubteamMembers(sid, botToken),
      ]),
    ),
  ]);

  const userEmailById = new Map(userEmailEntries);
  const subteamEmailsById = new Map(subteamEmailEntries);

  const emails = [];
  const emailSet = new Set();
  const unresolved = [];
  const pushEmail = (e) => {
    if (e && !emailSet.has(e)) {
      emailSet.add(e);
      emails.push(e);
    }
  };

  // Rewrite user mentions inline. Replacing left-to-right with the same
  // regex preserves position and handles repeated mentions cleanly.
  let resolvedText = text.replace(USER_MENTION_RE, (match, uid) => {
    const email = userEmailById.get(uid);
    if (email) {
      pushEmail(email);
      return email;
    }
    if (!unresolved.includes(match)) unresolved.push(match);
    return match;
  });

  resolvedText = resolvedText.replace(SUBTEAM_MENTION_RE, (match, sid) => {
    const members = subteamEmailsById.get(sid) || [];
    if (members.length > 0) {
      for (const e of members) pushEmail(e);
      return members.join(", ");
    }
    if (!unresolved.includes(match)) unresolved.push(match);
    return match;
  });

  resolvedText = resolvedText.replace(
    CHANNEL_MENTION_RE,
    (match, _id, name) => {
      if (name) return `#${name}`;
      // No label, no API call (channels.info would need an extra scope and
      // adds no signal the agent can act on for scheduling). Leave the raw
      // token and flag it.
      if (!unresolved.includes(match)) unresolved.push(match);
      return match;
    },
  );

  return { resolvedText, emails, unresolved };
}

// Exposed for tests; not part of the public surface.
export function __clearMentionCache() {
  userEmailCache.clear();
}
