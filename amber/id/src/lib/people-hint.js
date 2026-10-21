/**
 * WHO DO I ALREADY KNOW THAT THIS IS ABOUT?
 *
 * "Help me plan a dinner in San Francisco" used to come back as a good written
 * answer and three restaurant cards and nobody — because the router only reaches
 * the address book when the message contains a possessive ("my", "I know", "who
 * should I"), and an ordinary planning request contains none. So every voice note
 * ever recorded saying "Priya just moved to SF" was invisible to the one question
 * it existed to answer.
 *
 * The fix is deliberately NOT a change to intent classification, which would move
 * every existing query shape at once. It is a side channel: on a normal chat turn,
 * if the message names a place, look through what the user has actually said for
 * people connected to it, and show those cards alongside the answer. A turn can
 * now be a conversation AND a recall at the same time, which is what the product
 * is for.
 *
 * It costs one indexed SQL statement, runs concurrently with generation, and is
 * emitted whenever it finishes — so it cannot delay a single token of the reply.
 *
 * WHAT IT WILL AND WILL NOT FIND. Only places, and only places it can name. A city
 * has several names — San Francisco is also "SF", also "the Bay Area", also
 * "Oakland" — and searching for one of them finds a fraction of the notes, so a
 * known region expands to all of its aliases. A place that is not a known region
 * (a neighborhood, "Williamsburg") is picked up only when the sentence points at
 * it with a preposition. Topics are not searched at all: looking up "dinner"
 * across someone's memory returns noise, and a wrong contact card reads as recall
 * and is worse than no card.
 */

import { regionForQuery } from "./area-codes.js";

// Words that follow "in"/"near"/"around" without naming a place.
const NOT_A_PLACE = new Set([
  "a", "an", "the", "my", "your", "his", "her", "their", "our", "this", "that",
  "some", "any", "town", "person", "people", "mind", "general", "advance",
  "case", "fact", "order", "time", "touch", "charge", "front", "back", "between",
  "particular", "common", "short", "detail", "public", "private", "person",
]);

const PREPOSITION = /\b(?:in|near|around|visiting|based in|moving to|out in|over in)\s+([a-z][a-z'’.-]*(?:\s+[a-z][a-z'’.-]*){0,2})/i;

// The place name ends here. Without this the two-extra-words window swallows the
// rest of the clause — "in williamsburg with three friends" became the search term
// "williamsburg with three", which matches nothing anyone ever wrote.
const PHRASE_END = new Set([
  "with", "and", "for", "to", "at", "on", "this", "next", "last", "tomorrow",
  "tonight", "today", "who", "that", "so", "but", "or", "if", "when", "while",
  "before", "after", "then", "because", "since", "about", "from", "of", "is",
  "are", "was", "were", "will", "would", "can", "could", "should",
]);

/**
 * Search terms for the places this message names, or [] when it names none.
 *
 * A known region returns its canonical name plus every alias, so one question
 * reaches notes written in any of them. Short aliases ("sf") are matched as whole
 * words downstream — see buildMemorySearchSql — because "%sf%" also matches
 * "transfer".
 */
export function peopleHintTerms(message) {
  const m = String(message || "").trim();
  if (m.length < 8) return [];

  const region = regionForQuery(m);
  if (region) {
    const out = [region.name, ...region.aliases]
      .map((t) => String(t).trim())
      .filter(Boolean);
    // "washington dc" is stored in REGIONS with padding spaces on one alias.
    return [...new Set(out.map((t) => t.trim()))];
  }

  // Not a region we know. Take the noun phrase the sentence points at, if there is
  // a clean one — this is what catches a neighborhood.
  const hit = PREPOSITION.exec(m);
  if (!hit) return [];
  const phrase = hit[1].trim().toLowerCase().replace(/[.,!?;:]+$/, "");
  const all = phrase.split(/\s+/).filter(Boolean);
  const stop = all.findIndex((w) => PHRASE_END.has(w));
  const words = stop === -1 ? all : all.slice(0, stop);
  if (words.length === 0) return [];
  if (NOT_A_PLACE.has(words[0])) return [];
  // Two characters is not a place name worth searching an entire memory for.
  const place = words.join(" ");
  if (place.length < 4) return [];

  return [place];
}

/**
 * IS THE USER ASKING, OR TELLING?
 *
 * Ambient people-recall answers a question -- "who do I know in Austin" deserves
 * cards for people in Austin. An anecdote is the opposite act: the user is
 * putting information IN, and the only people who belong on screen are the ones
 * they named. Surfacing "others connected to this" there reads as the app
 * inventing participants, which is exactly what it looked like.
 *
 * A question mark, an opening interrogative, or a request verb -- "help me plan
 * a dinner in Williamsburg" is asking, even without the question mark, and the
 * people you know there are the answer to it.
 *
 * It does NOT try to judge the place itself. Requiring a capitalised proper noun
 * looked tempting ("in the development side" is not a place) but people type and
 * dictate in lower case constantly, and it broke williamsburg, fort greene and
 * park slope in the existing tests. Asking-versus-telling is the honest signal;
 * the phrase rules below stay as they were.
 */
const INTERROGATIVE =
  /^\s*(who|what|where|when|which|how|why|do|does|did|can|could|should|would|is|are|was|were|any|anyone|remind|find|show|list|tell me|help|plan|planning|suggest|recommend|looking for|lets|let's)\b/i;

export function looksLikeAQuestion(message) {
  const m = String(message || "").trim();
  if (!m) return false;
  if (m.includes("?")) return true;
  return INTERROGATIVE.test(m);
}

/**
 * Should this turn go looking for people at all?
 *
 * Only when the message names somewhere. A turn with no place in it has nothing
 * to search on, and guessing a topic instead produces confident wrong cards.
 */
export function wantsPeopleHint(message) {
  return peopleHintTerms(message).length > 0;
}
