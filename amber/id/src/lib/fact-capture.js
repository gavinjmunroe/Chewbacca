/**
 * Shared fact-capture engine — used by both iMessage (photon-webhook.js) and
 * app chat (/v1/chat). Extracted from photon-webhook.js; zero behavior change.
 *
 * Exports:
 *   extractContactFact({ message })           → {name, fact, category} | {fact:null}
 *   resolveContactByName(name, contacts)       → {status, contactId, matchedName, candidates}
 *   runFactCapture({ ownerId, messageText, spaceId, log }) → void (fail-safe)
 */

import {
  getContactsForResolution,
  insertContactFact,
  insertContactNote,
  insertContactExperience,
  insertUserFact,
  setUserProfileFields,
  updateContactFields,
  getContactNameMemory,
  NAME_MEMORY_TRUST_STREAK,
} from "../db/store.js";

const _ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const _HAIKU = "claude-haiku-4-5-20251001";
// The multi-signal extractor is the foundation of capture — every tag and
// reconciliation depends on it. Haiku was too erratic here (0 signals on one
// run, 6 on the next for the same kind of story), so it runs on Sonnet, the
// same reliable model the chat reply uses.
const _EXTRACT_MODEL = process.env.EXTRACT_MODEL || "claude-sonnet-4-6";
// Signal extraction runs CONCURRENTLY with the reply's token generation, so this
// ceiling costs the user nothing unless the extraction is the slower of the two.
// Overridable without a deploy if the model gets faster or a note gets denser.
const _EXTRACT_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS) || 30000;
const _FACT_CATEGORIES = new Set(["who", "feeling", "activity", "identity", "personality"]);

/**
 * Decide if a DM message contains a durable fact about a specific named person
 * in the user's life. Returns {name, fact, category} when found, {fact:null} otherwise.
 * 8s timeout, fail-safe to {fact:null} on any error.
 */
export async function extractContactFact({ message }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { fact: null };
  try {
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _HAIKU,
        max_tokens: 150,
        temperature: 0,
        system:
          `Given a user's message, decide if it contains a durable FACT about a specific ` +
          `person in their life — not the user themselves, and not a transient logistic ` +
          `(meeting time, directions, plans that may change). ` +
          `If yes, extract: the person's name exactly as written, the fact as a concise ` +
          `statement, and ONE category from this list only: ` +
          `"who" (who this person is or their relationship to the user), ` +
          `"feeling" (how the user feels about this person or how they affect the user), ` +
          `"activity" (what this person does or did — a job, hobby, event), ` +
          `"identity" (this person's background, values, or what matters to them), ` +
          `"personality" (objective personality-science or MBTI-style traits about this person). ` +
          `If no durable fact about a specific named person is present, return {"fact":null}. ` +
          `Return ONLY valid JSON: {"name":"...","fact":"...","category":"..."} or {"fact":null}.`,
        messages: [{ role: "user", content: `Message: "${message}"\nJSON:` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { fact: null };
    const raw = (await resp.json()).content?.[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const jsonStr = cleaned.startsWith("{") ? cleaned : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) || "{}";
    const parsed = JSON.parse(jsonStr);
    if (!parsed.fact || typeof parsed.fact !== "string") return { fact: null };
    return {
      name: typeof parsed.name === "string" ? parsed.name.trim() : null,
      fact: parsed.fact.trim(),
      category: _FACT_CATEGORIES.has(parsed.category) ? parsed.category : null,
    };
  } catch (e) { console.error(`PHOTON_FACT_EXTRACT_ERR ${e?.stack || e?.message || e}`); return { fact: null }; }
}

/**
 * Match a raw name string (as extracted from a message) against loaded contacts.
 * Returns {status:'resolved'|'ambiguous'|'none', contactId, matchedName, candidates, candidateObjects}.
 *
 * Builds a UNION of:
 *   - exact full_name matches (norm(full_name) === spokenName)
 *   - first-name matches (first token of full_name === spokenName, or first_name field === spokenName)
 * Deduped by id. Then:
 *   0 matches → none
 *   1 match   → resolved (single unique identification)
 *   2+ matches → ambiguous, always ask — no interaction-count auto-pick
 */
// Soundex: a compact phonetic code so same-sounding names share a key
// (AJ/Ajay → A200, Sean/Shawn → S500, Catherine/Kathryn → K365). Used to widen
// contact matching to homophones so ambiguous spoken names ask instead of
// locking onto one spelling.
function _soundex(s) {
  let str = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!str) return "";
  // Normalize common homophone spellings at the START of the name, because
  // classic Soundex keeps the first letter literally and would otherwise split
  // same-sounding spellings (Catherine/Kathryn, Sean/Cean, Phil/Fil, Jon/John).
  // This keeps the whole thing a general pronunciation model, never a per-name
  // rule.
  str = str
    .replace(/^PH/, "F")
    .replace(/^KN/, "N")
    .replace(/^GN/, "N")
    .replace(/^WR/, "R")
    .replace(/^X/, "S")
    .replace(/^Q/, "K")
    .replace(/^C(?=[EIY])/, "S")
    .replace(/^C/, "K");
  const code = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = str[0];
  let prev = code[str[0]] || 0;
  for (let i = 1; i < str.length && out.length < 4; i++) {
    const c = code[str[i]] || 0;
    if (c !== 0 && c !== prev) out += c;
    if (str[i] !== "H" && str[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

// Consonant skeleton: drop vowels and the semi-vowels H/W/Y, apply the same
// leading-homophone normalization Soundex uses, and keep the ACTUAL consonant
// letters (deduping adjacent repeats). Soundex alone is too coarse — it codes z,
// s and k all as "2", so Lizzy, Los, Luke, Luca and Lexi all collapse to L200 and
// get offered together. Comparing real consonant letters keeps the true
// homophones (Bo/Beau, Sean/Shawn, Jon/John, Liz/Lizzy) while rejecting those
// coincidental Soundex collisions.
function _consonantSkeleton(s) {
  let str = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!str) return "";
  str = str
    .replace(/^PH/, "F").replace(/^KN/, "N").replace(/^GN/, "N")
    .replace(/^WR/, "R").replace(/^X/, "S").replace(/^Q/, "K")
    .replace(/^C(?=[EIY])/, "S").replace(/^C/, "K");
  const VOWELISH = "AEIOUHWY";
  let out = "";
  for (const ch of str) {
    if (VOWELISH.includes(ch)) continue;
    if (out[out.length - 1] !== ch) out += ch;
  }
  return out;
}

// Levenshtein edit distance (iterative, O(n*m), tiny for names).
function _editDistance(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

export function resolveContactByName(name, contacts) {
  if (!name || !Array.isArray(contacts) || contacts.length === 0) {
    return { status: "none", contactId: null, matchedName: null, candidates: [] };
  }
  const nameNorm = norm(name);
  const spokenSdx = _soundex(nameNorm);

  const exactFull = contacts.filter((c) => norm(c.full_name) === nameNorm);

  // SAYING SOMEBODY'S WHOLE NAME RESOLVES TO THAT PERSON. FULL STOP.
  //
  // It did not. "Marcus O'Dell just left Sequoia to raise his own fund" filed
  // against MARCUS CASTILLO, a man imported from a SIM card and never mentioned
  // since, and the real Marcus never appeared in the candidate list at all.
  //
  // HOW. exactFull was computed and then thrown away. Everyone sharing the first
  // name joins the pool as a "nickname extension" (nameNorm.startsWith("marcus")
  // is true for every Marcus once the spoken name is a FULL name), and the final
  // ranking sorts by the distance from the WHOLE spoken name to the candidate's
  // FIRST name only. Every Marcus is therefore exactly equidistant, the
  // interaction counts are all zero on a freshly synced book, and the last
  // tiebreak is alphabetical -- so Castillo beats O'Dell, and Alvarez beats
  // everyone. The exact match had no say in its own ranking.
  //
  // Measured on a 907-contact book: of 400 contacts addressed by their own exact
  // full name, 38 came back as somebody else. One in ten. And because the caller
  // treats "ambiguous" as a soft confirm, the fact is parked against the wrong
  // person and never reaches the right card -- which is most of why notes given
  // in passing were not showing up afterwards.
  //
  // A single exact full-name match is not a guess and must not be ranked against
  // anything. Two or more means genuine duplicates of the same name, and those
  // are the only candidates worth offering -- a second Marcus with a different
  // surname is not a candidate for "Marcus O'Dell".
  if (exactFull.length === 1) {
    return {
      status: "resolved",
      contactId: exactFull[0].id,
      matchedName: exactFull[0].full_name,
      candidates: [],
      phonetic: false,
    };
  }
  if (exactFull.length > 1) {
    const ranked = [...exactFull].sort(
      (a, b) => (Number(b.interaction_count) || 0) - (Number(a.interaction_count) || 0),
    );
    return {
      status: "ambiguous",
      contactId: null,
      matchedName: null,
      bestGuessId: String(ranked[0].id),
      bestGuessName: ranked[0].full_name,
      candidates: ranked.map((c) => c.full_name),
      candidateObjects: ranked.map((c) => ({
        id: String(c.id),
        name: c.full_name,
        interactionCount: Number(c.interaction_count) || 0,
      })),
    };
  }

  const firstNameMatches = contacts.filter((c) => {
    const firstToken = norm((c.full_name || "").split(" ")[0]);
    const firstName = c.first_name ? norm(c.first_name) : null;
    return firstToken === nameNorm || (firstName !== null && firstName === nameNorm);
  });

  // Phonetic matches: names that SOUND like the spoken one (AJ ~ Ajay, Sean ~
  // Shawn, Catherine ~ Kathryn). Same-sounding first names count as candidates,
  // so a genuinely ambiguous spoken name asks instead of silently locking onto
  // the one spelling that happened to match exactly.
  const spokenSkel = _consonantSkeleton(nameNorm);
  // A candidate first name counts as phonetic if it shares the Soundex code AND
  // either (a) the consonant skeleton is identical — Bo/Beau, Sean/Shawn,
  // Catherine/Kathryn — OR (b) the spelling is within two edits — Angelica/
  // Anjelica (g→j), Maya/Mya (dropped vowel). The edit-distance arm catches
  // same-sound letters the skeleton splits (g/j, c/s), while still rejecting
  // coincidental Soundex collisions, which sit 3+ edits apart (Lizzy vs Los,
  // Luke, Luca, Lexi).
  // BOTH ARMS LOOSEN ONLY WHEN NOTHING MATCHED BY NAME.
  //
  // "Eli" against a real 974-contact book returned Eli Rossman and Eli Winter --
  // and Ella, Ellie and Elly. The two real Elis answer the question; the
  // sound-alikes pad the card with people the user never said, and the user
  // cannot tell a guess from a match because every candidate renders the same.
  //
  // The skeleton arm is what admits them, not edit distance: it strips vowels
  // AND collapses doubled letters, so ELI, ELLA, ELLIE and ELLY all reduce to
  // "L". That arm cannot distinguish them even in principle.
  //
  // So when an exact first- or full-name match already exists, phonetics narrow
  // to one-edit neighbors: Maya still finds Mya (1 edit), Eli no longer finds
  // Ella (2). With NO exact match the original behavior stands in full, which
  // is what keeps AJ -> Ajay, Bo -> Beau and Sean -> Shawn working, since those
  // only ever fire when the spoken name matched nobody outright.
  //
  // The trade is deliberate: once the correct answer is known to be in the list,
  // every extra candidate makes it harder to find, not easier.
  // A NICKNAME EXTENDS THE SPOKEN NAME. A COLLISION DOES NOT.
  //
  // "aj" and "eli" are both two edits from their unwanted neighbors -- ajay and
  // ella -- and both share a consonant skeleton with them, so neither distance
  // nor skeleton can separate the cases. What separates them is that "ajay"
  // STARTS WITH "aj" and "ella" does not start with "eli". That is what a
  // nickname is: the same name, continued.
  //
  // So once an exact first- or full-name match exists, a phonetic candidate
  // survives only if it is a one-edit neighbor (Maya/Mya) or a prefix
  // extension (AJ/Ajay). Ella, Ellie and Elly are neither and drop out.
  //
  // Getting this wrong in the strict direction is worse than leaving noise in:
  // "AJ" has an exact first-name match on a DIFFERENT person (AJ Johnson), so
  // dropping Ajay Sathappan does not merely add a bad option, it removes the
  // right one and leaves no way to pick it.
  const _hasExactName = exactFull.length > 0 || firstNameMatches.length > 0;
  const _isNicknameOf = (o) =>
    nameNorm.length >= 2 && (o.startsWith(nameNorm) || nameNorm.startsWith(o));
  const _soundsClose = (other) => {
    const o = norm(other);
    if (!o) return false;
    if (_hasExactName) return _editDistance(nameNorm, o) <= 1 || _isNicknameOf(o);
    return _consonantSkeleton(o) === spokenSkel || _editDistance(nameNorm, o) <= 2;
  };
  const phoneticMatches = spokenSdx
    ? contacts.filter((c) => {
        const firstToken = norm((c.full_name || "").split(" ")[0]);
        const firstName = c.first_name ? norm(c.first_name) : firstToken;
        const sdxHit =
          _soundex(firstToken) === spokenSdx || _soundex(firstName) === spokenSdx;
        if (!sdxHit) return false;
        return _soundsClose(firstToken) || _soundsClose(firstName);
      })
    : [];

  // Union, deduped by id — exactFull entries come first.
  const seen = new Set();
  const allCandidates = [];
  for (const c of [...exactFull, ...firstNameMatches, ...phoneticMatches]) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      allCandidates.push(c);
    }
  }

  // Rank by closeness to the spoken name so the RIGHT person is first and never
  // gets cut by the candidate cap (this is why "Mya" fell off the "Maya" list).
  //
  // TIES BROKEN BY HOW MUCH THE USER ACTUALLY TALKS ABOUT THEM. Every "Kayla" in
  // the book is spelled identically, so distance alone leaves the order to
  // whatever Postgres returned — and the first candidate is what the soft-confirm
  // below offers as its guess. interaction_count is the number of facts recorded
  // about that person; it was already being loaded for every contact and thrown
  // away here. Someone mentioned in eleven notes is a better guess than a name
  // imported from a phone book and never spoken since.
  // THE SURNAME COUNTS WHEN THE USER SAID ONE.
  //
  // This measured the spoken name against the candidate's FIRST name only, so
  // for "Marcus O'Dul" every Marcus in the book scored identically and the
  // surname the user actually said was ignored. Taking the better of the two
  // distances leaves single-token behavior untouched -- for "Marcus" the
  // first-name distance is 0 and always wins -- while a spoken surname, even a
  // misspelled one, pulls the right person to the top.
  const _distOf = (c) =>
    Math.min(
      _editDistance(nameNorm, norm(c.first_name || (c.full_name || "").split(" ")[0])),
      _editDistance(nameNorm, norm(c.full_name)),
    );
  const _knownOf = (c) => Number(c.interaction_count) || 0;
  allCandidates.sort((a, b) => _distOf(a) - _distOf(b) || _knownOf(b) - _knownOf(a));

  if (allCandidates.length === 0) {
    return { status: "none", contactId: null, matchedName: null, candidates: [] };
  }
  if (allCandidates.length === 1) {
    const only = allCandidates[0];
    const confident =
      exactFull.some((c) => c.id === only.id) || firstNameMatches.some((c) => c.id === only.id);
    // A phonetic-only hit (the transcript spelled it differently, e.g. "bow" →
    // "Bo Ledoux") is a GUESS, not a certainty — flag it so the note path
    // confirms before filing instead of silently attaching the wrong person.
    return {
      status: "resolved",
      contactId: only.id,
      matchedName: only.full_name,
      candidates: [],
      phonetic: !confident,
    };
  }
  // AMBIGUOUS, BUT NOT UNRANKED.
  //
  // This used to stop here: two candidates meant no contact, no card, and a bare
  // "who did you mean". With 973 contacts almost every ordinary first name has
  // two or more matches, so a note saying "John moved to San Francisco" resolved
  // to nobody and the tag simply never appeared. That is the whole of "why does
  // it only tag one time in five" — not randomness, a refusal to pick.
  //
  // So the list is ordered by how much the user has actually said about each
  // person. interaction_count is already loaded by getContactsForResolution and
  // was being thrown away. Someone you have recorded eleven things about is a
  // better guess for a bare first name than someone imported once and never
  // mentioned again, and the caller can now show that person's card while still
  // asking. Ties fall back to closeness of spelling, then name, so the order is
  // deterministic and does not shift between two identical notes.
  //
  // The top entry is a GUESS and is labeled as one everywhere it is used.
  // Nothing is written to a contact on the strength of it.
  // SPELLING FIRST, FAMILIARITY AS THE TIEBREAK. The count decides between people
  // who match the spoken name equally well; it must not let someone you talk about
  // constantly outrank an exact spelling. "Maya" with a much-discussed "Mya" in the
  // book still offers the two real Mayas first.
  const _count = (c) => Number(c.interaction_count) || 0;
  const ranked = [...allCandidates].sort(
    (a, b) =>
      _distOf(a) - _distOf(b) ||
      _count(b) - _count(a) ||
      String(a.full_name || "").localeCompare(String(b.full_name || "")),
  );
  const top = ranked[0];
  return {
    status: "ambiguous",
    contactId: null,
    matchedName: null,
    // The strongest candidate, so the caller can show a card while it confirms.
    bestGuessId: String(top.id),
    bestGuessName: top.full_name,
    candidates: ranked.map((c) => c.full_name),
    candidateObjects: ranked.map((c) => ({
      id: String(c.id),
      name: c.full_name,
      interactionCount: _count(c),
    })),
  };
}

/**
 * High-RECALL candidate pool for a spoken name, to feed the LLM phonetic judge.
 * Casts a wide net (exact, first-name, same Soundex, or within 3 edits) so no
 * plausible sound-alike is missed; the judge then prunes to the truly-plausible
 * cross-accent matches. Ranked by closeness, capped. Returns [{id, name}].
 */
export function phoneticPool(name, contacts, limit = 25) {
  if (!name || !Array.isArray(contacts) || contacts.length === 0) return [];
  const nameNorm = norm(name);
  const spokenSdx = _soundex(nameNorm);
  const scored = [];
  for (const c of contacts) {
    if (!c || c.id == null || !c.full_name) continue;
    const firstToken = norm((c.full_name || "").split(" ")[0]);
    const firstName = c.first_name ? norm(c.first_name) : firstToken;
    const exact =
      norm(c.full_name) === nameNorm || firstToken === nameNorm || firstName === nameNorm;
    const sdx =
      !!spokenSdx && (_soundex(firstToken) === spokenSdx || _soundex(firstName) === spokenSdx);
    const dist = Math.min(_editDistance(nameNorm, firstToken), _editDistance(nameNorm, firstName));
    if (exact || sdx || dist <= 3) {
      scored.push({ id: String(c.id), name: c.full_name, d: exact ? -1 : dist });
    }
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, limit).map(({ id, name }) => ({ id, name }));
}

const norm = (s) => (s || "").toLowerCase().trim();

// Extract the first complete {...} from a string (handles nested braces).
// Returns the substring, or null if no balanced object is found.
function _extractFirstJson(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

const _CONTACT_FIELDS  = new Set(["title", "company", "city", "phone", "email"]);
const _SELF_FIELDS     = new Set(["occupation", "currentCity", "bio"]);
const _VALID_SENTIMENTS = new Set(["positive", "negative", "neutral"]);

// Parallel to _extractFirstJson but finds the first balanced [...] array.
function _extractFirstJsonArray(s) {
  const start = s.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  // SALVAGE: the array is unterminated (model output was truncated mid-stream,
  // e.g. stop_reason=max_tokens). Rather than discarding every signal, recover
  // the COMPLETE object elements emitted so far: slice up to the last closing
  // "}" and synthesize the array terminator. Signals in this schema are flat
  // objects (no nested objects), so the last "}" is a reliable element boundary.
  // The caller's JSON.parse still guards against any residual malformation.
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace > start) return s.slice(start, lastBrace + 1) + "]";
  return null;
}

/**
 * "MY DAD" IS A PERSON. IT IS NOT ME.
 *
 * A coworker said "My dad, Karthik, Sagar, and Joel from A2F are all cool
 * people" and his dad's card never appeared. The log says why:
 *
 *   FACT_CAP_SIGNALS count=2 routes=self_fact,fact subjects=self;Sagar
 *   FACT_SELF owner=... category=personality
 *
 * "my dad" became a fact about HIM. The extractor's schema said `Use "self" for
 * the speaker (I/me/my)`, the phrase contains "my", and that was that. So the
 * app was quietly filing statements about a man's father into the man's own
 * profile -- losing the person the sentence was actually about, and corrupting
 * the one record every future prompt is built from.
 *
 * The prompt is fixed below, and this is the deterministic backstop, because a
 * model instruction is a request and this is a rule. Any subject that is a bare
 * possessive relationship term is rewritten to the relationship word itself.
 * That is also the form that RESOLVES: phone address books are full of contacts
 * saved as exactly "Dad" and "Mom", so `resolveContactByName("Dad", …)` finds a
 * real person. When it does not, the outcome is the honest "Who is Dad? Add them
 * as a new contact?" card -- which is the correct answer, and infinitely better
 * than silently writing it against the speaker.
 */
const _RELATIONSHIP_TERMS = new Set([
  "dad", "father", "daddy", "pop", "papa",
  "mom", "mother", "mum", "mommy", "mama",
  "brother", "bro", "sister", "sis", "sibling",
  "wife", "husband", "spouse", "partner",
  "girlfriend", "boyfriend", "fiance", "fiancee",
  "son", "daughter", "kid", "kids", "child",
  "grandma", "grandmother", "grandpa", "grandfather", "granddad", "nana",
  "aunt", "auntie", "uncle", "cousin", "nephew", "niece",
  "boss", "manager", "coworker", "colleague", "roommate", "housemate",
  "neighbor", "landlord", "therapist", "doctor", "dentist", "trainer",
  "coach", "teacher", "professor", "advisor", "mentor", "assistant",
  "in-law", "mother-in-law", "father-in-law", "stepdad", "stepmom",
]);

/**
 * The person a possessive relationship phrase names, or null.
 *
 * Deliberately strict: only a BARE relationship phrase is rewritten. "my dad"
 * and "our mom" become Dad and Mom; "my dad's boss" and "Sagar's brother" are
 * left alone, because who they name is a question this function cannot answer
 * and a wrong guess there is worse than no guess.
 */
export function relationshipSubject(subject) {
  const raw = String(subject || "").trim().toLowerCase().replace(/[.!?,]+$/, "");
  const bare = raw.replace(/^(?:my|our)\s+/, "");
  if (bare !== raw && bare.length === 0) return null;
  if (!_RELATIONSHIP_TERMS.has(bare)) return null;
  // "dad" on its own, with no possessive, is still the speaker's dad in every
  // sentence a person actually says ("dad called me"). Both forms resolve to
  // the same contact, so both are rewritten.
  return bare
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

// Validate and deterministically route one raw LLM signal object.
// Returns a clean { route, subjects, content, ... } or null if invalid.
export function routeSignal(raw) {
  const rawSubjects = Array.isArray(raw.subjects) ? raw.subjects : [];
  const rawTrimmed = rawSubjects.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  // Rewrite relationship phrases to the person they name BEFORE anything reads
  // the list, so "self" below can only ever mean the speaker. See the note on
  // relationshipSubject above.
  const subjects = rawTrimmed.map((s) => relationshipSubject(s) ?? s);
  if (subjects.length === 0) return null;

  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (!content) return null;

  const category          = _FACT_CATEGORIES.has(raw.category) ? raw.category : null;
  const sentiment         = _VALID_SENTIMENTS.has(raw.sentiment) ? raw.sentiment : "neutral";
  const _num01            = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? v : null);
  const sentiment_strength = _num01(raw.sentiment_strength);
  const certainty          = _num01(raw.certainty);
  const weight             = _num01(raw.weight);
  const is_past            = raw.is_past === true;
  const is_field_update    = raw.is_field_update === true;
  const is_shared_event    = raw.is_shared_event === true;
  const is_single_trait    = raw.is_single_trait === true;
  const field              = typeof raw.field  === "string" ? raw.field           : null;
  const value              = typeof raw.value  === "string" ? raw.value.trim()    : null;

  let isSelf = subjects.length === 1 && subjects[0].toLowerCase() === "self";

  // LAST BACKSTOP, for the shape that actually shipped: the model returned
  // subjects:["self"] while the content it wrote is plainly about a relative
  // ("my dad is a cool person"). Only fires when the content's own subject is a
  // relationship term at the very start of the sentence, so "I had dinner with
  // my dad" -- genuinely a shared experience, correctly self-inclusive -- is
  // untouched.
  if (isSelf) {
    const m = /^(?:the user's|my|our)\s+([a-z-]+)\b/i.exec(content);
    const who = m ? relationshipSubject(m[1]) : null;
    if (who) {
      subjects[0] = who;
      isSelf = false;
    }
  }

  // Deterministic routing — code decides; LLM's proposed_type is advisory only.
  let route;
  if (is_field_update && field && value) {
    if (!isSelf && subjects.length === 1 && _CONTACT_FIELDS.has(field)) {
      route = "contact_field";
    } else if (isSelf && _SELF_FIELDS.has(field)) {
      route = "self_field";
    } else {
      // Unrecognised field — fall through to trait/note routing.
      route = isSelf ? "self_fact" : (is_single_trait ? "fact" : "note");
    }
  } else if (is_field_update) {
    // LLM flagged a field-type change (job, city, etc.) but couldn't supply a
    // concrete value (e.g. "Mike got a new job" — employer unknown). It's still
    // a real fact about the person; routing to note would discard the signal.
    route = isSelf ? "self_fact" : "fact";
  } else if (isSelf) {
    route = "self_fact";
  } else if (is_shared_event || subjects.length >= 2) {
    route = "experience";
  } else if (subjects.length === 1) {
    // Single named non-self subject → always a fact about that person.
    // is_single_trait no longer gates this: "Joe is getting good at skiing"
    // is a fact about Joe, not a note with Joe as a participant.
    route = "fact";
  } else {
    route = "note"; // defensive fallback; prior branches eliminate all real cases
  }

  // is_conditional / condition are only meaningful on the fact route.
  const is_conditional = route === "fact" && raw.is_conditional === true;
  const condition      = route === "fact" && typeof raw.condition === "string" ? raw.condition : "";

  return {
    route,
    subjects,
    content,
    field:  (route === "contact_field" || route === "self_field") ? field : null,
    value:  (route === "contact_field" || route === "self_field") ? value : null,
    category,
    sentiment,
    sentiment_strength,
    certainty,
    is_past,
    weight,
    is_conditional,
    condition,
  };
}

const _EXTRACT_SIGNALS_SYSTEM = `You are a structured-information extractor. Read the user's message and extract EVERY distinct piece of capturable information it contains — about the user themselves and about named people in their life.

Return a JSON ARRAY. Each element is one signal. One message can produce many signals (one per person-fact, one per shared event, etc.). If there is nothing to capture, return [].

CRITICAL — IGNORE SHORT MESSAGES DIRECTED AT YOU: If the WHOLE message is a SHORT standalone question or comment addressed to the assistant (e.g. "did you log that?", "is that the right Maggie?", "what did you save?", "can you update that?", "did you get that?", "did you log that for the right person?"), it is NOT capturable information — return []. This applies ONLY to short meta-messages whose entire purpose is to ask/comment on what you did — do NOT weaken this for those. A message asking you whether/what/how you did something, or correcting/questioning a prior capture, is meta-conversation, not a fact. Return [] for it.

CRITICAL — LONG NOTES ALWAYS GET EXTRACTED (never [] because of an opening question): If the message is a longer note that names people or states facts, STRIP any leading preamble directed at the assistant ("does this work?", "testing", "can you hear me?", "are you there?", "quick note —") and extract EVERYTHING from the body as normal. A dictated memo that merely OPENS with such a question is still a real note — the opening is not meta-conversation and does NOT make the message uncapturable. NEVER return [] for a people-dense or fact-bearing message just because it begins with a question or a "testing" preamble.

CRITICAL — CAPTURE PLANS AND EVENTS, NOT JUST DURABLE FACTS: A message about people doing something together — PAST, present, OR planned/future — is an "experience" signal that lists EVERY named participant (add "self" when the speaker is included). This covers visits, trips, concerts, shows, dinners, hangouts, meetups, calls, weddings, parties. "Bo is visiting next week", "we're all going to a concert", "Spencer, Emily and I are hanging out", "Josh and I are going to LA in January" are ALL capturable experiences — extract them with every person named. A plan being tentative, casual, or in the future does NOT make it uncapturable. ALSO capture stated relationships between people as facts (e.g. "Emily is Bo's girlfriend" → a fact about Emily). NEVER return [] just because the message is casual, forward-looking, long, or rambly: if ANY real person is named in the context of a plan, event, relationship, or trait, you MUST emit a signal for it. Ignore filler and self-corrections ("Yosemite, I mean Teton") — capture the corrected version.

CRITICAL — DO NOT OVER-EXTRACT (one signal per real thing): Emit AT MOST ONE experience for a single gathering or event, listing ALL its participants once. NEVER emit several overlapping experiences for the same hangout/trip/concert. Do NOT emit a standalone fact about a person merely because they are attending an event — only emit a fact when the message states a distinct DURABLE attribute about that person (a relationship like "Emily is Bo's girlfriend", a job, a city, a trait, a feeling). Merge everything about one event into that single experience. Prefer FEWER, cleaner signals over many redundant ones.

CRITICAL — LONG, RAMBLING, SPOKEN MEMOS (dictation, back-and-forth): A transcript may ramble, self-correct, and mix real plans with throwaway asides. Follow these rules:
  • SELF-CORRECTION / BACK-AND-FORTH: when the speaker revises themselves ("circles, or actually rather family", "Yosemite, I mean Teton", "Tuesday — no, Wednesday"), keep ONLY the corrected version. NEVER emit both the wrong and the corrected form as two signals.
  • IGNORE NARRATOR ASIDES that state nothing durable about a person: "he's next to me but not saying anything", "tickets were kind of expensive but it's fine", "I'm going to figure that out", "I'm not sure what his plans are", "that's what's going on Wednesday", "if nothing else is going on". These are commentary or hedging, not facts — do NOT emit signals for them. (A price becomes capturable ONLY when it characterizes the plan itself — then fold it into that plan's experience content, e.g. "~$200 tickets" — otherwise drop it.)
  • DISTINGUISH real plans from empty musings: a concrete OR conditional plan naming a real person ("dinner with Meet and AJ Wednesday"; "maybe trivia with Spencer and his roommates if nothing else is going on" → still capture, is_conditional=true) IS capturable. Pure preference or indecision with no plan and no new fact about a person ("I don't want to go to LA, I'd rather go to San Francisco", "I have no plans for Friday") is NOT — return nothing for those spans.
  • TIE EACH PLAN TO ITS PEOPLE AND ITS DAY/TIME: put the day/time INTO the experience content — "call Caleb tomorrow morning to set context on Amber", "dinner with Meet and AJ on Wednesday", "Catan night with Ethan and Kruthi on Tuesday", "Paranormal Activity Broadway show in Hell's Kitchen on Thursday (~$200 tickets) with Lily", "figure out with Sagar whether to fly out on the 23rd or stay through the month". One experience per gathering, listing every participant (add "self" when the speaker is included).

CRITICAL — RELATIONSHIPS STATED IN PASSING: when the speaker links two people ("Lily that I met through Ryan", "my coworker Sam", "Shirley and Sagar are working on Amber", "Emily is Bo's girlfriend"), capture that connection — do NOT drop the second person just because they only appear as the connector. For an introduced-by / "met through" link, emit a fact about the FIRST person noting it: subjects:["Lily"], content:"Lily was met through Ryan", category:"who". For a stated relationship or shared-work link, emit it as a fact on the relevant person (or an experience if it is an activity they do together).

CRITICAL — "MY DAD" IS A PERSON, NOT THE SPEAKER: "self" means the speaker and ONLY the speaker. A possessive relationship phrase names a DIFFERENT HUMAN and MUST get its own subject: my dad, my mom, my father, my mother, my brother, my sister, my wife, my husband, my girlfriend, my boyfriend, my partner, my son, my daughter, my grandma, my grandpa, my aunt, my uncle, my cousin, my boss, my manager, my coworker, my roommate, my neighbor, my landlord, my therapist, my doctor, my trainer, my coach, my professor. The subject is the relationship word, capitalized, with the possessive stripped: "my dad is great" → subjects:["Dad"]. NEVER subjects:["self"] — a phone address book is full of contacts saved as exactly "Dad" and "Mom", so "Dad" resolves to a real person and "self" files a statement about a man's father into the man's own profile. Use "self" ONLY when the speaker is the subject: "I moved to Austin", "I'm exhausted", "I work at Stripe".

Each signal object MUST have ALL of these fields:
  "subjects": string[] — person names exactly as written, e.g. ["Maggie"]. Use "self" ONLY when the subject IS the speaker; a possessive relationship phrase is another person and takes the capitalized relationship word ("my dad" → "Dad"). Shared events include all participants: ["Victor","self"].
  "content": string — a clean standalone statement of this signal (no pronouns referencing the conversation).
  "proposed_type": "fact"|"note"|"experience" — fact=durable single-person trait/state; experience=event involving 2+ people together; note=other.
  "is_shared_event": boolean — true when 2+ people did something together.
  "is_single_trait": boolean — true when this is a durable attribute or preference of exactly one person.
  "is_field_update": boolean — true ONLY when setting a structured profile field. When true, also include:
    "field": "title"|"company"|"city"|"phone"|"email" for a contact, or "occupation"|"currentCity"|"bio" for self.
    "value": the field value string.
    CRITICAL JOB RULE: ANY mention of a job/role/employer change is ALWAYS is_field_update=true, is_single_trait=false — even when phrased as a past event. This includes "got promoted", "started at X", "now works at X", "joined X", "is now a [title]", "new job at X". Use field="company" for the employer, field="title" for the role; if both are given, prefer field="company" with the employer name. For self, use field="occupation".
    Examples: "got promoted at Google" → is_field_update=true, field="company", value="Google". "is now a VP" → is_field_update=true, field="title", value="VP". "Victor started at Stripe" → is_field_update=true, field="company", value="Stripe".
    Moved to / lives in a city → field="city" (contact) or "currentCity" (self). New phone → field="phone". New email → field="email".
  "category": "who"|"feeling"|"activity"|"identity"|"personality"
  "sentiment": "positive"|"negative"|"neutral"
  "sentiment_strength": number 0.0-1.0
  "certainty": number 0.0-1.0 (1.0=directly stated, lower=inferred/hedged)
  "is_past": boolean
  "weight": number 0.0-1.0 (how defining this is for the person; passing detail=low, core life fact=high)
  "is_conditional": boolean (true only if signal applies under a specific condition)
  "condition": string (the condition text, or "")

Output ONLY the JSON array. No markdown fences, no prose.

Examples:

Message: "Maggie loves Mexican food and Victor just started at Stripe"
[{"subjects":["Maggie"],"content":"Maggie loves Mexican food","proposed_type":"fact","is_shared_event":false,"is_single_trait":true,"is_field_update":false,"category":"personality","sentiment":"positive","sentiment_strength":0.7,"certainty":0.95,"is_past":false,"weight":0.5,"is_conditional":false,"condition":""},{"subjects":["Victor"],"content":"Victor started at Stripe","proposed_type":"fact","is_shared_event":false,"is_single_trait":false,"is_field_update":true,"field":"company","value":"Stripe","category":"activity","sentiment":"positive","sentiment_strength":0.6,"certainty":1.0,"is_past":false,"weight":0.8,"is_conditional":false,"condition":""}]

Message: "I moved to Austin last month"
[{"subjects":["self"],"content":"moved to Austin","proposed_type":"fact","is_shared_event":false,"is_single_trait":false,"is_field_update":true,"field":"currentCity","value":"Austin","category":"activity","sentiment":"neutral","sentiment_strength":0.0,"certainty":1.0,"is_past":true,"weight":0.8,"is_conditional":false,"condition":""}]

Message: "Victor and I got coffee — he's been stressed about his funding round"
[{"subjects":["Victor","self"],"content":"Victor and the user got coffee together","proposed_type":"experience","is_shared_event":true,"is_single_trait":false,"is_field_update":false,"category":"activity","sentiment":"positive","sentiment_strength":0.4,"certainty":1.0,"is_past":true,"weight":0.3,"is_conditional":false,"condition":""},{"subjects":["Victor"],"content":"Victor is stressed about his funding round","proposed_type":"fact","is_shared_event":false,"is_single_trait":true,"is_field_update":false,"category":"feeling","sentiment":"negative","sentiment_strength":0.7,"certainty":0.8,"is_past":false,"weight":0.6,"is_conditional":false,"condition":""}]

Message: "My dad and Sagar are both very cool people."
[{"subjects":["Dad"],"content":"Dad is a very cool person","proposed_type":"fact","is_shared_event":false,"is_single_trait":true,"is_field_update":false,"category":"personality","sentiment":"positive","sentiment_strength":0.7,"certainty":1.0,"is_past":false,"weight":0.5,"is_conditional":false,"condition":""},{"subjects":["Sagar"],"content":"Sagar is a very cool person","proposed_type":"fact","is_shared_event":false,"is_single_trait":true,"is_field_update":false,"category":"personality","sentiment":"positive","sentiment_strength":0.7,"certainty":1.0,"is_past":false,"weight":0.5,"is_conditional":false,"condition":""}]

Message: "Bo is coming to New York October 2nd for the Strokes concert. Spencer, Emily, and I are gonna hang out with him, and Muriel might come too. Emily is Bo's girlfriend."
[{"subjects":["Bo","Spencer","Emily","Muriel","self"],"content":"Bo, Spencer, Emily, Muriel and the user are planning to hang out in New York around October 2nd for the Strokes concert","proposed_type":"experience","is_shared_event":true,"is_single_trait":false,"is_field_update":false,"category":"activity","sentiment":"positive","sentiment_strength":0.6,"certainty":0.7,"is_past":false,"weight":0.4,"is_conditional":false,"condition":""},{"subjects":["Emily"],"content":"Emily is Bo's girlfriend","proposed_type":"fact","is_shared_event":false,"is_single_trait":true,"is_field_update":false,"category":"who","sentiment":"neutral","sentiment_strength":0.0,"certainty":0.9,"is_past":false,"weight":0.6,"is_conditional":false,"condition":""}]`;

// ── Long-transcript chunking + merge ──────────────────────────────────────────
// A single extraction pass over a 10-minute rambling voice memo loses people and
// blurs facts (and can overflow max_tokens). For long transcripts we split into
// overlapping chunks, extract each in parallel, then merge+dedupe. Short memos
// never hit this path — extractContactSignal is called directly, unchanged.
const _LONG_TRANSCRIPT_THRESHOLD = 1400; // chars; at/below this, single pass
const _CHUNK_TARGET   = 900;             // target chunk size (chars)
const _CHUNK_OVERLAP  = 150;             // overlap so a name isn't lost at a seam
const _CHUNK_CONCURRENCY = 4;            // bounded parallelism for extraction

// Split text into overlapping chunks, preferring sentence then space boundaries
// inside a lookback window so a name is never cut mid-word at a chunk END.
function _chunkText(text, size = _CHUNK_TARGET, overlap = _CHUNK_OVERLAP) {
  const s = String(text || "");
  if (s.length <= size) return [s];
  const chunks = [];
  let start = 0;
  while (start < s.length) {
    let end = Math.min(start + size, s.length);
    if (end < s.length) {
      const window = s.slice(start, end);
      const lastSentence = Math.max(
        window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "),
      );
      const lastSpace = window.lastIndexOf(" ");
      if (lastSentence > size * 0.5) end = start + lastSentence + 1;
      else if (lastSpace > size * 0.5) end = start + lastSpace;
    }
    const piece = s.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= s.length) break;
    start = Math.max(end - overlap, start + 1); // back up ~overlap for the seam
  }
  return chunks;
}

// Run fn over items with at most `limit` in flight; preserves input order.
async function _mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const _normContent = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const _tokenSet = (s) => new Set(_normContent(s).split(" ").filter(Boolean));
function _jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
const _subjKey = (subjects) =>
  [...(subjects || [])].map((x) => x.toLowerCase()).sort().join("|");
// Union of two subject lists, deduped case-insensitively, original casing kept.
function _unionSubjects(a, b) {
  const out = [];
  const seen = new Set();
  for (const x of [...(a || []), ...(b || [])]) {
    const k = String(x).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

// Consolidate per-chunk signal arrays into one deduped set. The overlap window
// makes adjacent chunks re-emit the same fact/experience; this collapses those
// while preserving every DISTINCT person and every distinct fact.
//   • Same route + same subjects + high content overlap → duplicate (keep richer).
//   • Experience about clearly the same event → merge participant lists (a chunk
//     boundary can drop a participant that another chunk caught).
// Distinct facts about the same person stay separate (low Jaccard → not merged).
function _mergeSignalChunks(signalArrays) {
  const merged = [];
  const tokens = [];
  for (const arr of signalArrays || []) {
    if (!Array.isArray(arr)) continue;
    for (const sig of arr) {
      if (!sig) continue;
      const sigToks = _tokenSet(sig.content);
      const sigKey = _subjKey(sig.subjects);
      let dupIdx = -1;
      for (let i = 0; i < merged.length; i++) {
        if (merged[i].route !== sig.route) continue;
        const sameSubjects = _subjKey(merged[i].subjects) === sigKey;
        const jac = _jaccard(tokens[i], sigToks);
        const isExp = sig.route === "experience" && merged[i].route === "experience";
        if ((sameSubjects && jac >= 0.6) || (isExp && jac >= 0.7)) { dupIdx = i; break; }
      }
      if (dupIdx === -1) {
        merged.push(sig);
        tokens.push(sigToks);
        continue;
      }
      // Keep the more informative (longer) content; union participants for
      // experiences; carry the stronger certainty/weight.
      const m = merged[dupIdx];
      const keep = (sig.content || "").length > (m.content || "").length ? sig : m;
      const isExp = sig.route === "experience" && m.route === "experience";
      merged[dupIdx] = {
        ...keep,
        subjects: isExp ? _unionSubjects(m.subjects, sig.subjects) : keep.subjects,
        certainty: Math.max(m.certainty ?? 0, sig.certainty ?? 0) || keep.certainty,
        weight: Math.max(m.weight ?? 0, sig.weight ?? 0) || keep.weight,
      };
      tokens[dupIdx] = _tokenSet(merged[dupIdx].content);
    }
  }
  return merged;
}

/**
 * Long-transcript variant of extractContactSignal. Chunks the transcript with
 * overlap, extracts each chunk in parallel (bounded concurrency) via the SAME
 * extractContactSignal, then merges+dedupes into one signal set with the same
 * shape the single-pass extractor returns — so the caller's matching /
 * disambiguation logic is entirely unchanged. Falls back to a single pass when
 * the text only produces one chunk. Never throws; fail-safe to [].
 */
export async function extractContactSignalsLong({ message, owner } = {}) {
  const chunks = _chunkText(message);
  if (chunks.length <= 1) return extractContactSignal({ message, owner });
  try {
    const perChunk = await _mapWithConcurrency(chunks, _CHUNK_CONCURRENCY, (chunk, i) =>
      extractContactSignal({ message: chunk, owner: owner != null ? `${owner}#c${i}` : owner }),
    );
    return _mergeSignalChunks(perChunk);
  } catch (e) {
    console.error(`EXTRACT_SIGNALS_LONG_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

/**
 * Multi-signal array extractor for app-chat fact capture.
 * Returns an ARRAY of routed signal objects (possibly empty). One message can
 * yield signals about multiple people and multiple events simultaneously.
 * LLM proposes structure; _routeSignal applies deterministic routing rules.
 *
 * Signal routes: contact_field | self_field | self_fact | experience | fact | note
 * Each signal: { route, subjects, content, field, value, category, sentiment,
 *   sentiment_strength, certainty, is_past, weight, is_conditional, condition }
 *
 * max_tokens raised to 4096 (people-dense memos emit many signals; 1024 was
 * truncating long notes mid-array and the discard was silent).
 * 14s timeout, fail-safe to [] on any error.
 * Does NOT affect extractContactFact (iMessage path) — that is unchanged.
 */
export async function extractContactSignal({ message, owner } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return [];
  try {
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _EXTRACT_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: _EXTRACT_SIGNALS_SYSTEM,
        messages: [{ role: "user", content: `Message: "${message}"\nJSON array:` }],
      }),
      // 14s was not enough and the failure was invisible in the product: a
      // 768-character to-do memo timed out in production (EXTRACT_SIGNALS_ERR,
      // 2026-08-23T13:30:29), fell through the catch to [], and the note captured
      // NOTHING while the user saw a perfectly normal reply. Sonnet emitting up to
      // 4096 tokens of routed JSON for a people-dense memo legitimately needs more
      // than fourteen seconds. This runs concurrently with token generation, so the
      // extra ceiling is only ever paid when the extraction is genuinely the slow
      // half.
      signal: AbortSignal.timeout(_EXTRACT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      // Previously a silent `return []`. A 429 or a 529 from the API looked
      // identical to "this message contained nothing worth capturing", which is the
      // most misleading possible way for a capture pipeline to fail.
      const detail = await resp.text().catch(() => "");
      console.error(
        `EXTRACT_SIGNALS_HTTP status=${resp.status} owner=${owner ?? "unknown"} chars=${String(message || "").length} body=${detail.slice(0, 200)}`,
      );
      return [];
    }
    const data = await resp.json();
    const raw = data.content?.[0]?.text?.trim() || "[]";
    // Surface truncation loudly — a cut-off array is now salvaged below, but the
    // memo is dense enough to warrant raising max_tokens further if this recurs.
    if (data.stop_reason === "max_tokens") {
      console.error(`EXTRACT_SIGNALS_TRUNCATED owner=${owner ?? "unknown"} chars=${raw.length}`);
    }
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const arrStr = _extractFirstJsonArray(cleaned) ?? "[]";
    let parsed;
    try {
      parsed = JSON.parse(arrStr);
    } catch {
      console.error(`EXTRACT_SIGNALS_PARSE_ERR ${raw.slice(0, 300)}`);
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const signals = [];
    for (const item of parsed) {
      const signal = routeSignal(item);
      if (signal) signals.push(signal);
    }
    return signals;
  } catch (e) {
    // Include the owner and the length. The production timeout was only
    // diagnosable because someone happened to read the line above it; on its own
    // "TimeoutError" does not tell you which note lost its facts or how big it was.
    const kind = e?.name === "TimeoutError" ? "timeout" : "error";
    console.error(
      `EXTRACT_SIGNALS_ERR kind=${kind} owner=${owner ?? "unknown"} chars=${String(message || "").length} ms=${_EXTRACT_TIMEOUT_MS} ${e?.stack || e?.message || e}`,
    );
    return [];
  }
}

/**
 * Smart fact-capture router for app chat (and future iMessage migration).
 * Calls extractContactSignal (array extractor) and routes each signal independently:
 *   contact_field → updateContactFields
 *   self_field    → setUserProfileFields
 *   self_fact     → insertUserFact
 *   fact          → insertContactFact (resolved) or pending_contact (unresolved)
 *   note          → insertContactNote with resolved participant_ids
 *   experience    → insertContactExperience with resolved participant_ids
 *
 * Returns { status, outcomes[] } where status is:
 *   "nothing"          — no signals extracted
 *   "captured"         — all signals written cleanly
 *   "needs_resolution" — at least one signal has an unresolved contact
 *   "error"            — guard or exception
 *
 * source defaults to "imessage_dq" for backwards compat; pass "app_chat" from /v1/chat.
 * Never throws. log must have .info and .error methods.
 */
// Cheap deterministic backstop — catches obvious assistant-directed questions before
// we burn a Haiku call. The LLM prompt rule is the primary guard; this catches cases
// where the model still extracts despite the instruction.
// Both conditions must hold: question-stem prefix AND ends with "?", OR contains a
// known meta-phrase. Conservative — normal statements never match.
const _META_STEMS = [
  "did you", "do you", "can you", "could you", "would you", "will you",
  "are you", "were you", "is that", "was that", "what did you", "what have you",
  "which ", "who did you", "how did you", "why did you",
];
const _META_PHRASES = [
  "log that", "logged that", "save that", "saved that",
  "note that for the right", "did you get",
];
function _isLikelyMetaMessage(message) {
  if (!message || typeof message !== "string") return false;
  const t = message.trim().toLowerCase();
  const endsQuestion = t.endsWith("?");
  if (endsQuestion) {
    for (const stem of _META_STEMS) {
      if (t.startsWith(stem)) return true;
    }
  }
  for (const phrase of _META_PHRASES) {
    if (t.includes(phrase)) return true;
  }
  return false;
}

/**
 * A SELF-FACT BECOMES PART OF EVERY FUTURE PROMPT. SOME THINGS DO NOT GO IN.
 *
 * A user testing the app said three things into it:
 *
 *   "I'm gonna bomb Weeview Library."   -> captured nothing
 *   "I kill orphans."                   -> captured nothing
 *   "I am a terrorist."                 -> FACT_SELF category=identity, WRITTEN
 *
 * The inconsistency is its own tell: the extractor was never deciding anything
 * about this, it just happened to find a parseable identity claim in the third
 * one. And a self-fact is not an ordinary row. It is durable, it is the user's
 * own profile, and it is read back into the context of later answers -- so that
 * sentence would go on quietly describing him to the model for as long as the
 * account exists, out of one moment of poking at a demo.
 *
 * This is a blunt instrument and it is meant to be. It does not moderate, it
 * does not warn, and it does not touch facts about OTHER people (a note that a
 * contact is going through something violent is real relationship information
 * and belongs in their file). It declines to write ONE class of row: a durable
 * self-claim of violence or serious crime. The note itself is still saved and
 * still on the user's screen -- nothing is censored, nothing disappears. It
 * simply does not become a permanent attribute of the person.
 */
const _SELF_FACT_REFUSE = [
  /\bterrorist\b/i,
  // "I'm" has no space between the pronoun and the contraction, and the
  // extractor rewrites content into the third person ("is a serial killer"), so
  // both forms have to be here. Adjacent language is deliberately NOT matched:
  // "watched a documentary about a serial killer" has no claimant before it.
  /\b(?:i\s*(?:am|'m)|is)\s+a\s+(?:murderer|rapist|pedophile|serial killer)\b/i,
  /\b(?:bomb|shoot up|blow up|massacre)\b.*\b(?:school|library|church|mosque|synagogue|building|mall|office)\b/i,
  /\bkill(?:s|ing|ed)?\b.*\b(?:orphans|children|kids|people)\b/i,
  /\bi\s+(?:kill|murder|rape)\b/i,
];

export function refusesAsSelfFact(text) {
  const t = String(text || "");
  return _SELF_FACT_REFUSE.some((re) => re.test(t));
}

export async function captureFromMessage({
  ownerId,
  messageText,
  spaceId,
  source = "imessage_dq",
  // Set false when the CALLER has already persisted this text as a note against a
  // known contact (the per-contact note route does exactly that, because it has
  // the contact id in the URL and does not need a model to guess it). Without
  // this, the same sentence would be stored twice: once deterministically and
  // once as extraction's own note row. Facts, fields and experiences still
  // extract normally -- only the duplicate note write is skipped.
  captureNote = true,
  log,
}) {
  if (!ownerId || !messageText) return { status: "error", outcomes: [] };
  log?.info?.(`FACT_CAP_IN owner=${ownerId} source=${source} len=${messageText.length} msg="${String(messageText).slice(0, 70)}"`);
  if (_isLikelyMetaMessage(messageText)) {
    log?.info?.(`FACT_CAP_META_SKIP owner=${ownerId}`);
    return { status: "nothing", outcomes: [] };
  }
  try {
    // Long, rambling voice memos go through the chunk+merge path so no person or
    // fact is lost to a single overflowing pass; short messages keep the exact
    // single-pass behavior they had before (threshold-gated, additive).
    const signals = messageText.length > _LONG_TRANSCRIPT_THRESHOLD
      ? await extractContactSignalsLong({ message: messageText, owner: ownerId })
      : await extractContactSignal({ message: messageText, owner: ownerId });
    log?.info?.(`FACT_CAP_SIGNALS owner=${ownerId} count=${Array.isArray(signals) ? signals.length : "null"} routes=${(signals || []).map((s) => s.route).join(",")} subjects=${(signals || []).map((s) => (s.subjects || []).join("|")).join(";")}`);
    if (!Array.isArray(signals) || signals.length === 0) return { status: "nothing", outcomes: [] };

    const factContacts = await getContactsForResolution(ownerId);
    log?.info?.(`FACT_CAP_CONTACTS owner=${ownerId} contactCount=${Array.isArray(factContacts) ? factContacts.length : "null"}`);
    const outcomes = [];

    for (const signal of signals) {
      const {
        route, subjects, content, field, value, category,
        sentiment, sentiment_strength, certainty, is_past, weight, is_conditional, condition,
      } = signal;

      // ── self routes ──────────────────────────────────────────────────────────
      if (route === "self_field") {
        await setUserProfileFields({ amberId: ownerId, [field]: value }).catch(() => null);
        log.info(`FACT_SELF_FIELD owner=${ownerId} field=${field}`);
        outcomes.push({ route, status: "captured" });
        continue;
      }

      if (route === "self_fact") {
        if (refusesAsSelfFact(content)) {
          // Loud, and counted as nothing rather than as a capture, so the turn
          // does not claim to have logged something it declined to log.
          log?.info?.(`FACT_SELF_REFUSED owner=${ownerId} category=${category}`);
          outcomes.push({ route, status: "skipped" });
          continue;
        }
        await insertUserFact({ ownerId, factText: content, category, source, sourceRef: spaceId }).catch(() => null);
        log.info(`FACT_SELF owner=${ownerId} category=${category}`);
        outcomes.push({ route, status: "captured" });
        continue;
      }

      // ── single-contact routes (contact_field, fact) ──────────────────────────
      if (route === "contact_field" || route === "fact") {
        const subject = subjects[0];
        const resolution = resolveContactByName(subject, factContacts);

        if (resolution.status === "resolved") {
          const contactId = resolution.contactId;
          let _factId3 = null;
          if (route === "contact_field") {
            await updateContactFields({ ownerId, contactId, [field]: value });
            log.info(`FACT_CONTACT_FIELD owner=${ownerId} contact=${contactId} field=${field}`);
          } else {
            const _frow3 = await insertContactFact({
              ownerId, contactId, factText: content, category,
              source, sourceRef: spaceId, rawName: subject, status: "resolved",
              sentiment, sentiment_strength, certainty,
              is_conditional, condition_text: condition, is_past, weight,
            });
            _factId3 = _frow3?.id ?? null;
            log.info(`FACT_CONTACT_FACT owner=${ownerId} contact=${contactId} category=${category}`);
          }
          outcomes.push({ route, status: "captured", contactId, resolvedName: resolution.matchedName, factId: _factId3, text: content });
          continue;
        }

        if (resolution.status === "ambiguous") {
          const mem = await getContactNameMemory(ownerId, norm(subject)).catch(() => null);
          const memMatch = mem
            ? (resolution.candidateObjects ?? []).find((c) => String(c.id) === String(mem.currentContactId))
            : null;

          if (memMatch && mem.stableStreak >= NAME_MEMORY_TRUST_STREAK) {
            // Silent resolve — streak is strong enough to apply directly.
            let _factId4 = null;
            if (route === "contact_field") {
              await updateContactFields({ ownerId, contactId: mem.currentContactId, [field]: value });
            } else {
              const _frow4 = await insertContactFact({
                ownerId, contactId: mem.currentContactId, factText: content, category,
                source, sourceRef: spaceId, rawName: subject, status: "resolved",
                sentiment, sentiment_strength, certainty,
                is_conditional, condition_text: condition, is_past, weight,
              });
              _factId4 = _frow4?.id ?? null;
            }
            log.info(`FACT_SILENT_RESOLVE owner=${ownerId} contact=${mem.currentContactId}`);
            outcomes.push({ route, status: "captured", contactId: mem.currentContactId, resolvedName: memMatch.name, silent: true, factId: _factId4, text: content });
            continue;
          }

          // Hold as pending_contact fact row
          const factText = route === "contact_field" ? `${field}: ${value}` : content;
          const frow = await insertContactFact({
            ownerId, contactId: null, rawName: subject, factText,
            category: route === "fact" ? category : null,
            source, sourceRef: spaceId, status: "pending",
            sentiment: route === "fact" ? sentiment : undefined,
            sentiment_strength: route === "fact" ? sentiment_strength : undefined,
            certainty: route === "fact" ? certainty : undefined,
            is_conditional: route === "fact" ? is_conditional : undefined,
            condition_text: route === "fact" ? condition : undefined,
            is_past: route === "fact" ? is_past : undefined,
            weight: route === "fact" ? weight : undefined,
          });
          const factId = frow?.id ?? null;
          const kind = route === "contact_field" ? "field" : "fact";

          if (memMatch && mem.stableStreak < NAME_MEMORY_TRUST_STREAK) {
            log.info(`FACT_SOFT_CONFIRM owner=${ownerId} name=${subject} guessed=${mem.currentContactId} factId=${factId}`);
            outcomes.push({
              route, status: "soft_confirm",
              guessedId: mem.currentContactId, guessedName: memMatch.name,
              factId, candidates: resolution.candidateObjects ?? [],
              rawName: subject, kind,
              field: kind === "field" ? field : undefined,
              value: kind === "field" ? value : undefined,
            });
          } else {
            // AN AMBIGUOUS NAME STILL GETS A CARD.
            //
            // "Kayla just moved to the Bay Area" tagged nobody. Extraction was
            // perfect; the address book has 973 contacts and several Kaylas, so
            // this branch returned candidates and no person — and a subject with
            // no contactId gets filtered out of the turn's people before it can
            // reach the screen. With a book that size almost every common first
            // name lands here, which is why tagging looked like one time in five.
            //
            // The machinery to do better already existed one branch up: a
            // soft_confirm shows the guessed person AS A CARD and asks whether it
            // is the right one. The only thing that branch had was a stored name
            // memory. So when there is no memory, the best-ranked candidate
            // becomes the guess instead — most-talked-about among the closest
            // spellings, see the sort in resolveContactByName.
            //
            // NOTHING IS WRITTEN EITHER WAY. The fact row above is
            // status: "pending" with contactId null, exactly as before, so
            // a wrong guess costs a tap and never touches the person's card. The
            // full candidate list rides along, so the answer is still one tap even
            // when the guess is wrong.
            const best = (resolution.candidateObjects ?? [])[0] ?? null;
            if (best) {
              log.info(`FACT_SOFT_CONFIRM owner=${ownerId} name=${subject} guessed=${best.id} factId=${factId} via=rank`);
              outcomes.push({
                route, status: "soft_confirm",
                guessedId: best.id, guessedName: best.name,
                factId, candidates: resolution.candidateObjects ?? [],
                rawName: subject, kind,
                field: kind === "field" ? field : undefined,
                value: kind === "field" ? value : undefined,
              });
            } else {
              log.info(`FACT_AMBIGUOUS owner=${ownerId} name=${subject} factId=${factId}`);
              outcomes.push({
                route, status: "ambiguous",
                rawName: subject, factId,
                candidates: resolution.candidateObjects ?? [],
                kind,
                field: kind === "field" ? field : undefined,
                value: kind === "field" ? value : undefined,
              });
            }
          }
          continue;
        }

        // resolution.status === "none"
        const factText = route === "contact_field" ? `${field}: ${value}` : content;
        const frow = await insertContactFact({
          ownerId, contactId: null, rawName: subject, factText,
          category: route === "fact" ? category : null,
          source, sourceRef: spaceId, status: "pending",
          sentiment: route === "fact" ? sentiment : undefined,
          sentiment_strength: route === "fact" ? sentiment_strength : undefined,
          certainty: route === "fact" ? certainty : undefined,
          is_conditional: route === "fact" ? is_conditional : undefined,
          condition_text: route === "fact" ? condition : undefined,
          is_past: route === "fact" ? is_past : undefined,
          weight: route === "fact" ? weight : undefined,
        });
        const factId = frow?.id ?? null;
        const kind = route === "contact_field" ? "field" : "fact";
        log.info(`FACT_CONTACT_PENDING owner=${ownerId} name=${subject} reason=none`);
        // A fact/field about a person who matches NO existing contact used to be
        // pushed as status:"pending" and rendered as nothing — the signal simply
        // vanished. Mirror the note/experience path: surface a clarify card whose
        // only options are "add as new contact" / "skip". The chat resolve path
        // already handles __new__ (create) and __skip__ (dismiss), so no new
        // resolve logic is needed. noMatch drives the correct zero-match copy.
        outcomes.push({
          route, status: "ambiguous",
          rawName: subject, factId,
          candidates: [{ id: "__new__", name: subject }, { id: "__skip__", name: subject }],
          kind, noMatch: true,
          field: kind === "field" ? field : undefined,
          value: kind === "field" ? value : undefined,
        });
        continue;
      }

      // ── multi-participant routes (note, experience) ──────────────────────────
      if (route === "note" || route === "experience") {
        // "self" means the owner — owner is the author, not a contact participant.
        const nonSelfSubjects = subjects.filter((s) => s.toLowerCase() !== "self");
        const resolvedParticipantIds = [];
        const resolvedParticipantNames = [];
        const unresolvedSubjects = [];

        // Every named participant runs through the SAME confidence-pointer rule,
        // so reconciliation is consistent for one contact or a thousand:
        //   1. A pointer confirmed 2+ times (still pointing at a real contact)
        //      files with no question — that's the "already reconciled" fast path.
        //   2. Otherwise the name is confirmed once before filing, which is what
        //      BUILDS the pointer: a single best guess (unique spelling, homophone,
        //      or the memory's prior pick) → "did you mean X?"; several equally
        //      likely contacts → "which one?".
        //   3. A name that matches no contact is held as a pending mention (a
        //      name-only chip) until it's linked.
        for (const subject of nonSelfSubjects) {
          const res = resolveContactByName(subject, factContacts);
          const mem = await getContactNameMemory(ownerId, norm(subject)).catch(() => null);

          if (mem && mem.stableStreak >= NAME_MEMORY_TRUST_STREAK && mem.currentContactId) {
            const c = factContacts.find((x) => String(x.id) === String(mem.currentContactId));
            if (c) {
              // String, not Number. contacts.id is a uuid, so Number() gave NaN
              // and this pushed NaN as a participant id -- on the TRUSTED branch,
              // the one taken when name memory is confident about who was meant.
              // The more certain the system was about the person, the more surely
              // it failed to tag them.
              resolvedParticipantIds.push(String(c.id));
              resolvedParticipantNames.push(c.full_name);
              continue;
            }
          }

          // candidateObjects are already { id, name } — do NOT re-map to full_name
          // (that field doesn't exist on them and blanked out the option labels).
          const cands =
            res.status === "ambiguous"
              ? (res.candidateObjects ?? []).map((c) => ({ id: String(c.id), name: c.name }))
              : res.status === "resolved"
                ? [{ id: String(res.contactId), name: res.matchedName }]
                : [];

          // "Add as a new contact" is always an option so an unrecognised person
          // can be created and linked on the spot; "__skip__" leaves them
          // unlinked. These sentinel ids are handled in the chat resolve path.
          const newOpt = { id: "__new__", name: subject };
          const skipOpt = { id: "__skip__", name: subject };
          if (cands.length === 0) {
            unresolvedSubjects.push({ subject, kind: "clarify", candidates: [newOpt, skipOpt] });
          } else if (cands.length === 1) {
            // ATTACH IT NOW, AND STILL ASK.
            //
            // A single unambiguous match used to go to soft-confirm WITHOUT being
            // attached, so the row was written with participant_ids = []. That is
            // not a cosmetic gap: getContactContentForContacts joins notes and
            // experiences on `participant_ids && $2`, so an unattached experience is
            // invisible to PeopleRank. A note saying "fundraising in San Francisco
            // with Sagar" therefore did not make Sagar findable for "who do I know
            // in SF" until the user happened to tap a confirmation chip — and if
            // they dismissed it, never. The memory was captured and unreachable.
            //
            // Attaching provisionally is safe because the correction path already
            // REPLACES participants rather than adding to them (chat.js builds
            // newIds by filtering the old id out before calling
            // setExperienceParticipants), so answering "no, a different Sagar"
            // removes this one. The confirmation chip is unchanged and still asks.
            //
            // The asymmetry is deliberate: a wrong attachment is visible, correctable
            // in one tap, and self-heals via the name memory. An unattached row is
            // silent and permanent.
            resolvedParticipantIds.push(Number(cands[0].id));
            resolvedParticipantNames.push(cands[0].name);
            unresolvedSubjects.push({
              subject, kind: "soft",
              guessedId: cands[0].id, guessedName: cands[0].name,
              candidates: [cands[0], newOpt, skipOpt],
            });
          } else {
            const memPick = mem ? cands.find((c) => String(c.id) === String(mem.currentContactId)) : null;
            if (memPick) {
              unresolvedSubjects.push({
                subject, kind: "soft",
                guessedId: memPick.id, guessedName: memPick.name,
                candidates: [...cands, newOpt, skipOpt],
              });
            } else {
              unresolvedSubjects.push({ subject, kind: "clarify", candidates: [...cands, newOpt, skipOpt] });
            }
          }
        }

        let contentId;
        if (route === "note" && !captureNote) {
          // Already written by the caller against a known contact. Skipping the
          // row is the point; the outcome is still reported so the caller sees
          // that this signal was recognized and deliberately not re-stored.
          log.info(`FACT_NOTE_SKIPPED owner=${ownerId} reason=caller_wrote_it`);
          continue;
        }
        if (route === "note") {
          contentId = await insertContactNote({
            ownerId, noteText: content,
            participantIds: resolvedParticipantIds, rawNames: nonSelfSubjects,
            category, sentiment, sentimentStrength: sentiment_strength,
            certainty, weight, isPast: is_past,
            status: "resolved", source, sourceRef: spaceId,
          });
          log.info(`FACT_NOTE owner=${ownerId} participants=${resolvedParticipantIds.length} pending=${unresolvedSubjects.length}`);
        } else {
          contentId = await insertContactExperience({
            ownerId, experienceText: content,
            participantIds: resolvedParticipantIds, rawNames: nonSelfSubjects,
            category, sentiment, sentimentStrength: sentiment_strength,
            certainty, weight, isPast: is_past,
            status: "resolved", source, sourceRef: spaceId,
          });
          log.info(`FACT_EXPERIENCE owner=${ownerId} participants=${resolvedParticipantIds.length} pending=${unresolvedSubjects.length}`);
        }

        if (unresolvedSubjects.length === 0) {
          outcomes.push({ route, status: "captured", contentId, participantNames: resolvedParticipantNames, participantIds: resolvedParticipantIds, text: content });
        } else {
          // Even when some names still need resolving, surface the ones that DID
          // resolve so they get tagged on the note immediately; the unresolved
          // ones become clarify/soft-confirm cards below.
          if (resolvedParticipantNames.length > 0) {
            outcomes.push({ route, status: "captured", contentId, participantNames: resolvedParticipantNames, participantIds: resolvedParticipantIds, text: content });
          }
          for (const u of unresolvedSubjects) {
            if (u.kind === "soft") {
              outcomes.push({
                route, status: "soft_confirm",
                rawName: u.subject, contentType: route, contentId,
                candidates: u.candidates,
                guessedId: u.guessedId, guessedName: u.guessedName,
              });
            } else if (u.kind === "clarify") {
              outcomes.push({
                route, status: "ambiguous",
                rawName: u.subject, contentType: route, contentId,
                candidates: u.candidates,
              });
            }
            // kind "pending": no question — the name is already in the note's
            // raw_names and shows as a name-only chip until it's linked.
          }
        }
        continue;
      }
    }

    const NEEDS_RESOLUTION = new Set(["ambiguous", "soft_confirm", "pending"]);
    const topStatus = outcomes.length === 0
      ? "nothing"
      : outcomes.some((o) => NEEDS_RESOLUTION.has(o.status)) ? "needs_resolution" : "captured";
    log?.info?.(`FACT_CAP_OUT owner=${ownerId} status=${topStatus} outcomes=${outcomes.map((o) => `${o.route}:${o.status}`).join(",")}`);
    return { status: topStatus, outcomes };
  } catch (e) {
    log.error(`FACT_CAPTURE_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
    return { status: "error", outcomes: [] };
  }
}

/**
 * Used only from the DQ path — writes facts silently after a DQ ack is already sent.
 * No outbound messages so the DQ reply stays the sole message for that turn.
 * Ambiguous/no-match facts are stored as pending_contact without asking for
 * clarification; they get resolved the next time the person is mentioned in a
 * normal chat message. Owner-scoped. Never throws.
 */
export async function runFactCapture({ ownerId, messageText, spaceId, log }) {
  if (!ownerId || !messageText) return;
  try {
    const r = await extractContactFact({ message: messageText });
    if (!r?.fact) return;
    log.info(`PHOTON_FACT_EXTRACTED owner=${ownerId} hasFact=true name=${r.name || "none"}`);
    const factContacts = await getContactsForResolution(ownerId);
    const resolution = resolveContactByName(r.name, factContacts);
    if (resolution.status === "resolved") {
      await insertContactFact({
        ownerId, contactId: resolution.contactId, factText: r.fact,
        category: r.category, source: "imessage_dq", sourceRef: spaceId,
        rawName: r.name, status: "resolved",
      });
      log.info(`PHOTON_FACT_WRITE owner=${ownerId} contact=${resolution.contactId} category=${r.category}`);
    } else {
      await insertContactFact({
        ownerId, contactId: null, rawName: r.name, factText: r.fact,
        category: r.category, source: "imessage_dq", sourceRef: spaceId,
        status: "pending",
      });
      log.info(`PHOTON_FACT_PENDING owner=${ownerId} name=${r.name} source=dq`);
    }
  } catch (e) {
    log.error(`PHOTON_FACT_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
  }
}
