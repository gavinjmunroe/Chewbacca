/**
 * TAG THE PEOPLE IN A NOTE BEFORE ANY MODEL RUNS.
 *
 * The "filed to" chips used to wait on extractContactSignal — a Sonnet call with a 30
 * second ceiling that reads the note and decides what each mention MEANS. That work
 * is worth waiting for. Being told that "fundraising in SF with Sagar" is about Sagar
 * is not: the user's own address book answers that in about a millisecond.
 *
 * LOOK UP CONTACTS IN THE TEXT, NOT NAMES IN THE TEXT. Extracting "the names" from
 * prose is named-entity recognition and it is hard. Turning it around removes the
 * problem: we already know the only names that matter, because they are the user's
 * contacts. A name that is not in the address book is not something this pass can
 * tag anyway.
 *
 * ── THE HARD PART: NAMES THAT ARE ALSO WORDS ──────────────────────────────────
 *
 * "Will you send it in May?" and "Will is meeting May on Friday" are the same two
 * capitalised words. The first mentions nobody. A stoplist cannot tell them apart —
 * it can only refuse both, which means a contact called Will never gets tagged, and
 * that is not a feature, it is a hole with a comment on it.
 *
 * The difference is GRAMMATICAL, and grammar is decidable here without a model,
 * because we are not parsing the sentence — we only need to know whether ONE token is
 * being used as a person. Two cheap signals do it:
 *
 *   WORD CUES, checked first and disqualifying:
 *     a determiner in front       "the will", "a grant", "my art"
 *     "of" after                  "grant of", "mark of"
 *     modal + pronoun             "Will you", "May I", "Can we"
 *     month context               "in May", "May 5th"
 *     past-tense verb after a subject   "he rose", "prices rose"
 *
 *   PERSON CUES, required for an ambiguous name to count:
 *     a person-directing word in front   "with Will", "saw Will", "and Will"
 *     a verb of speech or being after    "Will said", "Will is", "Will's"
 *     list punctuation after             "Mark, Sam and Priya"
 *
 * An unambiguous name (Sagar, Priya) needs none of this — capitalisation is enough.
 * An ambiguous one needs positive evidence, so "modern Art" is correctly ignored
 * while "Art is in SF" is correctly tagged.
 *
 * WHAT IT STILL REFUSES: two contacts sharing a first name. That is not a grammar
 * problem, it is a genuine ambiguity about WHICH person, and the disambiguation flow
 * exists to ask. Speed must not buy a wrong chip.
 */

import { isTaggablePerson } from "./people-rank-realness.js";

/** First names that are also ordinary English words, months, or days. Being on this
 *  list does not disqualify a name — it only means the name must EARN it from
 *  context, via the cues below. */
const AMBIGUOUS_FIRST_NAMES = new Set([
  "will", "may", "grant", "art", "mark", "bill", "rose", "hope", "faith", "joy",
  "june", "july", "april", "august", "summer", "sunny", "dawn", "sky", "river",
  "chase", "drew", "frank", "gene", "rich", "sue", "van", "guy", "earl", "duke",
  "ray", "dean", "wade", "reed", "cliff", "dale", "glen", "lane", "penny", "ruby",
  "sunday", "monday", "tuesday", "friday", "amber", "jack", "max", "buck", "hunter",
  "miles", "field", "brook", "forest", "stone", "wolf", "king", "prince", "noble",
  "justice", "melody", "harmony", "angel", "christian", "olive", "sage", "clay",
]);

/** In front of a name, these point at a person. */
const PERSON_BEFORE = new Set([
  "with", "to", "from", "for", "and", "about", "saw", "met", "meeting", "told",
  "asked", "called", "texted", "emailed", "messaged", "invite", "invited", "inviting",
  "introduce", "intro", "connect", "cc", "plus", "alongside", "friend", "colleague",
  "boss", "partner", "cofounder", "co-founder", "brother", "sister", "mom", "dad",
  "wife", "husband", "than", "vs", "versus", "between", "including", "featuring",
  "thanks", "thank", "ping", "pinged", "spoke", "speaking", "talked", "talking",
  "seeing", "visiting", "joined", "joining", "hired", "hiring", "know", "knows",
  "ask", "tell", "text", "email", "message", "call", "loop", "looping", "add",
  "adding", "bring", "bringing", "copy", "copying", "reach", "met", "meet",
]);

/** After a name, these are things a person does or is. */
const PERSON_AFTER = new Set([
  "is", "was", "are", "were", "said", "says", "told", "called", "texted", "emailed",
  "mentioned", "thinks", "thought", "wants", "wanted", "works", "worked", "lives",
  "lived", "has", "had", "have", "will", "would", "can", "could", "should", "might",
  "just", "also", "already", "and", "or", "who", "seems", "seemed", "asked", "sent",
  "joined", "left", "moved", "started", "runs", "leads", "owns", "knows", "likes",
  "loves", "hates", "needs", "met", "wrote", "built", "made",
  // Affiliation, which follows a person far more often than it follows a common
  // noun: "Will from Sequoia", "Art at Benchmark". Deliberately NOT "in" — "in May"
  // is a month and that collision is the whole reason this file exists.
  "from", "at",
]);

const DETERMINERS = new Set([
  "the", "a", "an", "my", "your", "his", "her", "its", "our", "their", "this",
  "that", "these", "those", "some", "any", "no", "every", "each", "another",
]);

/** Particles that can sit between a verb and the person it acts on. */
const PARTICLES = new Set(["in", "on", "up", "over", "along", "into", "back"]);

const PRONOUNS = new Set([
  "i", "you", "we", "they", "he", "she", "it", "there", "who", "u",
]);

/** Words that are modals when followed by a pronoun: "Will you", "May I". */
const MODALS = new Set(["will", "may", "might", "can", "must", "shall", "should"]);

/** Month names, for "in May" / "May 5th". */
const MONTHS = new Set(["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"]);

/** Prepositions that put a month, not a person, after them. */
const DATE_BEFORE = new Set(["in", "by", "since", "until", "till", "before", "after",
  "during", "of", "on", "through", "around", "early", "late", "mid"]);

/** Past-tense verb forms that share a spelling with a name. */
const PAST_TENSE_NAMES = new Set(["rose", "drew", "grant", "mark", "will", "chase",
  "wade", "reed", "bill", "hope", "sue", "field", "stone", "king", "clay"]);

function norm(v) {
  return String(v || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Token, plus whether it was capitalised and what sat either side of it. */
function tokenize(text) {
  const out = [];
  const re = /[\p{L}\p{N}'’-]+|[.,;:!?]/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (/^[.,;:!?]$/.test(raw)) {
      out.push({ raw, punct: true, key: raw, cap: false });
      continue;
    }
    const first = raw[0];
    out.push({
      raw,
      punct: false,
      key: norm(raw).replace(/['’]s$/u, ""),
      keyRaw: norm(raw),
      possessive: /['’]s$/u.test(raw),
      cap: !!first && first === first.toUpperCase() && first !== first.toLowerCase(),
    });
  }
  return out;
}

/**
 * Is the token at `i` being used as a person's name?
 * @returns {'person'|'word'|'unknown'}
 */
function readContext(tokens, i) {
  const tok = tokens[i];
  const word = tok.key;

  // Walk back and forward past punctuation to the nearest real words, but remember
  // whether punctuation sat immediately next to the token — a following comma is
  // itself a list cue.
  let p = i - 1;
  while (p >= 0 && tokens[p].punct) p -= 1;
  const prev = p >= 0 ? tokens[p].key : null;
  const prevIsSentenceEnd = i > 0 && tokens[i - 1].punct && /[.!?]/.test(tokens[i - 1].raw);
  const startsSentence = i === 0 || prevIsSentenceEnd;

  const nextImmediate = i + 1 < tokens.length ? tokens[i + 1] : null;
  let n = i + 1;
  while (n < tokens.length && tokens[n].punct) n += 1;
  const next = n < tokens.length ? tokens[n].key : null;

  // A POSSESSIVE IS DECISIVE, and it is read before every word cue. Nothing but a
  // person (or an organisation) owns something, so "Will's deck" is Will regardless
  // of what follows. This used to sit below, and the sentence-initial modal rule
  // below reached it first and called it an auxiliary — "Will's deck was good"
  // tagged nobody, because "deck" is not in the list of things a person does.
  if (tok.possessive) return "person";

  // ── WORD CUES. Any one of these and it is not a person. ────────────────────
  if (prev && DETERMINERS.has(prev)) return "word";
  if (next === "of") return "word";
  // "Will you", "May I" — a modal followed by a pronoun is an auxiliary, and this is
  // the single most common false positive in ordinary speech.
  if (MODALS.has(word) && next && PRONOUNS.has(next)) return "word";
  // DELIBERATELY NOT: "a modal opening a sentence is a question". That rule read
  // anything a modal-shaped name did at the start of a sentence as an auxiliary
  // unless the next word happened to be on the person-verb list, which is a
  // whitelist and therefore always incomplete — "Will's deck", "Will texted me
  // back", "Will from Sequoia". The pronoun rule above already catches the real
  // auxiliary ("Will you", "May I"), and a sentence-initial name with no other
  // signal falls through to `unknown`, which for an ambiguous word means refused.
  // Refusing is the correct outcome there; misclassifying is not.
  // "in May", "May 5th", "May 2026".
  if (MONTHS.has(word)) {
    if (prev && DATE_BEFORE.has(prev)) return "word";
    if (next && /^\d/.test(next)) return "word";
  }
  // "he rose", "prices rose" — a past-tense form after a subject.
  if (PAST_TENSE_NAMES.has(word) && prev && (PRONOUNS.has(prev) || DETERMINERS.has(prev))) {
    return "word";
  }

  // A particle can sit between the verb and the name: "looping in Grant", "bring on
  // Sam", "cc in Priya". Read one token further back before giving up.
  let prevPrev = null;
  if (prev && PARTICLES.has(prev)) {
    let q = p - 1;
    while (q >= 0 && tokens[q].punct) q -= 1;
    prevPrev = q >= 0 ? tokens[q].key : null;
  }

  // ── PERSON CUES. ───────────────────────────────────────────────────────────
  if (tok.possessive) return "person";                    // "Priya's idea"
  if (prev && PERSON_BEFORE.has(prev)) return "person";   // "with Will", "saw Will"
  if (prevPrev && PERSON_BEFORE.has(prevPrev)) return "person"; // "looping in Grant"
  if (next && PERSON_AFTER.has(next)) return "person";    // "Will said", "Art is"
  // "Mark, Sam and Priya" — a name in a list.
  if (nextImmediate && nextImmediate.punct && nextImmediate.raw === ",") return "person";

  return "unknown";
}

/**
 * @param {string} text
 * @param {{id: string|number, name: string}[]} contacts
 * @param {{ max?: number }} [opts]
 * @returns {{ contactId: string, name: string, score: number }[]}
 */
export function fastTagPeople(text, rawContacts, { max = 8 } = {}) {
  const src = String(text || "");
  if (!src || !Array.isArray(rawContacts) || rawContacts.length === 0) return [];

  // ORGANISATIONS AND AUTOMATION ARE DROPPED BEFORE ANY MATCHING HAPPENS.
  //
  // "Help me plan a dinner in the Bay Area. It has great Indian food" produced a
  // contact card for "IT Self service Desk", because the sentence contains the
  // capitalised token "It" and that contact's first token is "IT". A pure string
  // equality, but the result on screen is a suggestion to have dinner with a help
  // desk. A note mentioning USC did the same with "USC Graduate School".
  //
  // Filtering here rather than at the end means an org can never displace a real
  // person from the `max` slots either.
  const contacts = rawContacts.filter((c) => isTaggablePerson(c));
  if (contacts.length === 0) return [];

  const tokens = tokenize(src);
  if (tokens.length === 0) return [];

  // Every token position each word appears at, so context can be read per occurrence
  // — "Will you ask Will?" has one of each.
  const positions = new Map();
  const present = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.punct || !t.key) continue;
    present.add(t.key);
    if (!positions.has(t.key)) positions.set(t.key, []);
    positions.get(t.key).push(i);
  }

  // Ambiguity is a property of the ADDRESS BOOK, not of the matches: two Sams means
  // the bare word "Sam" is ambiguous however the note is phrased.
  //
  // COUNTED OVER DISTINCT FULL NAMES, NOT ROWS. A real address book is full of the
  // same person entered twice — this one has "Samy" listed twice verbatim — and
  // counting rows made every duplicated person look like an ambiguity about WHICH
  // person, so they were silently never tagged. Two rows both reading "Sagar
  // Tiwari" are one Sagar; "Sam Movish" and "Sam Zastrow" are two Sams and still
  // suppress, which is the case the disambiguation flow exists for.
  //
  // What this does NOT collapse: a "Sagar Tiwari" row alongside a bare "Sagar"
  // row. Those are distinct names, and a first-name-only entry genuinely might be
  // someone else, so that still counts as two and still asks.
  const namesByFirst = new Map();
  for (const c of contacts) {
    const full = norm(c?.name);
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    if (!first) continue;
    let set = namesByFirst.get(first);
    if (!set) { set = new Set(); namesByFirst.set(first, set); }
    set.add(full);
  }
  const distinctNamed = (first) => namesByFirst.get(first)?.size ?? 0;

  // KEYED BY NORMALIZED FULL NAME, not contact id. Two rows for the same person
  // would otherwise render as two identical cards side by side. Distinct people
  // have distinct full names, so nothing real collapses; on a tie the lower id
  // wins so the choice does not depend on row order.
  const best = new Map();
  const keep = (full, entry) => {
    const prev = best.get(full);
    if (prev && !(entry.score > prev.score)) {
      const a = Number(entry.contactId);
      const b = Number(prev.contactId);
      if (!(Number.isFinite(a) && Number.isFinite(b) && a < b)) return;
    }
    best.set(full, entry);
  };
  for (const c of contacts) {
    const full = norm(c?.name);
    if (!full) continue;
    const parts = full.split(/\s+/).filter(Boolean);
    const first = parts[0];
    if (!first) continue;

    // Full name said in full: the least ambiguous thing there is, and no context
    // reading is needed or wanted.
    if (parts.length > 1 && parts.every((pt) => present.has(pt))) {
      keep(full, { contactId: String(c.id), name: c.name, score: 1 });
      continue;
    }

    const at = positions.get(first);
    if (!at) continue;
    // A lower-case occurrence is not a name.
    const capAt = at.filter((i) => tokens[i].cap);
    if (capAt.length === 0) continue;

    // A FUNCTION WORD IS NEVER A NAME ON ITS OWN. "It", "There", "We", "May" and
    // "This" appear capitalised at the start of ordinary sentences constantly, and
    // a contact whose first token happens to be one of them would match every time.
    // Such a contact can still be tagged — but only when the sentence contains
    // every word of their name, which is not something an idiom does by accident.
    if (PRONOUNS.has(first) || DETERMINERS.has(first)) continue;

    const ambiguousWord = AMBIGUOUS_FIRST_NAMES.has(first);
    // Read every capitalised occurrence; one clear person reading is enough.
    let verdict = "unknown";
    for (const i of capAt) {
      const r = readContext(tokens, i);
      if (r === "person") { verdict = "person"; break; }
      if (r === "word" && verdict === "unknown") verdict = "word";
    }
    if (verdict === "word") continue;
    // An ordinary-word name must EARN it. A distinctive name does not have to.
    if (ambiguousWord && verdict !== "person") continue;

    // Two DIFFERENT people answer to this first name — a real ambiguity about which
    // one, which the disambiguation flow asks about rather than this pass guessing.
    if (distinctNamed(first) > 1) continue;

    keep(full, { contactId: String(c.id), name: c.name, score: 0.85 });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max);
}
