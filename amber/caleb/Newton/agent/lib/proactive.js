/**
 * Proactive outreach intelligence: smart follow-up system.
 * Inspired by AstrBot's proactive chat plugin.
 *
 * Tracks:
 * - Unanswered outreach count per contact (stops after threshold)
 * - Do-not-disturb windows (no messages during quiet hours)
 * - Per-contact cadence (some people want daily, others weekly)
 * - Last interaction timestamps
 *
 * The goal: Amber reaches out to people who matter, at the right time,
 * without annoying people who aren't responding.
 */

import {
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
  CALEB_PHONE,
} from "./constants.js";
import { sbGet, sbUpsert, sbQuery } from "./data.js";
import { loadContact } from "./contacts.js";
import { callPerplexityLight } from "./tiwari/context.js";
import { normalizeHandle } from "./permissions.js";

// In-memory tracking for unanswered outreach. Keys are namespaced by
// tenant so one tenant's state can never leak into another's.
// Format: `${tenantId|_}:${handle}`.
const outreachState = new Map();

function outreachKey(handle, tenant) {
  return `${tenant?.id || "_"}:${handle}`;
}

const MAX_UNANSWERED = 3; // Stop after 3 unanswered proactive messages
const DND_START = 23; // 11 PM
const DND_END = 8; // 8 AM

/**
 * Check if it's currently a do-not-disturb window.
 */
export function isDND() {
  const hour = new Date().getHours();
  // DND from 11 PM to 8 AM
  return hour >= DND_START || hour < DND_END;
}

/**
 * Record that we sent a proactive message to someone.
 */
export function recordOutreach(handle, tenant = null) {
  const norm = normalizeHandle(handle);
  const key = outreachKey(norm, tenant);
  const state = outreachState.get(key) || {
    unansweredCount: 0,
    lastOutreach: 0,
    lastReply: 0,
  };
  state.unansweredCount++;
  state.lastOutreach = Date.now();
  outreachState.set(key, state);
}

/**
 * Record that someone replied (resets unanswered count).
 */
export function recordReply(handle, tenant = null) {
  const norm = normalizeHandle(handle);
  const key = outreachKey(norm, tenant);
  const state = outreachState.get(key) || {
    unansweredCount: 0,
    lastOutreach: 0,
    lastReply: 0,
  };
  state.unansweredCount = 0;
  state.lastReply = Date.now();
  outreachState.set(key, state);
}

/**
 * Check if we should proactively reach out to a contact.
 * Returns false if: DND, too many unanswered, too recent, or low trust.
 */
export function shouldProactivelyReach(handle, tenant = null) {
  if (isDND()) return false;

  const norm = normalizeHandle(handle);
  const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
  if (norm === normalizeHandle(ownerPhone)) return true; // Always OK to message owner

  const state = outreachState.get(outreachKey(norm, tenant));
  if (!state) return true; // Never reached out before, go ahead

  // Too many unanswered: back off
  if (state.unansweredCount >= MAX_UNANSWERED) {
    return false;
  }

  // Don't reach out more than once per 24 hours
  const hoursSinceOutreach =
    (Date.now() - state.lastOutreach) / (1000 * 60 * 60);
  if (hoursSinceOutreach < 24) return false;

  return true;
}

/**
 * Get contacts who might benefit from a proactive check-in.
 * Considers: health scores, last interaction, relationship, trust score.
 */
export async function getProactiveTargets(tenant = null) {
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return [];

  try {
    // Find contacts with recent activity but no interaction in 3+ days
    const contacts = await sbQuery(
      "contacts",
      "profile->>'trustScore'=gte.0.5",
      { limit: 20, order: "profile->>'lastSeen'.desc", tenant },
    );

    const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
    const targets = [];
    for (const row of contacts) {
      const profile = row.profile || {};
      const handle = row.handle;
      if (!handle || handle === normalizeHandle(ownerPhone)) continue;

      const lastSeen = profile.lastSeen ? new Date(profile.lastSeen) : null;
      if (!lastSeen) continue;

      const daysSince =
        (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

      // Check if this contact is reachable (not too many unanswered)
      if (!shouldProactivelyReach(handle)) continue;

      // Prioritize:
      // - 3-7 days since last contact: gentle check-in
      // - Low health scores: proactive care
      // - High trust: more frequent outreach OK
      if (daysSince >= 3 && daysSince <= 30) {
        targets.push({
          handle,
          displayName: profile.displayName || handle,
          daysSince: Math.floor(daysSince),
          trustScore: profile.trustScore || 0.5,
          relationship: profile.relationship || "unknown",
          lastMood: profile.current_mood || null,
          reason:
            daysSince > 14
              ? "haven't heard from them in a while"
              : "regular check-in",
        });
      }
    }

    // Sort by days since (longest first) then trust (highest first)
    targets.sort((a, b) => {
      if (b.daysSince !== a.daysSince) return b.daysSince - a.daysSince;
      return b.trustScore - a.trustScore;
    });

    return targets.slice(0, 5); // Max 5 proactive targets per cycle
  } catch (err) {
    console.warn("[proactive] Failed to get targets:", err.message);
    return [];
  }
}

/**
 * Generate a proactive message for a specific contact.
 * Uses their profile, health state, and relationship to craft something personal.
 */
export async function generateProactiveMessage(target) {
  const prompt = `You are Amber, Caleb Newton's personal AI. Generate a short, warm proactive check-in message for:

Name: ${target.displayName}
Relationship: ${target.relationship}
Days since last contact: ${target.daysSince}
Their recent mood: ${target.lastMood || "unknown"}
Reason for outreach: ${target.reason}

Rules:
- Keep it to 1-2 sentences max
- Be natural, not formulaic ("Hey! How are you?" is boring)
- Reference something specific if you know it (their mood, interests)
- Don't be needy or guilt-trippy about not hearing from them
- Match the relationship level (casual for friends, warmer for close friends)
- Consider the 6 dimensions of health: if their mood was low, check on the relevant dimension

Examples of GOOD proactive messages:
- "Been thinking about you, how'd that thing at work go?"
- "Random but I remembered you mentioned wanting to try that new place, did you go?"
- "Haven't heard from you in a bit, hope you're good"

Examples of BAD proactive messages:
- "Hi! Just checking in! How are you doing today?"
- "It's been 5 days since we last talked"
- "Amber here! I noticed you haven't messaged in a while"

Return ONLY the message text, nothing else.`;

  return await callPerplexityLight(prompt, { maxTokens: 100 });
}
