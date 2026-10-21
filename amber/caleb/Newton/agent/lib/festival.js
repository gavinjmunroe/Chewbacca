/**
 * Festival / social-mode helpers for the Friday MVP.
 *
 * Three jobs:
 *   1. SAFE keyword — harm-reduction only response (hydration, friend/medical
 *      tent, get-home, escalation). No drug sourcing, no dosing, no medical
 *      advice.
 *   2. Substance redirect — when someone mentions taking / having / wanting
 *      a drug, route to safety + general DanceSafe-style testing caution +
 *      emergency note. Never confirm, source, or dose.
 *   3. First-contact greeting + first-name gate — for brand-new contacts
 *      (messageCount <= 1, no displayName known), produce a warm, radiant,
 *      protective opening that asks for their first name before deeper
 *      engagement. Devotional joy / care energy, NOT romantic escalation.
 *
 * No external URLs. No medical advice. Tone is human, warm, and consent-aware.
 *
 * All copy here is run through `humanize()` (lib/voice-guard.js) on the
 * way out so em-dashes, "as an AI" disclaimers, and service-desk closers
 * can't sneak in even when a future edit accidentally introduces them.
 */

import { humanize } from "./voice-guard.js";

// Single ASCII word "SAFE", case-insensitive, possibly with surrounding
// punctuation / whitespace. We require it to be the dominant token so we
// don't fire on prose like "drive safe" or "is it safe to...".
const SAFE_KEYWORD = /^\s*safe[\s.!?:,-]*$/i;

// Substance mentions we want to deflect into safety + harm-reduction.
// Intentionally narrow — these are the most common festival substances.
// We match standalone words / common slang. False positives are okay:
// they get a safety nudge instead of a clinical reply, which is fine.
const SUBSTANCE_PATTERNS = [
  /\b(mdma|molly|ecstasy|rolling|rolled)\b/i,
  /\b(lsd|acid|tabs?)\b/i,
  /\b(shrooms?|mushies|psilocybin)\b/i,
  /\b(ket|ketamine|special k)\b/i,
  /\b(coke|cocaine|blow)\b/i,
  /\b(ghb|gbl)\b/i,
  /\b2c-?[bicd]\b/i,
  /\bdmt\b/i,
  /\b(adderall|addy|xan(?:s|ax)?|benzos?)\b/i,
  /\bmeth\b/i,
  // Phrasing-based — drug talk regardless of substance
  /\b(dose|dosing|dosage|micro-?dose|re-?dose)\b/i,
  /\b(drop|dropped|drops|took|taking|popped) (?:a|some|my|the)? ?(?:tab|cap|pill|hit)\b/i,
  /\bwhere (?:can i|do i|to) (?:get|buy|find|cop)\b.{0,40}\b(stuff|drugs|something|tabs?|caps?|pills?)\b/i,
];

const URGENT_PATTERNS = [
  /\b(overdose|overdosing|od(?:'d|ed| ?ing)?|seizing|unconscious|not breathing|blue lips?|won'?t wake up|unresponsive)\b/i,
  /\bbad trip\b/i,
  /\bcan'?t breathe\b/i,
  /\b(heart racing|chest pain|passing out|blacking out)\b/i,
];

export function matchesSafeKeyword(text) {
  if (!text) return false;
  return SAFE_KEYWORD.test(text);
}

export function mentionsSubstance(text) {
  if (!text) return false;
  return SUBSTANCE_PATTERNS.some((p) => p.test(text));
}

export function isUrgentSubstanceSignal(text) {
  if (!text) return false;
  return URGENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Reply for the SAFE keyword. Short, calm, harm-reduction-first.
 * No external links. No medical advice. Tells them what to do, not what to take.
 */
export function buildSafeKeywordReply() {
  return humanize(
    [
      "I'm here. A few things, in order:",
      "1. Drink water. Sit down somewhere shaded or quiet if you can.",
      "2. Find a trusted friend, a medical or harm-reduction tent, or event security. They're there for exactly this.",
      "3. If you need to get home, line up a rideshare now while you're still able to text. Share your ETA with someone you trust.",
      "4. If anything feels truly wrong (trouble breathing, can't stay awake, chest pain, someone is unresponsive) call 911 or get to medical right now. Don't wait it out.",
      "You're not in trouble with me. Tell me what's going on and I'll stay with you.",
    ].join("\n"),
  );
}

/**
 * Reply when someone mentions a substance. Never sources, doses, or
 * endorses use. Pivots to safety + general testing caution + emergency
 * line. No external URLs.
 */
export function buildSubstanceRedirectReply({ urgent = false } = {}) {
  if (urgent) {
    return humanize(
      [
        "This sounds urgent. If someone is unresponsive, can't breathe, or is having a medical emergency, call 911 or get to the on-site medical tent right now.",
        "I can't give medical or dosing advice. Stay with the person, keep them on their side if they're not alert, and flag a medic or security immediately.",
      ].join("\n"),
    );
  }
  return humanize(
    [
      "I'm not going to be useful for sourcing, dosing, or anything like that. It's not what I'm here for and I don't want to get it wrong.",
      "What I can do: help you stay safe. Hydrate, pace yourself, stay with people you trust. If anyone is going to use anything, harm-reduction groups on site test substances for free, find one. Never use alone.",
      "If anything tips into a real emergency (unresponsive, trouble breathing, chest pain, panic that won't settle) please go to medical or call 911. Text me SAFE anytime and I'll walk you through what to do.",
    ].join("\n"),
  );
}

/**
 * Heuristic: should we send the first-contact greeting + name gate?
 * True when:
 *   - We have not yet learned a displayName for this contact.
 *   - This is one of their first messages to us (<=1 prior).
 *   - It is a DM (not a group — group dynamics handled elsewhere).
 *   - They are not the tenant owner.
 *
 * Caller owns the "we already greeted in this session" flag via the
 * contact profile (see `contact.festivalGreetedAt`).
 */
export function shouldSendFirstContactGreeting({ contact, isGroup, isOwner }) {
  if (isGroup) return false;
  if (isOwner) return false;
  if (!contact) return false;
  if (contact.displayName) return false;
  if (contact.festivalGreetedAt) return false;
  if ((contact.messageCount || 0) > 1) return false;
  return true;
}

/**
 * First-contact greeting copy. Warm, radiant, protective, devotional-joyful.
 * Asks for first name before going deeper. Consent-aware. NOT romantic /
 * sexually escalating — women should feel safer, not targeted.
 *
 * `agentName` is the per-tenant agent name ("Camber" for Caleb, "Samber"
 * for Sagar, etc.) so the copy stays generalized across tenants.
 */
export function buildFirstContactGreeting({ agentName = "Medha" } = {}) {
  return humanize(
    [
      `Hey, ${agentName} here. Glad you reached out.`,
      "Before we get into anything, what's your first name? Just want to know who I'm talking to so I can actually be useful (and not weird about it).",
      "If you ever need help during the weekend (getting home, finding a friend, or anything feels off) text me the word SAFE and I'll stay with you.",
    ].join("\n"),
  );
}

// Intents that should make Amber send back her vCard so the user can
// save the contact in one tap. Kept tight so we don't fire on prose
// like "I'm trying to find Amber's contact list". DMs only — callers
// gate on isGroup themselves.
const VCARD_INTENT_PATTERNS = [
  /\b(send|share|drop|text)\s+(?:me\s+)?(?:your|the|amber'?s)\s+(?:contact|vcard|v-card|info|number|digits)\b/i,
  /\bsave\s+(?:your|amber'?s|amber)\s+(?:contact|number|info|details)\b/i,
  /\b(?:can|could|would)\s+(?:you|u)\s+(?:send|share|text)\s+(?:me\s+)?(?:your|amber'?s)?\s*(?:contact|vcard|v-card|number)\b/i,
  /^\s*(?:vcard|v-card|contact card|contact please|your contact|your number)\s*[?.!]*\s*$/i,
  /\badd\s+(?:you|amber)\s+to\s+(?:my\s+)?contacts?\b/i,
  /\b(?:how|where)\s+do\s+i\s+save\s+(?:your|amber'?s|amber)\s+(?:contact|number)\b/i,
];

export function wantsVcardShare(text) {
  if (!text || typeof text !== "string") return false;
  return VCARD_INTENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Short text that goes alongside the contact-card attachment. We keep
 * it tiny on purpose — the bubble itself is the payload, prose is
 * just for context. Used both when the user asks for the card and as
 * an opt-in follow-up after the first-contact greeting.
 */
export function buildVcardShareReply() {
  return humanize(
    "Here's my contact — tap to save. Text me anytime, or send SAFE if anything feels off.",
  );
}

/**
 * Try to extract a plausible first name from a short reply to the greeting.
 * Returns null if we can't confidently extract one. Conservative — better
 * to keep asking than to mis-label someone.
 */
export function extractFirstNameFromReply(text) {
  if (!text) return null;
  const cleaned = text.trim();
  if (!cleaned) return null;
  if (cleaned.length > 60) return null;
  // Common phrasings: "I'm X", "It's X", "X here", "name is X", or just "X"
  const patterns = [
    /^(?:i'?m|it'?s|this is|name'?s|my name is|call me)\s+([a-z][a-z'-]{1,30})/i,
    /^([a-z][a-z'-]{1,30})\s+(?:here|speaking)\b/i,
    /^([a-z][a-z'-]{1,30})[.!\s]*$/i,
  ];
  for (const p of patterns) {
    const m = cleaned.match(p);
    if (m && m[1]) {
      const name = m[1];
      // Reject obvious non-names AND any tenant-owner / agent-persona
      // handle. A first-contact stranger replying "I'm Sagar" or "Caleb"
      // must NOT get saved with the owner's name as their display name
      // — same identity-leak class as the Maggie/Sagar bug elsewhere.
      const forbidden = new Set([
        "yes",
        "no",
        "ok",
        "okay",
        "sure",
        "yeah",
        "nah",
        "yo",
        "hey",
        "hi",
        "hello",
        "sup",
        "thanks",
        "ty",
        "amber",
        "camber",
        "samber",
        "caleb",
        "caleb newton",
        "sagar",
        "sagar tiwari",
        "stop",
        "safe",
        "help",
        "idk",
        "dunno",
        "maybe",
        "lol",
        "lmao",
        "haha",
        "wait",
        "what",
        "huh",
        "k",
        "kk",
        "fine",
        "good",
        "bad",
        "cool",
        "nice",
        "nope",
        "yep",
        "yup",
      ]);
      if (forbidden.has(name.toLowerCase())) return null;
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }
  }
  return null;
}
