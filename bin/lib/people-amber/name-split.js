/**
 * SPLITTING A NAME FIELD THAT IS NOT ONLY A NAME.
 *
 * "A lot of times in Apple Contact Sync there's more information in the first
 *  and last name fields than what is actually the first and last name. The
 *  Shirley Park USC BTG stuff, all of that was in one name field. That type of
 *  stuff needs to be intelligently parsed out."
 *
 * The first version of this leaned on iOS keeping first_name and last_name apart
 * from the display name, and subtracted the name parts from full_name to get the
 * tagline. When the card is well formed that is exact and needs no cleverness.
 * It is also, on a real phone, frequently not the case: people type the whole
 * thing into one box, so first_name is "Shirley Park USC BTG" and subtracting it
 * from full_name leaves nothing. Every tagline on every card like that was
 * invisible.
 *
 * SO THE ADDRESS BOOK IS ITS OWN DICTIONARY, and that is the whole idea here. No
 * name corpus ships with this, no model is called, and none is needed: the
 * signal is that a tagline REPEATS ACROSS PEOPLE and a name does not.
 *
 *   "USC" appears on eleven cards belonging to eleven different people. Nobody
 *   has eleven relatives called USC. It is a label the user types.
 *
 *   "Park" appears on three cards -- Shirley Park, David Park, Grace Park --
 *   which is what a family looks like, and it sits where a surname sits.
 *
 * Frequency alone would eat the surname. Position alone would keep "Arjun USC
 * Tech Club" as a four-word name. Shape alone would call every acronym a tag and
 * miss "Plumber". The three together are what make this work, and the ordering
 * below is deliberate.
 *
 * THE STICKY TAIL is the rule that does the most work and it comes straight from
 * how people actually write these: the name comes first and the label comes
 * after. Once a token has been judged a label, everything to its right is a
 * label too. "Arjun USC Tech Club" resolves on USC and then Tech and Club follow
 * for free -- no vocabulary needed for either of them.
 *
 * WHEN IN DOUBT IT IS A NAME. A word wrongly kept in the name is invisible; a
 * surname wrongly reported as a tag is Amber telling someone their brother is
 * tagged "Park", and being confidently wrong about a person's own address book
 * is the failure that matters.
 */

/** Split on whitespace, hyphens and punctuation. Case and symbols are noise. */
export function tokenizeName(value) {
  return String(value || "")
    .replace(/[(){}\[\]<>"'`~!@#$%^&*_=+|\\/:;,.?]+/g, " ")
    .split(/[\s -]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const norm = (t) => String(t || "").toLowerCase();

/**
 * Words that are never a name, however they appear.
 *
 * Three kinds. Name furniture (Jr, van, de) is part of a name and would read as
 * a tag on every card carrying it. Phone-book debris ("iPhone", "old number",
 * "Work") is a label on a field. And the handful of role words people use as
 * taglines so often that waiting for corpus frequency to notice them is a worse
 * answer than just knowing -- a plumber appears once in most address books.
 */
const NAME_FURNITURE = new Set([
  "jr", "sr", "ii", "iii", "iv", "dr", "mr", "mrs", "ms", "miss", "prof", "rev",
  "van", "von", "de", "del", "della", "da", "di", "la", "le", "el",
  "bin", "ibn", "al", "san", "st", "saint", "mac", "mc", "o", "ben", "abu",
]);

const FIELD_DEBRIS = new Set([
  "iphone", "phone", "mobile", "cell", "cellphone", "home", "work", "office",
  "old", "new", "number", "no", "tel", "fax", "main", "other", "backup", "alt",
  "do", "not", "call", "dnd", "spam", "unknown", "unnamed", "test", "temp",
  "the", "and", "or", "of", "at", "from", "for", "with", "a", "an", "guy", "lady",
]);

/**
 * Roles and relationships people write into a contact name. Present because they
 * are common enough that one occurrence should still be read as a label, which
 * corpus frequency by definition cannot do.
 */
const ROLE_WORDS = new Set([
  "plumber", "electrician", "dentist", "doctor", "dr", "vet", "mechanic",
  "landlord", "realtor", "agent", "broker", "barber", "hairdresser", "tailor",
  "trainer", "coach", "therapist", "lawyer", "attorney", "accountant", "cpa",
  "uber", "lyft", "driver", "cleaner", "nanny", "babysitter", "tutor",
  "recruiter", "boss", "manager", "intern", "professor", "ta", "advisor",
  "mom", "dad", "mother", "father", "sister", "brother", "aunt", "uncle",
  "cousin", "grandma", "grandpa", "wife", "husband", "roommate", "neighbor",
  "work", "school", "college", "gym", "church", "class", "club", "team",
]);

/** An acronym or ticker-shaped token: USC, BTG, MIT, NYU, GS, JPM, KPMG. */
function looksLikeAcronym(raw) {
  return /^[A-Z0-9&]{2,6}$/.test(raw) && /[A-Z]/.test(raw);
}

/**
 * How often each token appears across DISTINCT contacts in one address book.
 *
 * Counted per contact, not per occurrence, so a card that repeats a word does
 * not inflate it. Built once per book and passed into every split, because the
 * whole method depends on comparing a token against its neighbors' cards.
 */
export function buildNameCorpus(contacts) {
  const counts = new Map();
  for (const c of Array.isArray(contacts) ? contacts : []) {
    const seen = new Set();
    for (const field of [
      c?.full_name ?? c?.fullName,
      c?.first_name ?? c?.firstName,
      c?.last_name ?? c?.lastName,
      c?.nickname,
    ]) {
      for (const tok of tokenizeName(field)) seen.add(norm(tok));
    }
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return { counts, size: Array.isArray(contacts) ? contacts.length : 0 };
}

/**
 * How many distinct contacts carry this token. 0 when there is no corpus, which
 * makes every frequency test below fail closed -- i.e. toward "it is a name".
 */
function freq(corpus, token) {
  return corpus?.counts?.get(norm(token)) ?? 0;
}

/**
 * A token is a shared LABEL rather than this person's name.
 *
 * Frequency thresholds are absolute rather than proportional. A tag on three
 * cards is a tag whether the book holds 40 contacts or 4,000; a proportional
 * threshold would make the same word a name in a big book and a tag in a small
 * one, which is a worse kind of wrong.
 */
function isLabelToken(raw, index, corpus, { totalTokens }) {
  const k = norm(raw);
  if (NAME_FURNITURE.has(k)) return false; // part of the name, never a tag
  if (FIELD_DEBRIS.has(k)) return true;
  if (ROLE_WORDS.has(k)) return true;
  if (/^\d+$/.test(k)) return true; // a phone fragment or a "2"

  const n = freq(corpus, raw);

  // AN ACRONYM SHARED BY THREE PEOPLE, anywhere in the field including where a
  // first name would go. This is the "Arjun USC Tech Club" case: USC sits in
  // position 1, which is normally name territory, and it is on eleven other
  // cards.
  if (looksLikeAcronym(raw) && n >= 3) return true;

  // Beyond the second token, the bar drops. Two people sharing a word that is
  // already past where a surname sits is a label.
  if (index >= 2 && n >= 2) return true;

  // A FOURTH TOKEN IS A LABEL. Nobody's legal name is being typed into a phone
  // as four words; by this point the user is annotating.
  if (index >= 3) return true;

  // An acronym at position 2+ on its own. "Shirley Park BTG" where BTG appears
  // nowhere else -- still not a surname, because surnames are not three capital
  // letters.
  if (index >= 2 && looksLikeAcronym(raw)) return true;

  return false;
}

/**
 * Split one contact's name into the person's name and the labels around it.
 *
 * Returns `{ name, nameTokens, tags }`. `corpus` is optional; without it this
 * degrades to position and shape, which is the same conservative direction as
 * everything else here.
 */
export function splitName(contact, corpus = null) {
  // THE LONGEST FIELD WINS, because that is where the information is. On a well
  // formed card full_name is "Shirley Park" and first/last agree with it; on the
  // cards this function exists for, first_name is the whole string and full_name
  // may be truncated or absent. Taking the longest token list means neither
  // shape loses anything.
  const candidates = [
    tokenizeName(contact?.full_name ?? contact?.fullName),
    tokenizeName(contact?.first_name ?? contact?.firstName),
    tokenizeName(contact?.last_name ?? contact?.lastName),
  ];
  // first + last combined, for the ordinary card where they are split cleanly.
  const combined = [...candidates[1], ...candidates[2]];
  const tokens = [candidates[0], combined].sort((a, b) => b.length - a.length)[0] ?? [];

  if (tokens.length === 0) return { name: null, nameTokens: [], tags: [] };

  const nameTokens = [];
  const tags = [];
  // POSITION IS COUNTED WITHOUT THE FURNITURE. "Maria de la Cruz" puts Cruz at
  // raw index 3, where the fourth-token rule fires and reported her surname as a
  // tag. `de` and `la` are not name positions, they are joiners -- so the
  // effective position of Cruz is 1, exactly where a surname belongs.
  let position = 0;
  // THE STICKY TAIL. Once a label starts, the rest of the field is label. This
  // is how people write these -- name first, annotation after -- and it is why
  // "Tech" and "Club" need no vocabulary entry of their own.
  let inTail = false;

  for (const raw of tokens) {
    if (inTail) {
      tags.push(raw);
      continue;
    }
    if (NAME_FURNITURE.has(norm(raw))) {
      nameTokens.push(raw);
      continue; // a joiner: kept, and it does not advance the position
    }
    if (isLabelToken(raw, position, corpus, { totalTokens: tokens.length })) {
      inTail = true;
      tags.push(raw);
      continue;
    }
    nameTokens.push(raw);
    position += 1;
  }

  // NEVER RETURN A NAMELESS PERSON. If every token read as a label the corpus
  // has misled us -- a whole family tagged the same way, an address book of
  // acronyms -- and the first token goes back to being the name. A contact with
  // no name cannot be shown, matched or spoken about.
  if (nameTokens.length === 0 && tags.length > 0) {
    nameTokens.push(tags.shift());
  }

  return {
    name: nameTokens.join(" ") || null,
    nameTokens,
    // Furniture is dropped from tags here rather than in isLabelToken so the
    // sticky tail still sees it and does not break on "Smith Jr USC".
    tags: tags.filter((t) => {
      const k = norm(t);
      if (NAME_FURNITURE.has(k)) return false;
      if (FIELD_DEBRIS.has(k)) return false;
      if (/^\d+$/.test(k)) return false;
      return k.length >= 2;
    }),
  };
}
