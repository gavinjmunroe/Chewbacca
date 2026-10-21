/**
 * Group-level memory: persistent context for each group chat.
 * Tracks: group name, purpose, participants, topics discussed,
 * decisions made, running context, and health dimension signals.
 *
 * This is the "group layer" of the context hierarchy:
 * Global Amber > Group Memory > Per-Contact > Current Message
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";
import { sbGet, sbUpsert } from "./data.js";
import { callPerplexityLight } from "./tiwari/context.js";

const groupMemoryCache = new Map(); // groupId -> { data, fetchedAt }
const GROUP_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Load group memory from Supabase (with cache).
 */
export async function loadGroupMemory(groupId, tenant = null) {
  const cached = groupMemoryCache.get(groupId);
  if (cached && Date.now() - cached.fetchedAt < GROUP_CACHE_TTL) {
    return cached.data;
  }

  const defaultMemory = {
    groupId,
    name: null,
    purpose: null,
    participants: [],
    topics: [],
    decisions: [],
    context: "",
    messageCount: 0,
    createdAt: new Date().toISOString(),
    // Trip-planning v2 (decision 14): strict opt-in for DMs.
    // opt_in_status keys on the normalized handle (phone or email),
    // values are one of: pending | opted_in | opted_out | stopped.
    // `pending` means we sent the handshake; `opted_in` means they 👍'd.
    // `opted_out` means they explicitly said no in chat; `stopped` means
    // they texted STOP to the DM (universal mute).
    optInStatus: {},
    // ISO timestamp of the most recent handshake DM/intro we posted in
    // this group. Used to (a) avoid re-sending the handshake on every
    // boot, (b) decide whether the retroactive-handshake should fire
    // for groups Medha was already in pre-v2.
    handshakeAt: null,
    // flaw #3 — ISO timestamp of the FIRST inbound message we ever saw
    // for this group. Used to disambiguate "freshly loaded cache for a
    // truly-new group" (firstMessageAt within the last 5 min) from
    // "freshly loaded cache for an old group" (firstMessageAt absent
    // or far in the past) so the right handshake copy fires.
    firstMessageAt: null,
    // flaw #5 — after the handshake asks "what should i call this
    // chat?", this flag is set so the NEXT inbound message gets parsed
    // for a likely alias. Cleared once an alias is captured or after a
    // few messages of non-alias replies (so it doesn't latch forever).
    awaitingAlias: false,
    // flaw #1 — original asks the user made BEFORE opt-in landed. We
    // replay the most recent one after they opt in so they don't have
    // to retype it. Cap at 5; FIFO.
    pendingAsks: [],
    // flaw #27 — the MED-XXXX id of the active event for this group, if
    // any. Set by event_create / event_update on success, cleared by
    // event_cancel / event_archive. The commitment-extractor reads this
    // to know what event to attribute an "I'll bring X" to.
    currentEventId: null,
  };

  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return defaultMemory;

  try {
    const row = await sbGet(
      "group_memories",
      `group_id=eq.${encodeURIComponent(groupId)}`,
      tenant,
    );
    const data = row
      ? { ...defaultMemory, ...row.memory, groupId }
      : defaultMemory;
    groupMemoryCache.set(groupId, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error("[loadGroupMemory] error:", err.message);
    return defaultMemory;
  }
}

/**
 * Save group memory to Supabase and update cache.
 */
export async function saveGroupMemory(groupId, memory, tenant = null) {
  groupMemoryCache.set(groupId, { data: memory, fetchedAt: Date.now() });
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;

  try {
    await sbUpsert(
      "group_memories",
      {
        group_id: groupId,
        memory,
      },
      tenant,
    );
  } catch (err) {
    console.error("[saveGroupMemory] error:", err.message);
  }
}

/**
 * Update group memory after a conversation batch.
 * Called periodically (not every message) to extract group-level learnings.
 */
export async function updateGroupMemoryFromConversation(
  groupId,
  recentMessages,
  groupName,
  participants,
  tenant = null,
) {
  const groupMem = await loadGroupMemory(groupId, tenant);
  groupMem.messageCount = (groupMem.messageCount || 0) + recentMessages.length;

  // Update basic metadata
  if (groupName && !groupMem.name) groupMem.name = groupName;
  if (participants?.length > 0) {
    const existing = new Set(groupMem.participants);
    for (const p of participants) {
      if (!existing.has(p)) {
        groupMem.participants.push(p);
      }
    }
  }

  // Only run AI extraction every 10 messages
  if (groupMem.messageCount % 10 !== 0) {
    await saveGroupMemory(groupId, groupMem, tenant);
    return;
  }

  const transcript = recentMessages
    .slice(-15)
    .map((m) => {
      const label = m.role === "assistant" ? "Amber" : m.senderLabel || m.from;
      return `${label}: ${m.content}`;
    })
    .join("\n");

  try {
    const raw = await callPerplexityLight(
      `Analyze this group chat conversation and extract group-level context.

GROUP: ${groupMem.name || "unnamed"}
EXISTING TOPICS: ${(groupMem.topics || []).join(", ") || "none"}
EXISTING PURPOSE: ${groupMem.purpose || "unknown"}

RECENT CONVERSATION:
${transcript}

Return JSON:
{
  "purpose": "what this group is about (null if unclear)",
  "new_topics": ["topics discussed that aren't in existing list"],
  "decisions": ["any decisions or commitments made"],
  "group_vibe": "the social energy/mood of this group",
  "context_update": "1-2 sentence summary of what's happening in this group right now"
}`,
      { maxTokens: 300 },
    );

    if (raw) {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        if (extracted.purpose && !groupMem.purpose) {
          groupMem.purpose = extracted.purpose;
        }
        if (Array.isArray(extracted.new_topics)) {
          const existingTopics = new Set(groupMem.topics);
          for (const t of extracted.new_topics) {
            if (!existingTopics.has(t)) {
              groupMem.topics.push(t);
            }
          }
          groupMem.topics = groupMem.topics.slice(-20); // cap at 20
        }
        if (Array.isArray(extracted.decisions)) {
          groupMem.decisions = [
            ...groupMem.decisions,
            ...extracted.decisions.map((d) => ({
              decision: d,
              timestamp: new Date().toISOString(),
            })),
          ].slice(-10);
        }
        if (extracted.group_vibe) {
          groupMem.vibe = extracted.group_vibe;
        }
        if (extracted.context_update) {
          groupMem.context = extracted.context_update;
        }
        console.log(
          `[group-memory] Updated group ${groupMem.name || groupId}: ${extracted.new_topics?.length || 0} new topics, ${extracted.decisions?.length || 0} decisions`,
        );
      }
    }
  } catch (err) {
    console.warn("[group-memory] Extraction failed:", err.message);
  }

  await saveGroupMemory(groupId, groupMem, tenant);
}

/**
 * Build a context block from group memory for injection into the system prompt.
 */
export function buildGroupMemoryBlock(groupMem) {
  if (!groupMem) return "";
  const parts = [];
  if (groupMem.purpose) parts.push(`Purpose: ${groupMem.purpose}`);
  if (groupMem.vibe) parts.push(`Group vibe: ${groupMem.vibe}`);
  if (groupMem.topics?.length > 0) {
    parts.push(`Topics discussed: ${groupMem.topics.slice(-8).join(", ")}`);
  }
  if (groupMem.decisions?.length > 0) {
    const recent = groupMem.decisions.slice(-3);
    parts.push(`Recent decisions: ${recent.map((d) => d.decision).join("; ")}`);
  }
  if (groupMem.context) parts.push(`Current context: ${groupMem.context}`);
  if (parts.length === 0) return "";
  return `\nGROUP MEMORY:\n${parts.join("\n")}`;
}

// ────────────────────────────────────────────────────────────────────────
// Opt-in state machine (decision 14, trip-planning v2)
// ────────────────────────────────────────────────────────────────────────

/**
 * Whether the group has had its handshake (any value for handshakeAt).
 * Used by groups.js to decide "do I need to run the bootstrap flow".
 */
export function hasHandshake(groupMem) {
  return !!groupMem?.handshakeAt;
}

/**
 * Mark the handshake as sent NOW. Idempotent; safe to call multiple
 * times — only the first call wins per group, but later calls are no-ops
 * because the timestamp doesn't move unless the caller asks for it.
 */
export function markHandshakeSent(groupMem) {
  if (!groupMem) return;
  if (!groupMem.handshakeAt) {
    groupMem.handshakeAt = new Date().toISOString();
  }
  if (!groupMem.optInStatus) groupMem.optInStatus = {};
  // Anyone we know about gets seeded as `pending` (handshake sent, no
  // 👍 yet). New participants discovered later also start as pending.
  for (const p of groupMem.participants || []) {
    const handle = typeof p === "string" ? p : p?.handle;
    if (handle && !groupMem.optInStatus[handle]) {
      groupMem.optInStatus[handle] = "pending";
    }
  }
}

/**
 * Update one person's opt-in status. Status must be one of:
 *   pending | opted_in | opted_out | stopped
 * `stopped` is the universal mute set by STOP DM reply.
 */
export function setOptInStatus(groupMem, handle, status) {
  if (!groupMem || !handle) return;
  if (!["pending", "opted_in", "opted_out", "stopped"].includes(status)) {
    return;
  }
  if (!groupMem.optInStatus) groupMem.optInStatus = {};
  groupMem.optInStatus[handle] = status;
}

/**
 * Return the array of handles eligible to receive a DM right now.
 * `opted_in` only (not `pending`, not `opted_out`, not `stopped`).
 *
 * Optionally exclude specific handles (e.g. the sender of the message
 * that triggered the fan-out — they don't need to DM themselves) and
 * Medha's own number (never DM ourselves).
 */
export function eligibleDmRecipients(groupMem, { exclude = [] } = {}) {
  if (!groupMem?.optInStatus) return [];
  const excludeSet = new Set(exclude.filter(Boolean));
  const out = [];
  for (const [handle, status] of Object.entries(groupMem.optInStatus)) {
    if (status === "opted_in" && !excludeSet.has(handle)) {
      out.push(handle);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// flaw #3 — first-message timestamp helper
// ────────────────────────────────────────────────────────────────────────

/**
 * Stamp firstMessageAt on the FIRST inbound we ever see for a group.
 * Idempotent — only writes when the field is currently null/missing.
 * Caller must saveGroupMemory() to persist.
 */
export function ensureFirstMessageAt(groupMem) {
  if (!groupMem) return false;
  if (groupMem.firstMessageAt) return false;
  groupMem.firstMessageAt = new Date().toISOString();
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// flaw #4 — in-process mutex on concurrent handshake fires
// ────────────────────────────────────────────────────────────────────────

const handshakeInFlight = new Set();

/**
 * Try to acquire the handshake lock for a group. Returns true on
 * success (caller is the winner and must release after the send +
 * save completes), false if another fiber already holds it.
 */
export function acquireHandshakeLock(groupId) {
  if (!groupId) return false;
  if (handshakeInFlight.has(groupId)) return false;
  handshakeInFlight.add(groupId);
  return true;
}

/**
 * Release the handshake lock. Idempotent.
 */
export function releaseHandshakeLock(groupId) {
  if (!groupId) return;
  handshakeInFlight.delete(groupId);
}
