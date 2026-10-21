/**
 * bootstrapping.js — group first-touch handshake + opt-in detection.
 *
 * Decision 14 (strict opt-IN): Medha NEVER outbound-DMs anyone who
 * hasn't 👍'd or "YES"'d her handshake message in the group. This module
 * owns:
 *
 *   1. handshakeMessage(groupMem)         — the intro Medha posts
 *   2. detectOptIn(text, reactionType)    — was this a 👍 / YES?
 *   3. detectStop(text)                   — was this a STOP universal mute?
 *   4. shouldRunHandshake(groupMem, ...)  — gate logic, also handles the
 *                                            retroactive case for groups
 *                                            Medha was already in before
 *                                            v2 shipped
 *   5. recordOptIn / recordOptOut         — flip group-memory state
 *
 * Sending the actual message + persisting the state lives in groups.js
 * (the caller), so this module stays pure and easy to test.
 */

import {
  hasHandshake,
  markHandshakeSent,
  setOptInStatus,
} from "./group-memory.js";

// Default dashboard URL used in the handshake (flaw #8). Env override
// is MEDHA_DASHBOARD_URL.
const DEFAULT_DASHBOARD_URL =
  "https://medha-trip-planning-production.up.railway.app";

function dashboardUrl() {
  return process.env.MEDHA_DASHBOARD_URL || DEFAULT_DASHBOARD_URL;
}

/**
 * The first-touch handshake message Medha posts to a new group.
 * Decision 12 (warm intro, 2 sentences) + decision 14 (opt-in 👍).
 *
 * Voice is intentionally low-key — Caleb's prompt-author rules (§7) say
 * "default to silence, confirm don't ask, no checklists." This message
 * IS one of the few unsolicited group posts Medha makes; it has to feel
 * like a person joining the chat, not a pitch.
 *
 * flaw #6 — optional tenant arg lets per-tenant copy override the
 * default. Set `tenant.expertHandshakeMessage` (or the env var
 * MEDHA_EXPERT_HANDSHAKE_MESSAGE) to a string and we use that verbatim
 * instead of the canned copy.
 *
 * flaw #7 — personality. One line of Medha's actual voice (warm, low-
 * key, in lowercase) was added so the message reads like a person
 * joining the chat instead of a system bot.
 *
 * flaw #8 — append the dashboard URL so people can sign in / see the
 * full picture.
 */
export function handshakeMessage(tenant = null) {
  const override =
    tenant?.expertHandshakeMessage ||
    process.env.MEDHA_EXPERT_HANDSHAKE_MESSAGE ||
    null;
  if (override) return override;
  return [
    // flaw #7 — give it personality. "i'm new here" framing is warmer
    // than "I'm Medha." and matches the lowercase voice in prompts.js.
    "hey, i'm medha — new face in the chat. happy to help with",
    "trips, events, or just keeping the boring stuff straight.",
    "what should i call this chat?",
    "",
    "if any of you reply 👍 in this thread, that's your opt-in for me to",
    "DM you individually for reminders. (no opt-in = group-only.)",
    "",
    // flaw #8 — dashboard link.
    `full dashboard: ${dashboardUrl()}`,
  ].join("\n");
}

/**
 * Slightly different copy for groups Medha was ALREADY in before strict
 * opt-in shipped (decision 14, retroactive). Caleb's call (2026-05-18):
 * yes, run the handshake on first message after deploy in those groups.
 * One question, one tap, done.
 */
export function retroactiveHandshakeMessage(tenant = null) {
  const override =
    tenant?.expertRetroactiveHandshakeMessage ||
    process.env.MEDHA_EXPERT_RETROACTIVE_HANDSHAKE_MESSAGE ||
    null;
  if (override) return override;
  return [
    // flaw #7 — gentler personality on the retroactive version.
    "quick housekeeping from me — i'm tightening up how i handle DMs.",
    "if you want me to be able to DM you individually for reminders,",
    "reply 👍 to this message. otherwise i'll only chat with you in here.",
    "",
    // flaw #8 — dashboard link on retroactive too.
    `full dashboard: ${dashboardUrl()}`,
  ].join("\n");
}

// 👍 tapback reaction id varies by platform. Loop normalizes it to
// "love" / "thumbs_up" / "+1" / etc. We accept any of the obvious ones
// AND check the message text for "yes" / "y" / "👍" so a typed reply
// works the same as a tapback.
const OPT_IN_REACTIONS = new Set([
  "thumbs_up",
  "thumbsup",
  "thumb_up",
  "+1",
  "like",
  "love", // Loop maps the heart tapback as `love`; we accept it too —
  // it's an even stronger affirmative than thumbs-up.
]);

const OPT_IN_TEXT_PATTERNS = [
  /^\s*👍\s*$/u,
  /^\s*(?:yes|yeah|yep|yup|sure|ok|okay)\s*[!.]*\s*$/i,
  /^\s*y\s*$/i,
  /^\s*opt[\s-]?in\s*[!.]*\s*$/i,
];

const OPT_OUT_TEXT_PATTERNS = [
  /^\s*👎\s*$/u,
  /^\s*(?:no|nope|nah|pass)\s*[!.]*\s*$/i,
  /^\s*opt[\s-]?out\s*[!.]*\s*$/i,
];

const STOP_TEXT_PATTERNS = [
  /^\s*stop\s*[!.]*\s*$/i,
  /^\s*unsubscribe\s*[!.]*\s*$/i,
];

/**
 * Did this group message (after the handshake) signal opt-in? Either:
 *   - text matches the patterns above
 *   - reactionType is one of the affirmative tapbacks landing ON the
 *     handshake message
 *
 * Caller decides whether the reaction was on the right message; this fn
 * just checks the type.
 */
export function detectOptIn({ text = null, reactionType = null } = {}) {
  if (
    reactionType &&
    OPT_IN_REACTIONS.has(String(reactionType).toLowerCase())
  ) {
    return true;
  }
  if (text) {
    for (const re of OPT_IN_TEXT_PATTERNS) {
      if (re.test(text)) return true;
    }
  }
  return false;
}

/**
 * Same shape as detectOptIn but for explicit no's. Used when someone
 * says "no don't DM me" in the group. STOP via DM is a separate path
 * (universal mute, not group-scoped) — see detectStop.
 */
export function detectOptOut({ text = null, reactionType = null } = {}) {
  if (reactionType && String(reactionType).toLowerCase() === "thumbsdown") {
    return true;
  }
  if (reactionType && String(reactionType).toLowerCase() === "dislike") {
    return true;
  }
  if (text) {
    for (const re of OPT_OUT_TEXT_PATTERNS) {
      if (re.test(text)) return true;
    }
  }
  return false;
}

/**
 * Did this DM reply say STOP? STOP is a universal mute — Medha stops
 * DMing this person across ALL groups, ALL events. Distinct from
 * per-group opt-out.
 */
export function detectStop(text) {
  if (!text || typeof text !== "string") return false;
  for (const re of STOP_TEXT_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Should we run the handshake right now? Caller passes the current
 * group-memory state + the inbound message context.
 *
 * Returns one of:
 *   - "first_touch"  — group is brand new (no message count, no handshake)
 *   - "retroactive"  — group exists but never got a handshake (pre-v2)
 *   - "skip"         — handshake already done OR conditions don't fit
 *
 * Note: even on "first_touch" / "retroactive" the caller still posts the
 * handshake exactly once per deploy — this function is purely advisory.
 */
export function shouldRunHandshake(
  groupMem,
  { isFirstMessageInGroup = false } = {},
) {
  if (!groupMem) return "skip";
  if (hasHandshake(groupMem)) return "skip";

  // first_touch only when the caller is CERTAIN this is the first
  // message in the group. groupMem.messageCount can be 0 on a freshly
  // loaded cache for a group with prior history Medha just didn't
  // ingest — using messageCount alone as the signal causes the wrong
  // (less-warm) copy to fire for those cases.
  if (isFirstMessageInGroup) return "first_touch";

  // flaw #3 — disambiguate via groupMem.firstMessageAt. If we wrote a
  // firstMessageAt within the last 5 minutes AND there's no handshake
  // yet, this is almost certainly a brand-new group we just started
  // tracking — first_touch copy is correct. Otherwise fall back to the
  // older "retroactive" path.
  const firstAt = groupMem.firstMessageAt
    ? Date.parse(groupMem.firstMessageAt)
    : NaN;
  if (Number.isFinite(firstAt) && Date.now() - firstAt < 5 * 60 * 1000) {
    return "first_touch";
  }

  // We've seen messages in this group before — retroactive case for
  // groups Medha was already in before strict opt-in landed.
  if ((groupMem.messageCount || 0) > 0) return "retroactive";

  // Unknown state (messageCount=0, caller didn't confirm first-touch).
  // Default to retroactive — its copy ("quick housekeeping") is the
  // safer choice when we can't tell. Worst case it reads slightly off
  // for a truly-new group; better than introducing Medha twice if she
  // already chatted in this group at all.
  return "retroactive";
}

/**
 * Mutate groupMem to record an opt-in event. Caller must saveGroupMemory()
 * after this returns. Idempotent.
 */
export function recordOptIn(groupMem, handle) {
  setOptInStatus(groupMem, handle, "opted_in");
}

/**
 * Mutate groupMem to record an opt-out (group-scoped, not STOP).
 */
export function recordOptOut(groupMem, handle) {
  setOptInStatus(groupMem, handle, "opted_out");
}

/**
 * Mutate groupMem to record a STOP. Caller is responsible for ALSO
 * flipping the person's status in every other group's memory if they
 * want true universal-mute semantics. This module only knows about
 * the current group.
 */
export function recordStop(groupMem, handle) {
  setOptInStatus(groupMem, handle, "stopped");
}

// ────────────────────────────────────────────────────────────────────────
// flaw #1 — pending asks (replay original question after handshake)
// ────────────────────────────────────────────────────────────────────────

/**
 * Stash the user's original request so we can replay it after they
 * opt in. Cap at 5 per group to bound memory; FIFO eviction.
 */
export function recordPendingAsk(
  groupMem,
  { text, normFrom, groupId, messageId },
) {
  if (!groupMem || !text || !normFrom) return;
  if (!Array.isArray(groupMem.pendingAsks)) groupMem.pendingAsks = [];
  groupMem.pendingAsks.push({
    text,
    normFrom,
    groupId,
    messageId: messageId || null,
    at: new Date().toISOString(),
  });
  while (groupMem.pendingAsks.length > 5) groupMem.pendingAsks.shift();
}

/**
 * Pop the most recent pending ask FROM A SPECIFIC user, if any. The
 * agent loop calls this after recording an opt-in so it can replay the
 * user's original question in the same turn.
 */
export function popPendingAsk(groupMem, normFrom) {
  if (!groupMem?.pendingAsks?.length || !normFrom) return null;
  for (let i = groupMem.pendingAsks.length - 1; i >= 0; i--) {
    if (groupMem.pendingAsks[i]?.normFrom === normFrom) {
      const [ask] = groupMem.pendingAsks.splice(i, 1);
      return ask;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// flaw #5 — parse the group rename answer
// ────────────────────────────────────────────────────────────────────────

const ALIAS_REJECT_PATTERNS = [
  /^\s*👍|👎\s*$/u,
  /^\s*(?:yes|yeah|yep|yup|sure|ok|okay|y|no|nope|nah|pass)\s*[!.]*\s*$/i,
  /^\s*(?:opt[\s-]?in|opt[\s-]?out|stop|unsubscribe)\s*[!.]*\s*$/i,
  /^\s*hi|hey|hello|sup\s*$/i,
];

/**
 * Heuristic alias parser. Returns a string alias or null.
 *
 * Accepts a quoted name verbatim ('"EDC squad"' → "EDC squad").
 * Accepts a short capitalized phrase up to 4 words.
 * Rejects 👍 / 👎 / yes / no and other handshake-style replies.
 * Strips leading "call it" / "let's call it" / "the".
 */
export function parseGroupAlias(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const re of ALIAS_REJECT_PATTERNS) {
    if (re.test(trimmed)) return null;
  }

  // Quoted form wins.
  const quoted = trimmed.match(/["'""]([^"'""]{1,60})["'""]/);
  if (quoted) return quoted[1].trim();

  // Strip leading conversational prefixes.
  let cleaned = trimmed
    .replace(
      /^\s*(?:call\s+(?:it|us|this)|let'?s\s+call\s+(?:it|us|this)|name\s+(?:it|us|this)|the)\s+/i,
      "",
    )
    .trim();

  // Drop a trailing period / exclamation point.
  cleaned = cleaned.replace(/[.!]+$/, "").trim();

  // Reject if too long — likely a sentence, not an alias.
  if (cleaned.length > 60) return null;
  // Reject if more than 5 words.
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  // Require at least one alphanumeric character.
  if (!/[a-z0-9]/i.test(cleaned)) return null;

  return cleaned;
}

// ────────────────────────────────────────────────────────────────────────
// flaw #9 — opt-in status snapshot (for the admin tool)
// ────────────────────────────────────────────────────────────────────────

/**
 * Read the opt-in roster for a group. Pure — caller loads memory.
 */
export function getGroupOptInRoster(groupMem) {
  if (!groupMem?.optInStatus) return [];
  return Object.entries(groupMem.optInStatus).map(([handle, status]) => ({
    handle,
    status,
  }));
}

/**
 * Compose the second handshake message (after Medha sees who 👍'd):
 *   "cool, let's call this 'EDC squad'? DMs unlocked for Caleb, Sarah, Tom."
 *
 * Caller passes the alias suggestion (or null) and the list of handles
 * that just opted in. This is the "you're locked in" follow-up from the
 * north-star walkthrough in the spec.
 */
export function handshakeConfirmation({
  aliasSuggestion = null,
  optedInDisplayNames = [],
  unoptedDisplayNames = [],
}) {
  const lines = [];
  if (aliasSuggestion) {
    lines.push(
      `cool — let's call this "${aliasSuggestion}" if that fits? say so if not.`,
    );
  }
  if (optedInDisplayNames.length > 0) {
    lines.push(`${optedInDisplayNames.join(", ")} — DMs are unlocked for you.`);
  }
  if (unoptedDisplayNames.length > 0) {
    lines.push(
      `${unoptedDisplayNames.join(", ")} — you can still plan with me in here anytime.`,
    );
  }
  return lines.join("\n");
}
