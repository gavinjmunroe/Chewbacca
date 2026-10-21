/**
 * WHAT AMBER CAN SAY ABOUT A BRAND-NEW USER WHO HAS ONLY SYNCED THEIR CONTACTS.
 *
 * "Do you know anything about any of my contacts?"
 * "Right now I don't have any contacts or notes in front of me for you."
 *
 * Against 1,231 contacts. That answer is what a new user gets on day one, which
 * is every user's first impression, and it is a lie -- there is a great deal to
 * say, and none of it needs PeopleRank, an observation, a note, a score, or a
 * model. It is all sitting in the contact rows the sync already wrote.
 *
 * What Karthik asked for, and it is the right bar:
 *
 *   "I know that you have this many contacts. I know that 10 of your contacts
 *    have the tag USC on them. I know 50 of them have the area code for LA. I
 *    know 100 of them have the area code for New York, but there is no personal
 *    information on any of them. Would you like to add information on any
 *    contacts?"
 *
 * THE TAGLINE IS THE WHOLE IDEA, and it is a thing real address books are full
 * of. People do not save "Shirley Park". They save "Shirley Park BTG USC", and
 * "Mike Plumber", and "Jenny from Stripe" -- a name plus a few words to tell
 * two people apart later. Those words are the only self-reported information
 * most contacts will ever carry, and Amber was throwing every one of them away.
 *
 * HOW A TAGLINE IS TOLD FROM A NAME, which is the part that has to be right:
 *
 *   "It has to be able to distinguish and make sure tech is not part of their
 *    first name, last name, nickname, or anything else, but it's actually just a
 *    tagline that they gave them to identify them."
 *
 * The card already answers this. iOS stores `first_name` and `last_name`
 * separately from the display name, so the annotation is exactly what is left of
 * `full_name` after the name parts are removed:
 *
 *   full_name  "Shirley Park BTG USC"
 *   first_name "Shirley"   last_name "Park"
 *   -----------------------------------------
 *   annotation "BTG USC"
 *
 * No frequency threshold, no guessing, no model. And for a card whose name parts
 * are missing, the first two tokens are treated as the name and the rest as
 * annotation, which is the conservative reading -- it can only ever discard a
 * word that might have been a tagline, never invent one out of a surname.
 *
 * Frequency then does the second job: an annotation token on ten cards is a tag
 * the user actually uses ("USC"), and one on a single card is a detail about
 * that person. Both are worth having; they are worth having differently.
 *
 * EVERYTHING HERE IS PURE. No database, no network. It takes rows and returns a
 * summary, so it is tested against fixtures rather than against production.
 *
 * THE PARSING ITSELF MOVED. Subtracting first_name and last_name from full_name
 * is exact when the card is well formed and useless when it is not -- and on a
 * real phone it frequently is not: people type "Shirley Park USC BTG" into the
 * first-name box, and there is then nothing to subtract. src/lib/name-split.js
 * does the real work, using the address book as its own dictionary (a tagline
 * repeats across people; a surname does not). This file consumes it.
 */
import { buildNameCorpus, splitName, tokenizeName } from "./name-split.js";

/**
 * Words that are never a tagline, however they appear.
 *
 * Two kinds. Name furniture (Jr, Dr, van, de) is part of a person's name and
 * would otherwise read as an annotation on every card that has it. And the
 * mechanical junk address books accumulate -- "iPhone", "Mobile", "Work", "old
 * number" -- which is a label on a field, not a fact about a human.
 */
const NOT_A_TAGLINE = new Set([
  // name furniture
  "jr", "sr", "ii", "iii", "iv", "dr", "mr", "mrs", "ms", "miss", "prof",
  "van", "von", "de", "del", "della", "da", "di", "la", "le", "el",
  "bin", "ibn", "al", "san", "st", "saint", "mac", "mc", "o",
  // field labels and phone-book debris
  "iphone", "phone", "mobile", "cell", "cellphone", "home", "work", "office",
  "old", "new", "number", "no", "tel", "fax", "main", "other", "backup",
  "do", "not", "call", "dnd", "spam", "unknown", "unnamed", "test",
  "the", "and", "or", "of", "at", "from", "for", "with", "a", "an",
]);

/** Split a name into comparable tokens. Punctuation and case are noise here. */
function tokenize(value) {
  return String(value || "")
    .replace(/[(){}\[\]<>"'`~!@#$%^&*_=+|\\/:;,.?]+/g, " ")
    .split(/[\s -]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const norm = (t) => String(t || "").toLowerCase();

/**
 * The words on this card that the user typed to identify the person, as opposed
 * to the person's name.
 *
 * `corpus` (from buildNameCorpus) is what makes this work on a card whose name
 * fields hold the labels too. Without it this falls back to position and shape
 * only, which is the conservative direction.
 */
export function annotationTokens(contact, corpus = null) {
  return splitName(contact, corpus).tags;
}

/** The person's actual name, with the labels stripped off. */
export function displayName(contact, corpus = null) {
  return splitName(contact, corpus).name;
}

/** Kept for the well-formed-card path and for the tests that pin it. */
export function annotationTokensByFieldSubtraction(contact) {
  const full = tokenize(contact?.full_name ?? contact?.fullName);
  if (full.length === 0) return [];

  const first = tokenize(contact?.first_name ?? contact?.firstName).map(norm);
  const last = tokenize(contact?.last_name ?? contact?.lastName).map(norm);
  const nick = tokenize(contact?.nickname).map(norm);
  // A LIST, NOT A SET. first_name "Park" with last_name "Park" is a real name
  // shape, and collapsing it to one token left a stray "Park" being reported as
  // this person's tagline. Each name part is removed as many times as it appears
  // in the name -- so a genuine repeat is consumed, and a tagline that happens
  // to reuse a name word still survives.
  const nameParts = [...first, ...last, ...nick];

  let rest;
  if (nameParts.length > 0) {
    const remaining = new Map();
    for (const p of nameParts) remaining.set(p, (remaining.get(p) ?? 0) + 1);
    rest = [];
    for (const tok of full) {
      const k = norm(tok);
      const left = remaining.get(k) ?? 0;
      if (left > 0) {
        remaining.set(k, left - 1);
        continue;
      }
      rest.push(tok);
    }
  } else {
    // NO NAME PARTS ON THE CARD. Assume the first two tokens are the name --
    // the conservative direction, since the cost is dropping a word that might
    // have been a tagline rather than inventing a tagline out of a surname.
    rest = full.slice(2);
  }

  return rest.filter((tok) => {
    const k = norm(tok);
    if (NOT_A_TAGLINE.has(k)) return false;
    // A bare number is a phone fragment or a duplicate marker, not a tagline.
    if (/^\d+$/.test(k)) return false;
    if (k.length < 2) return false;
    return true;
  });
}

// ── Where a number is from ───────────────────────────────────────────────────
//
// Area code to metro, for the metros an American address book is actually full
// of. Deliberately partial: a code that is not here is reported as "unknown"
// rather than guessed at, because "50 contacts in Ohio" being wrong is worse
// than not saying it. Every entry is a NANP geographic code; toll-free and
// non-geographic codes are excluded on purpose.

const AREA_CODES = {
  "Los Angeles": ["213", "310", "323", "424", "562", "626", "661", "747", "818", "820", "657", "714", "949", "909", "951"],
  "New York": ["212", "332", "646", "917", "718", "347", "929", "516", "631", "914", "845", "718"],
  "San Francisco Bay Area": ["415", "628", "650", "408", "669", "510", "341", "925", "707"],
  "San Diego": ["619", "858", "760", "442"],
  Chicago: ["312", "773", "872", "847", "224", "630", "331", "708", "464"],
  Boston: ["617", "857", "781", "339", "508", "774", "978", "351"],
  "Washington DC": ["202", "301", "240", "703", "571"],
  Seattle: ["206", "425", "253", "564"],
  Austin: ["512", "737"],
  Dallas: ["214", "469", "972", "945", "817", "682"],
  Houston: ["713", "281", "832", "346"],
  Atlanta: ["404", "470", "678", "770", "943"],
  Miami: ["305", "786", "954", "754", "561"],
  Denver: ["303", "720", "983"],
  Philadelphia: ["215", "267", "445", "484", "610"],
  Phoenix: ["602", "480", "623", "520"],
  Detroit: ["313", "248", "947", "734", "586"],
  Nashville: ["615", "629"],
  Portland: ["503", "971"],
  "Las Vegas": ["702", "725"],
  "New Jersey": ["201", "551", "862", "973", "732", "848", "908", "609", "640"],
};

const METRO_BY_CODE = (() => {
  const m = new Map();
  for (const [metro, codes] of Object.entries(AREA_CODES)) {
    for (const c of codes) if (!m.has(c)) m.set(c, metro);
  }
  return m;
})();

/**
 * The NANP area code of a phone number, or null.
 *
 * Accepts what a real address book holds: +1 (213) 555-0100, 213-555-0100,
 * 12135550100. Rejects anything that is not a ten-digit North American number,
 * because an area code read off a UK mobile is a wrong fact stated confidently.
 */
export function areaCodeOf(phone) {
  const digits = String(phone || "").replace(/\D+/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  const code = ten.slice(0, 3);
  // NANP: area codes never start with 0 or 1, and N11 codes are service codes.
  if (/^[01]/.test(code)) return null;
  if (/^\d11$/.test(code)) return null;
  return code;
}

export function metroOf(phone) {
  const code = areaCodeOf(phone);
  return code ? (METRO_BY_CODE.get(code) ?? null) : null;
}

/**
 * Everything the address book says about itself.
 *
 * `contacts` are rows as the store returns them: full_name, first_name,
 * last_name, company, title, phone_primary (or phones_all), nickname.
 * `factCounts` is optional -- a map of contact id to how many notes/facts exist
 * on them -- so the summary can say "and no personal information on any of
 * them", which is the honest and useful half of the answer.
 */
export function summarizeAddressBook(contacts, { factCounts = null, topTags = 8, topMetros = 5 } = {}) {
  const rows = Array.isArray(contacts) ? contacts : [];
  const total = rows.length;
  // BUILT ONCE PER BOOK. Every split below compares its tokens against every
  // other card, so the corpus is the shared state that makes "USC on eleven
  // cards is a label" knowable at all.
  const corpus = buildNameCorpus(rows);

  // token -> { label, count, names[] }. Keyed on the lowercased form so USC and
  // usc are one tag, labeled with the spelling the user actually typed most.
  const tags = new Map();
  const metros = new Map();
  const companies = new Map();
  let withPhone = 0;
  let withEmail = 0;
  let withCompany = 0;
  let withAnnotation = 0;

  for (const c of rows) {
    const ann = annotationTokens(c, corpus);
    if (ann.length > 0) withAnnotation += 1;
    const seenOnThisCard = new Set();
    for (const tok of ann) {
      const k = norm(tok);
      if (seenOnThisCard.has(k)) continue;
      seenOnThisCard.add(k);
      const entry = tags.get(k) ?? { label: tok, count: 0, names: [] };
      entry.count += 1;
      if (entry.names.length < 6) {
        const nm = c.full_name ?? c.fullName;
        if (nm) entry.names.push(nm);
      }
      tags.set(k, entry);
    }

    const phone = c.phone_primary ?? c.phonePrimary ?? c.phone_primary_normalized ?? null;
    const anyPhone = phone || String(c.phones_all ?? c.phonesAll ?? "").split(/[,;|]/)[0];
    if (anyPhone) withPhone += 1;
    const metro = metroOf(anyPhone);
    if (metro) metros.set(metro, (metros.get(metro) ?? 0) + 1);

    if (c.emails && String(c.emails).trim()) withEmail += 1;
    const company = String(c.company ?? "").trim();
    if (company) {
      withCompany += 1;
      const k = company.toLowerCase();
      const e = companies.get(k) ?? { label: company, count: 0 };
      e.count += 1;
      companies.set(k, e);
    }
  }

  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label);
  const withFacts = factCounts
    ? rows.filter((c) => Number(factCounts[String(c.id)] ?? 0) > 0).length
    : null;

  return {
    total,
    withPhone,
    withEmail,
    withCompany,
    withAnnotation,
    withFacts,
    // A tag is an annotation the user has used on more than one person. Below
    // that it is a detail about one contact, which belongs to that contact.
    tags: [...tags.values()].filter((t) => t.count > 1).sort(byCount).slice(0, topTags),
    metros: [...metros.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort(byCount)
      .slice(0, topMetros),
    companies: [...companies.values()].filter((c) => c.count > 1).sort(byCount).slice(0, topTags),
  };
}

/**
 * THE WORDS IN A QUESTION THAT COULD PLAUSIBLY BE A TAG.
 *
 * "Who in my contacts has worked at a tech company?" -> ["tech", "technology",
 * "software", "engineer", ...]. Nothing clever: the question's content words,
 * with the scaffolding removed, plus a small synonym table for the domains
 * people actually ask about. A word with no synonyms is still used on its own,
 * so "who works at Stripe" and "anyone in podcasting" both work without anyone
 * having to add them here.
 *
 * The stopword list matters more than the synonyms. "company", "contacts" and
 * "people" appear in the question and are also the kind of word that shows up in
 * a company field, so leaving them in makes every question match everything.
 */
const QUESTION_STOPWORDS = new Set([
  "who", "what", "which", "whom", "whose", "where", "when", "why", "how",
  "do", "does", "did", "is", "are", "was", "were", "am", "be", "been", "being",
  "has", "have", "had", "can", "could", "should", "would", "will", "shall",
  "my", "mine", "me", "i", "you", "your", "our", "us", "them", "they", "he",
  "she", "it", "his", "her", "their", "any", "all", "some", "each", "every",
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "from", "with",
  "about", "into", "over", "under", "by", "as", "and", "or", "but", "if",
  "know", "knows", "tell", "show", "find", "give", "list", "get", "see",
  "anything", "something", "anyone", "someone", "anybody", "somebody",
  "contact", "contacts", "people", "person", "friend", "friends", "network",
  "company", "companies", "work", "works", "worked", "working", "job", "jobs",
  "there", "here", "now", "yet", "still", "also", "too", "very", "really",
  "like", "want", "need", "help", "please", "thanks", "one", "ones", "thing",
]);

/**
 * Domains worth expanding, because the word someone asks with is rarely the word
 * they wrote on the card. Extend freely; nothing depends on this being complete.
 */
const SYNONYMS = {
  tech: ["tech", "technology", "software", "engineering", "engineer", "startup", "swe", "dev", "developer", "it"],
  finance: ["finance", "financial", "banking", "bank", "vc", "pe", "hedge", "trading", "trader", "ib", "investment"],
  medicine: ["medicine", "medical", "doctor", "md", "nurse", "health", "healthcare", "hospital", "clinic", "pharma", "dentist"],
  law: ["law", "legal", "lawyer", "attorney", "jd", "counsel", "paralegal"],
  design: ["design", "designer", "ux", "ui", "product", "brand", "creative"],
  school: ["school", "college", "university", "grad", "alum", "alumni", "student", "class"],
  realestate: ["real", "estate", "realtor", "broker", "property", "mortgage"],
  consulting: ["consulting", "consultant", "strategy", "mbb", "advisory"],
};

export function topicTermsFrom(message) {
  const words = tokenize(message)
    .map(norm)
    .filter((w) => w.length >= 2 && !QUESTION_STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (words.length === 0) return [];
  const out = new Set();
  for (const w of words) {
    out.add(w);
    // "do I know any lawyers" has to reach the card that says "lawyer". A naive
    // trailing -s strip, applied only for the synonym lookup and only on words
    // long enough that it cannot mangle them, and BOTH forms are kept as terms.
    const singular = w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
    if (singular !== w) out.add(singular);
    for (const form of new Set([w, singular])) {
      for (const group of Object.values(SYNONYMS)) {
        if (group.includes(form)) for (const g of group) out.add(g);
      }
    }
  }
  return [...out];
}

/**
 * Contacts whose SELF-REPORTED identifying words match a topic.
 *
 * "Who in my contacts has worked at a tech company?" needs no ranking and no
 * model: a card saved as "Arjun USC Tech Club" says it, and so does one with
 * company "Stripe". What it must NOT do is match a person's NAME -- somebody
 * called Tesla is not evidence of anything, and that is exactly the mistake
 * Karthik called out.
 *
 * `terms` are already-expanded synonyms; the caller owns the vocabulary. Matching
 * is whole-token, so "tech" does not match "Techachapi" and "ai" does not match
 * "Aiden".
 */
export function contactsMatchingTopic(contacts, terms, corpus = null) {
  const wanted = new Set(
    (Array.isArray(terms) ? terms : [terms]).map(norm).filter((t) => t.length >= 2),
  );
  if (wanted.size === 0) return [];
  const out = [];
  const book = Array.isArray(contacts) ? contacts : [];
  const shared = corpus ?? buildNameCorpus(book);
  for (const c of book) {
    // ONLY these three. Never full_name, first_name or last_name directly --
    // annotationTokens has already removed the name parts from full_name, which
    // is the whole point.
    const fields = [
      { where: "tagline", tokens: annotationTokens(c, shared) },
      { where: "company", tokens: tokenize(c.company) },
      { where: "title", tokens: tokenize(c.title) },
    ];
    for (const f of fields) {
      const hit = f.tokens.find((t) => wanted.has(norm(t)));
      if (hit) {
        out.push({
          id: c.id != null ? String(c.id) : null,
          name: displayName(c, shared) ?? c.full_name ?? c.fullName ?? null,
          matched: hit,
          where: f.where,
          company: c.company ?? null,
          title: c.title ?? null,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * The summary as a block for the model, in the shape of the answer Karthik
 * described. Returns "" for an empty book, so nothing invites a claim about
 * contacts that do not exist.
 */
export function addressBookBrief(summary, { topicHits = null, topic = null } = {}) {
  if (!summary || !Number(summary.total)) return "";
  const lines = [`The user has ${summary.total} contacts synced.`];

  if (summary.tags.length > 0) {
    lines.push(
      "Tags they have written into contact names themselves (these are labels " +
        "the user typed to identify people, not parts of anyone's name): " +
        summary.tags.map((t) => `${t.count} tagged "${t.label}"`).join(", ") +
        ".",
    );
  }
  if (summary.companies.length > 0) {
    lines.push(
      "Companies that appear more than once: " +
        summary.companies.map((c) => `${c.label} (${c.count})`).join(", ") +
        ".",
    );
  }
  if (summary.metros.length > 0) {
    lines.push(
      "Where their numbers are from, by area code: " +
        summary.metros.map((m) => `${m.count} in ${m.label}`).join(", ") +
        ".",
    );
  }
  if (summary.withFacts === 0) {
    lines.push(
      "There are NO saved notes or personal facts on any of them yet. Say so " +
        "plainly and offer to start adding some — that is the single most " +
        "useful next step for this user.",
    );
  } else if (typeof summary.withFacts === "number") {
    lines.push(`They have saved notes or facts on ${summary.withFacts} of them.`);
  }

  if (topic && Array.isArray(topicHits)) {
    if (topicHits.length > 0) {
      lines.push(
        `Contacts whose own tagline, company or title mentions "${topic}": ` +
          topicHits
            .slice(0, 20)
            .map((h) => `${h.name} (${h.where}: ${h.matched})`)
            .join("; ") +
          `. There are ${topicHits.length} in total.`,
      );
    } else {
      lines.push(
        `Nothing in any contact's tagline, company or title mentions "${topic}". ` +
          "Say that specifically — that their contacts carry no such label — " +
          "rather than saying you cannot see their contacts.",
      );
    }
  }

  return (
    "WHAT YOU KNOW ABOUT THIS USER'S ADDRESS BOOK, computed from their contact " +
    "cards. NEVER say you have no contacts or nothing in front of you — you " +
    "have all of this. Answer with the real numbers.\n\n" +
    lines.join("\n")
  );
}
