/**
 * User sessions: per-user conversation state, pending actions, and intent parsing.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";
import { sbGet, sbUpsert } from "./data.js";
import { normalizeHandle } from "./permissions.js";

// Cache keyed by `${tenantId|_}:${handle}` so sessions never bleed across tenants.
const userSessionCache = new Map();
const SESSION_CACHE_TTL = 10 * 60 * 1000;

function sessionCacheKey(handle, tenant) {
  return `${tenant?.id || "_"}:${handle}`;
}

export async function loadUserSession(handle, tenant = null) {
  const norm = normalizeHandle(handle);
  const cacheKey = sessionCacheKey(norm, tenant);
  const cached = userSessionCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < SESSION_CACHE_TTL) {
    return cached.data;
  }
  const empty = {
    handle: norm,
    pending_action: null,
    conversation_state: {},
    personality_profile: {},
  };
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return empty;
  try {
    const row = await sbGet(
      "user_sessions",
      `handle=eq.${encodeURIComponent(norm)}`,
      tenant,
    );
    const data = row
      ? {
          handle: norm,
          pending_action: row.pending_action || null,
          conversation_state: row.conversation_state || {},
          personality_profile: row.personality_profile || {},
        }
      : empty;
    userSessionCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error("[loadUserSession] error:", err.message);
    return empty;
  }
}

export async function saveUserSession(handle, session, tenant = null) {
  const norm = normalizeHandle(handle);
  userSessionCache.set(sessionCacheKey(norm, tenant), {
    data: session,
    fetchedAt: Date.now(),
  });
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;
  try {
    await sbUpsert(
      "user_sessions",
      {
        handle: norm,
        pending_action: session.pending_action || null,
        conversation_state: session.conversation_state || {},
        personality_profile: session.personality_profile || {},
      },
      tenant,
    );
  } catch (err) {
    console.error("[saveUserSession] error:", err.message);
  }
}

export async function clearPendingAction(handle, tenant = null) {
  const session = await loadUserSession(handle, tenant);
  await saveUserSession(handle, { ...session, pending_action: null }, tenant);
}

// Intent parsing
const YES_PATTERNS =
  /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|absolutely|definitely|for sure|please|yes please|sounds good|perfect|let's go|let's do it|lgtm|approved|confirmed|confirm|agree)[\s!.]*$/i;
const NO_PATTERNS =
  /^(no|nah|nope|don't|dont|cancel|stop|never mind|nevermind|skip it|actually no|not now|hold off|pass|reject)[\s!.]*$/i;
const MAYBE_PATTERNS =
  /^(maybe|idk|not sure|unsure|let me think|hmm|later|depends)[\s!.]*$/i;

export function parseIntent(text, pendingAction) {
  const t = text.trim();

  if (pendingAction) {
    if (YES_PATTERNS.test(t)) return { type: "confirm", action: pendingAction };
    if (NO_PATTERNS.test(t)) return { type: "deny", action: pendingAction };
    if (MAYBE_PATTERNS.test(t)) return { type: "maybe", action: pendingAction };
  }

  if (/^(remind me|set (a )?reminder)/i.test(t))
    return { type: "reminder", text: t };
  if (/^(add|create|make) (a )?(task|todo|reminder)/i.test(t))
    return { type: "create_task", text: t };
  if (
    /^(what('s| is) (on )?(my |the )?(calendar|schedule|agenda)|what do i have today|any plans)/i.test(
      t,
    )
  )
    return { type: "check_calendar", text: t };
  if (/^(who is|look up|research|find out about|tell me about) /i.test(t))
    return { type: "lookup", text: t };
  if (/^(send (a )?message|text) (to )?/i.test(t))
    return { type: "send_message", text: t };

  return { type: "chat", text: t };
}
