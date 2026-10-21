/**
 * PLACE CARDS — restaurants and venues, as structured cards rather than a list of
 * names in prose.
 *
 * "Planning dinner in Williamsburg, thinking Asian" should come back as three
 * tappable cards, not a paragraph. This finds candidates on the web (Exa) and asks a
 * cheap model to structure them.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT RETURN: RATINGS AND HOURS ────────────────
 *
 * Not caution — three specific reasons:
 *
 *   1. Star ratings on Yelp and Google are RENDERED, not written. The number comes
 *      from JavaScript against their own API, so scraped page text usually does not
 *      contain it. Ask a model to "extract the rating" from text that has none and
 *      the honest answer is null; what you frequently get is a plausible number.
 *      Numbers are the worst thing to invent, because they look authoritative and
 *      nobody double-checks a 4.1.
 *   2. Hours are worse. "Open until 9PM" is only true relative to the day it was
 *      fetched, and there is no reliable fetch date here. A card claiming a place is
 *      open on a day it is closed is worse than a card that says nothing.
 *   3. Google and Yelp both prohibit redisplaying their ratings. The Places API
 *      exists to make that legal, and that is the intended upgrade path.
 *
 * The card shape below already HAS `rating`, `reviewCount` and `hours` fields. They
 * are always null today and the client renders them only when present, so wiring the
 * Places API later fills them in with no change to the schema, the event, or the UI.
 *
 * Everything this DOES return is descriptive text that genuinely sits in page copy:
 * name, category, neighborhood, address, and the place's own URL for the tap-through.
 */

import { exaSearch } from "./exa-search.js";

const MODEL = process.env.PLACE_EXTRACT_MODEL || "claude-haiku-4-5-20251001";
const ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = Number(process.env.PLACE_EXTRACT_TIMEOUT_MS) || 12000;

/** Does this message want places? Deliberately narrow: a false positive spends a web
 *  search and a model call on a note that had nothing to do with going out. */
// ANY KIND OF PLACE, NOT JUST DINNER.
//
// This started as a restaurant list, which meant "where can I work from in
// Brooklyn" or "find me a library near Stanford" got a paragraph of prose and no
// cards, for no reason other than the noun. A place is a place: it has a name, a
// neighborhood, and a website you can open.
//
// Split in two because the two halves want different gates. Somewhere you GO OUT
// to needs an intent to plan it (see PLANNING_VERB) — "dinner" on its own is a
// memory as often as a plan. Somewhere you LOOK UP does not: nobody says "library"
// reminiscing.
const OUTING_NOUN =
  /\b(dinner|lunch|brunch|breakfast|drinks|coffee|bar|pub|restaurant|eatery|eat|eating|food|cuisine|reservation|reserve|table|venue|place to eat|nightcap|cocktails)\b/i;

const PLACE_NOUN = new RegExp(
  // Singulars only — the (?:e?s)? below covers the plural, which is how "museums"
  // and "event spaces" were being missed by an alternation written in the singular
  // with a word boundary welded to the end of it.
  "\\b(?:" +
    [
      "librar(?:y|ies)",
      "coworking", "co-working", "work ?space", "makerspace", "meeting room",
      "conference room", "event space", "office", "headquarters", "hq", "campus",
      "museum", "galler(?:y|ies)", "park", "gym", "climbing", "studio",
      "clinic", "hospital", "pharmacy", "hotel", "hostel", "cafe", "caf\u00e9",
      "bakery", "bookshop", "bookstore", "market", "theat(?:re|er)", "cinema",
      "stadium", "arena", "spa", "salon", "barber", "laundromat", "storage",
      "church", "temple", "mosque", "synagogue", "school", "university",
      "college", "lab",
      // Not a noun, but the same ask: "where can I work from in Brooklyn".
      "work (?:from|out of|remotely)",
    ].join("|") +
    ")(?:e?s)?\\b",
  "i",
);

/** Something you can look up whether or not you are "planning" anything. */
const LOOKUP_VERB =
  /\b(where|find|nearest|near me|near by|nearby|looking for|look up|recommend|suggest|any good|best|show me|know of|is there|list)\b/i;
// The second half of the gate: the outing word has to sit next to something that
// says a DECISION IS STILL OPEN. "Brunch" on its own is a memory as often as it is
// a plan.
//
// "want to" is deliberately NOT here on its own — "I want to remember that Priya
// loves Thai food" is a note, not a dinner — so it only counts when followed by a
// verb of going somewhere.
const PLANNING_VERB =
  /\b(plan|planning|thinking of|thinking about|looking for|where should|where can|where do|any recommendations|recommend|suggest|find|book|reserve|organi[sz]e|throwing|hosting|let'?s|somewhere|we should|should we|wanna|want to (?:get|grab|go|do|try|eat|hit|check out)|going to grab|in the mood for|up for|figure out where|pick a)\b/i;

// A MESSAGE ANCHORED IN THE PAST IS A LOG, NOT A PLAN, and this is the veto.
//
// It exists because the two readings share every other word. "Dinner with Priya in
// Williamsburg" is a plan; "dinner with Priya in Williamsburg last night" is
// something to remember, and searching the web for restaurants in response to it
// would be both useless and, on a voice note, actively confusing — the user is
// telling Amber about their life, not asking it to book anything.
//
// The explicit "remember that" / "note that" forms are vetoed for the same reason:
// they are instructions to store a fact, and a fact about food is still a fact.
const LOG_VETO =
  /\b(yesterday|last night|last week|last weekend|last month|this morning|earlier today|the other (?:day|night)|\d+\s+(?:days?|weeks?|months?|years?)\s+ago|ago|remember that|note that|keep in mind)\b/i;

/**
 * A VENUE THE USER ALREADY NAMED.
 *
 * The gate above asks "is this person trying to CHOOSE somewhere" — which is the
 * right question when they have not decided. It is the wrong question when they
 * have: "I'm supposed to be going to Mala Chinese Cuisine" names the place
 * outright, and got nothing back, because none of the planning verbs fit a plan
 * that is already made.
 *
 * That is the more useful case, not the lesser one. Someone who has named the
 * restaurant wants to know about THAT restaurant — where it is, what it is
 * known for, how to reach it — not three alternatives to it.
 *
 * The pattern is a going-there preposition followed by a proper noun of one to
 * four capitalised words. Deliberately narrow:
 *
 *   - It must follow one of the prepositions. A bare capitalised phrase is a
 *     person far more often than a venue, and "Meet and AJ" must never be
 *     searched for as a restaurant.
 *   - The capitals do the rest of the work. Voice transcription capitalises
 *     proper nouns and almost nothing else, so this rides on a signal the
 *     transcriber is already good at.
 *   - Sentence-leading words are dropped (see below): "At Mala" at the start of
 *     a sentence is indistinguishable from "At" being capitalised because a
 *     sentence began.
 */
// A bare "to" is NOT in here, and that is the whole difference between this
// matching a venue and it matching everyone the user has ever spoken to.
// "Grabbing dinner, talked to Sagar about it" has an outing noun and a
// capitalised proper noun after a preposition, and Sagar is a person.
const VENUE_AFTER =
  /\b(going to|go to|headed to|heading to|reservation at|table at|dinner at|lunch at|drinks at|coffee at|eating at|check(?:ing)? out|at)\s+((?:[A-Z][\w'&.-]*)(?:\s+(?:[A-Z][\w'&.-]*|of|and|the|de|la|le|du))*)/g;

// Prepositions that can only be followed by somewhere, never by someone. After
// one of these a SINGLE capitalised word is trustworthy ("dinner at Lilia");
// after the looser ones it takes at least two ("going to Mala Chinese Cuisine"),
// because "going to Sagar" is a sentence people say.

// Words that are capitalised for a reason other than being a name, and common
// enough after these prepositions to matter. A venue called "I" or "The" is not
// a risk worth keeping the false positives for.
const NOT_A_VENUE = new Set([
  "i", "i'm", "im", "the", "a", "an", "he", "she", "they", "we", "you", "it",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "today", "tomorrow", "tonight", "yesterday", "next", "last", "this",
]);

const VENUE_ONLY_PREP = /^(?:reservation at|table at|dinner at|lunch at|drinks at|coffee at|eating at|at)$/;

/**
 * The venue named in this message, or null.
 *
 * Longest match wins: "Mala Chinese Cuisine" beats "Mala", and the longer form
 * is the one worth searching for.
 */
export function venueNameIn(message) {
  const m = String(message || "");
  if (!m) return null;
  // A DESTINATION IS NOT A VENUE. "I'm traveling to San Francisco to fundraise"
  // matches the preposition-plus-proper-noun shape perfectly and has nothing to
  // do with going anywhere in particular; so does "moving to Brooklyn". The
  // message has to be ABOUT the kind of place you walk into before a capitalised
  // phrase in it is allowed to be one.
  if (!OUTING_NOUN.test(m) && !PLACE_NOUN.test(m)) return null;
  let best = null;
  for (const match of m.matchAll(VENUE_AFTER)) {
    const raw = String(match[2] || "").trim().replace(/[.,;:!?]+$/, "");
    if (!raw) continue;
    const words = raw.split(/\s+/);
    if (words.length > 4) continue;
    // A single word that is only capitalised because it starts a sentence, or
    // that is a weekday or a pronoun, is not a venue.
    if (NOT_A_VENUE.has(words[0].toLowerCase())) continue;
    const prep = String(match[1] || "").toLowerCase();
    if (words.length === 1 && !VENUE_ONLY_PREP.test(prep)) continue;
    if (!best || raw.length > best.length) best = raw;
  }
  return best;
}

export function wantsPlaces(message) {
  const m = String(message || "");
  if (!m || m.length < 8) return false;
  if (LOG_VETO.test(m)) return false;
  // THE PLACE IS ALREADY DECIDED. No planning verb will appear, and none is
  // needed — the user named it.
  if (venueNameIn(m)) return true;
  // Going out: still needs the plan, because the noun alone is ambiguous.
  if (OUTING_NOUN.test(m) && PLANNING_VERB.test(m)) return true;
  // Looking something up: the noun plus any asking word is enough.
  if (PLACE_NOUN.test(m) && (LOOKUP_VERB.test(m) || PLANNING_VERB.test(m))) return true;
  return false;
}

/**
 * What to actually search the web for.
 *
 * The query used to have "restaurants" welded onto it, so a question about
 * libraries went to Exa asking for restaurants and came back with restaurants.
 * The kind of place comes from the question now.
 */
export function placeQueryFor(message) {
  const m = String(message || "");
  // A NAMED VENUE IS A LOOKUP, NOT A SEARCH. Handing the whole sentence to Exa
  // for "I'm going to Mala Chinese Cuisine with Meet and AJ" returns Sichuan
  // restaurants in general — everything except the one that was asked about.
  const venue = venueNameIn(m);
  if (venue) return `${venue} restaurant — address, neighborhood, what it is known for, official website`;
  const kind = OUTING_NOUN.test(m) && !PLACE_NOUN.test(m) ? "restaurants" : "places";
  return `${m} \u2014 ${kind}, addresses, neighborhood and official website`;
}

const EXTRACT_SYSTEM = [
  "You turn web search results into place cards. Return ONLY a JSON array, no prose.",
  "",
  "Each element:",
  '  {"name": "...", "category": "...", "neighborhood": "...", "address": "...",',
  '   "url": "..."}',
  "",
  "A PLACE IS ANY PLACE. A restaurant, a library, a coworking floor, a museum, a",
  "climbing gym, a company's office. Whatever the question asked for, that is what",
  "these cards are.",
  "",
  "RULES:",
  "- category: two or three words for WHAT IT IS, in the question's own terms.",
  '  "Thai", "Public library", "Coworking", "Modern art museum", "Head office".',
  "  This is the line under the name, so make it the thing a person would want to",
  "  know first about that kind of place.",
  "- name: the venue's own name. Never a listicle title (\"12 Best Asian Spots\") —",
  "  those are articles, not venues. Skip them entirely.",
  "- neighborhood: the named area if the text states one (\"Williamsburg\").",
  "- address: only if a street address literally appears in the text. Else null.",
  "- url: prefer the venue's OWN site. Never a Yelp, Google, TripAdvisor, Reddit,",
  "  Instagram or news-article URL — the card links a user to the place itself, not",
  "  to a review aggregator. If the only URL available is an aggregator, url is null.",
  "- NO DESCRIPTION FIELD, and this is deliberate. It used to ask for one and got",
  '  "Prospect Park -- park with a museum and walking paths" and "Equinox -- gym',
  '  where the person plans to work out": a sentence restating the category, which',
  "  is worse than silence. It cost two lines on every card and made the whole",
  "  answer read as generated. What a card owes the reader is WHICH one and WHERE.",
  "- SO GET THE ADDRESS RIGHT INSTEAD. A chain with no street address is a card",
  "  that cannot say which of fourteen branches it means, and the app has to ask",
  "  the user. Spend the effort there: if the text names the street for a branch,",
  "  that is the single most valuable field on the card.",
  "- NEVER output a rating, a star count, a review count, a price level or opening",
  "  hours, even if the text appears to contain them. Those fields do not exist in",
  "  this schema and inventing them is the specific failure this prompt exists to",
  "  prevent.",
  "- Omit anything you cannot ground in the provided text. Fewer, correct cards beat",
  "  more, guessed ones. An empty array is a valid answer.",
  "- At most 4 elements.",
].join("\n");

function sanitizeUrl(u) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  // Aggregators are filtered here as well as in the prompt: the card's whole
  // interaction is "take me to the restaurant", and a model will occasionally
  // return a Yelp link anyway.
  if (/(^|\.)(yelp|tripadvisor|opentable|resy|google|maps\.google|reddit|instagram|facebook|twitter|x)\.com/i.test(s)) {
    return null;
  }
  return s.slice(0, 500);
}

function clean(v, max = 120) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "n/a") return null;
  return s.slice(0, max);
}

/**
 * @returns {Promise<{name:string, category:string|null, cuisine:string|null, neighborhood:string|null,
 *   address:string|null, url:string|null, blurb:string|null,
 *   rating:null, reviewCount:null, hours:null}[]>}
 */
export async function findPlaces(message, { limit = 3 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !message) return [];

  const results = await exaSearch({
    query: placeQueryFor(message),
    numResults: 8,
    maxCharacters: 1200,
  }).catch(() => []);
  if (!Array.isArray(results) || results.length === 0) return [];

  const corpus = results
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.text || ""}`)
    .join("\n\n")
    .slice(0, 12000);

  let raw = "";
  try {
    const resp = await fetch(ANTHRO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0,
        system: EXTRACT_SYSTEM,
        messages: [
          { role: "user", content: `Request: "${message}"\n\nSearch results:\n${corpus}\n\nJSON array:` },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.error(`PLACE_EXTRACT_HTTP status=${resp.status}`);
      return [];
    }
    const data = await resp.json();
    raw = data?.content?.[0]?.text?.trim() || "";
  } catch (e) {
    console.error(`PLACE_EXTRACT_ERR ${e?.name === "TimeoutError" ? "timeout" : e?.message || e}`);
    return [];
  }

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    console.error("PLACE_EXTRACT_PARSE_ERR");
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out = [];
  const seen = new Set();
  for (const p of parsed) {
    const name = clean(p?.name, 80);
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      name,
      // `category` is what the model is asked for now; `cuisine` is kept as the
      // fallback so a client on an older bundle still has something to render, and
      // so a model that answers with the old key is not silently dropped.
      category: clean(p?.category, 40) ?? clean(p?.cuisine, 40),
      cuisine: clean(p?.cuisine, 40) ?? clean(p?.category, 40),
      neighborhood: clean(p?.neighborhood, 60),
      address: clean(p?.address, 160),
      url: sanitizeUrl(p?.url),
      // Kept on the row for the one line that might genuinely earn it back (a
      // chef, a closure, "no walk-ins"), and no longer asked for or rendered.
      blurb: clean(p?.blurb, 180),
      // Reserved for the Places API. Always null here — see the header.
      rating: null,
      reviewCount: null,
      hours: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
