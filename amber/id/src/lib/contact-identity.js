/**
 * Contact identity resolution — the PURE decision layer for write-time dedup.
 *
 * Every contact writer (Apple bulk sync, Google import, the OAuth scrapers, the
 * single-contact create) asks the same question: "is this record a person I
 * already have?" Before this module the answer was keyed on the SOURCE's own
 * identifier — `ON CONFLICT (owner_id, external_id)` — which is not a person
 * key. When a device reissues its contact identifiers (reinstall, new device,
 * iCloud re-sync) every contact re-inserts, and one owner's address book went
 * 2,245 → 4,162 rows across two syncs with 1,877 of the extra rows carrying the
 * SAME phone number as a row already present.
 *
 * This module answers the question from identity, not from source ids:
 *
 *   1. source key   — same source + same external id      → the same row
 *   2. phone        — any phone, last-10 digits           → merge
 *   3. email        — any email, lowercased               → merge
 *   4. fuzzy name   — folded name + a CORROBORATING signal → merge
 *
 * Nothing here touches the database. The DB layer (db/contact-identity.js)
 * supplies an index and executes the decisions, which keeps every rule in this
 * file directly testable — see lib/contact-identity.test.js.
 *
 * ── HARD INVARIANTS (each has a test) ───────────────────────────────────────
 *
 * I1. Two records that BOTH carry phones and share none of them are NEVER
 *     merged, whatever else matches. Two "Pizza Hut" rows on different lines,
 *     or two different Katies, stay two rows forever.
 * I2. A phone match whose names are incompatible does NOT merge — a household
 *     or office line shared by "Mom" and "Dad" is two people. The rejected
 *     pair is recorded as a `same_phone_as` review link instead.
 * I3. Merges are field-UNION: phones and emails union (deduped on their
 *     normalized key), blank scalars fill from the incoming record, populated
 *     scalars are never overwritten. A merge cannot lose data.
 * I4. An identical name with NO corroborating signal neither merges nor blocks:
 *     both rows are kept and the pair is logged as a review candidate for a
 *     future merge-suggestions UI.
 *
 * A wrong merge hides a real person; a missed merge only shows a duplicate. Every
 * ambiguous call in here resolves toward the duplicate.
 */

// ── Key normalization ───────────────────────────────────────────────────────

/**
 * THE DEFAULT COUNTRY CODE for a number written without one. Bare national
 * numbers are the common case in an address book ("310 555 0100"), and they carry
 * no country -- somebody has to supply it. Configurable because "somebody" is
 * whoever is deploying this, not whoever wrote it.
 */
const DEFAULT_COUNTRY_CODE =
  String(process.env.AMBER_PHONE_COUNTRY_CODE || "1").replace(/\D/g, "") || "1";

/**
 * Phone → match key: the number in full, INCLUDING its country code.
 *
 * IT USED TO BE THE LAST TEN DIGITS, and that was a security defect rather than
 * a style choice. +33612345678 (French 06) and +13612345678 (US area code 361)
 * are both real, allocatable numbers, and both keyed to 3612345678 -- so they
 * hashed identically, and identity resolution treated two strangers as one
 * person. It decided who could read shared notes and who was in which circle.
 *
 * The old comment justified last-10 as making "+13105550100", "13105550100" and
 * "3105550100" one key. That property is kept; it just does not require throwing
 * the country code away:
 *
 *   +1 (310) 555-0100  ->  13105550100     explicit country code
 *   13105550100        ->  13105550100     already prefixed
 *   3105550100         ->  13105550100     bare national, default code applied
 *   +33 6 12 34 56 78  ->  33612345678     a DIFFERENT key, which is the point
 *   0033612345678      ->  33612345678     00 is the international prefix
 *
 * WHERE IT IS STILL WRONG, and why that is the right way to be wrong: a French
 * number written bare ("0612345678") gets the default code and will not match the
 * same person written as +33. That is a MISSED DEDUPLICATION -- two contact rows
 * for one person -- which is annoying. The failure it replaces was merging two
 * different people, which is a data leak. Given a choice this function errs
 * toward "these are different people" every time.
 *
 * Shorter strings (short codes) key on their full digit string and get no country
 * code, because they are not people.
 */
export function phoneKey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null; // too short to identify a person

  // Explicitly international: a leading + or the 00 international prefix. The
  // digits already begin with the country code, so take them as they are.
  if (s.startsWith("+")) return digits;
  if (digits.startsWith("00") && digits.length > 9) return digits.slice(2);

  // Short codes stay bare -- a five-digit sender is not a person in a country.
  if (digits.length < 10) return digits;

  // Bare national number. Already carrying the default code, or needing it.
  if (digits.length === 10) return DEFAULT_COUNTRY_CODE + digits;
  if (digits.startsWith(DEFAULT_COUNTRY_CODE) &&
      digits.length === DEFAULT_COUNTRY_CODE.length + 10) {
    return digits;
  }
  // Longer than a national number and not prefixed with the default code: assume
  // whoever typed it included a country code we do not recognize, and keep it
  // whole. Wrong here means a missed match, never a merge.
  return digits;
}

/** Email → match key: trimmed + lowercased. Null unless it looks like an address. */
export function emailKey(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t.indexOf("@") < 1 || t.endsWith("@")) return null;
  return t;
}

/**
 * Strip a redundant source prefix off an external id.
 *
 * The two Google writers namespaced their ids differently: the OAuth scraper
 * wrote `google:people/c123` while the import path wrote the bare People API
 * resourceName `people/c123`. Same person, two keys, two rows in the same unique
 * index. Everything is folded onto the bare resourceName here so the two paths
 * can never double-write, including for rows already stored under the old shape.
 */
export function normalizeExternalId(source, externalId) {
  if (externalId == null) return null;
  const s = String(externalId).trim();
  if (!s) return null;
  const src = String(source || "").trim().toLowerCase();
  if (src && s.toLowerCase().startsWith(`${src}:`)) return s.slice(src.length + 1);
  return s;
}

/** Source key: "<source>:<normalized external id>", or null when either is absent. */
export function sourceKey(source, externalId) {
  const src = String(source || "").trim().toLowerCase();
  const ext = normalizeExternalId(source, externalId);
  if (!src || !ext) return null;
  return `${src}:${ext}`;
}

/** Email domain, lowercased, or null. */
export function emailDomain(email) {
  const k = emailKey(email);
  if (!k) return null;
  const d = k.split("@")[1] || "";
  return d || null;
}

// Consumer mail hosts. A shared domain here says nothing about two people being
// the same person, so it is not allowed to corroborate a name match.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "pm.me", "gmx.com", "gmx.net", "zoho.com", "fastmail.com", "hey.com",
  "duck.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "bellsouth.net", "cox.net", "charter.net", "earthlink.net", "qq.com",
  "163.com", "126.com", "sina.com", "naver.com", "hanmail.net", "daum.net",
  "nate.com", "yandex.ru", "mail.ru", "rediffmail.com", "web.de", "t-online.de",
  "orange.fr", "free.fr", "libero.it", "hotmail.fr", "yahoo.fr", "yahoo.co.jp",
]);

export function isFreemailDomain(domain) {
  return !!domain && FREEMAIL_DOMAINS.has(String(domain).toLowerCase());
}

// ── Field union (invariant I3) ──────────────────────────────────────────────

/**
 * Union phone DISPLAY strings, deduped on `phoneKey` so "+1 (310) 555-0100" and
 * "3105550100" collapse to one entry. The first spelling seen wins, so a merge
 * never rewrites how the user's own address book formatted a number. Values that
 * produce no key (extensions, "n/a") are kept verbatim if not already present —
 * dropping them would be data loss.
 */
export function unionPhoneStrings(existing = [], incoming = []) {
  const out = [...existing];
  const seen = new Set(existing.map((p) => phoneKey(p)).filter(Boolean));
  for (const p of incoming) {
    const k = phoneKey(p);
    if (k) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    } else if (p && !out.includes(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Union email strings, deduped case-insensitively, first spelling preserved. */
export function unionEmailStrings(existing = [], incoming = []) {
  const out = [...existing];
  const seen = new Set(existing.map((e) => String(e).toLowerCase()));
  for (const e of incoming) {
    const lc = String(e).toLowerCase();
    if (!seen.has(lc)) {
      seen.add(lc);
      out.push(e);
    }
  }
  return out;
}

// ── Name folding ────────────────────────────────────────────────────────────

/**
 * Fold a display name to a comparison key: lowercase, strip diacritics, drop
 * punctuation and honorifics, collapse whitespace. Non-Latin scripts (the CJK
 * names in one tester's book) pass through unchanged apart from casing and
 * spacing — NFD only decomposes what has a decomposition.
 */
export function foldName(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  // Apostrophes and quotes are DELETED, not spaced, so "O'Brien" folds to
  // "obrien" and matches a source that spelled it "OBrien" — spacing them would
  // split one surname into two tokens and break the surname comparison.
  s = s.replace(/['’`"“”]/g, "");
  // Parenthesized alternates ("Kelly Park (박소은)") keep BOTH halves; the parens
  // themselves are punctuation. Emoji / symbols / punctuation all become spaces.
  s = s.replace(/[.,_\-/\\()\[\]{}!?:;+*&#@|<>~^$%]/g, " ");
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "madam", "mx"]);
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq", "dds", "cpa"]);
  const tokens = s.split(" ").filter((t) => t && !HONORIFICS.has(t) && !SUFFIXES.has(t));
  if (tokens.length === 0) return null;
  // Re-compose: NFD above decomposed Hangul syllables into jamo (and Latin into
  // base+mark). Latin marks were stripped, so NFC here returns the composed form
  // a caller would recognize — the key must be canonical, not an artifact of the
  // decomposition pass.
  return tokens.join(" ").normalize("NFC");
}

export function nameTokens(folded) {
  return folded ? folded.split(" ").filter(Boolean) : [];
}

/**
 * Nickname equivalence groups. Deliberately modest and easy to extend: this
 * table only ever RELAXES a comparison, and it is never consulted without a
 * corroborating signal (rule 4) or an exact phone/email hit (rules 2/3), so a
 * generous group cannot on its own merge two people. Groups that mix distinct
 * formal names (Jon/John, Alexander/Alexandra) are kept SEPARATE on purpose.
 */
const NICKNAME_GROUPS = [
  ["abigail", "abby", "abbie"],
  ["alexander", "alex", "xander", "alek", "sasha"],
  ["alexandra", "alex", "alexa", "allie", "sasha"],
  ["andrew", "andy", "drew"],
  ["angela", "angie"],
  ["anthony", "tony"],
  ["barbara", "barb", "babs"],
  ["benjamin", "ben", "benji", "benny"],
  ["bernard", "bernie"],
  ["bradley", "brad"],
  ["catherine", "katherine", "kathryn", "kate", "katie", "kathy", "cathy", "cate", "kat", "katy"],
  ["charles", "charlie", "chuck", "chas"],
  ["christina", "christine", "chris", "tina", "chrissy"],
  ["christopher", "chris", "topher"],
  ["daniel", "dan", "danny"],
  ["david", "dave", "davey"],
  ["deborah", "debra", "debbie", "deb"],
  ["dennis", "denny"],
  ["donald", "don", "donnie"],
  ["douglas", "doug"],
  ["edward", "ed", "eddie", "ted", "teddy"],
  ["elizabeth", "liz", "lizzie", "beth", "betsy", "eliza", "libby", "lisbeth"],
  ["frederick", "fred", "freddie"],
  ["gregory", "greg"],
  ["jacob", "jake"],
  ["james", "jim", "jimmy", "jamie"],
  ["jeffrey", "jeff"],
  ["jennifer", "jen", "jenny", "jenn"],
  ["jonathan", "jon", "jonny"],
  ["john", "johnny", "jack", "jackie"],
  ["joseph", "joe", "joey"],
  ["joshua", "josh"],
  ["kenneth", "ken", "kenny"],
  ["lawrence", "larry", "laurence"],
  ["margaret", "maggie", "meg", "peggy", "marge"],
  ["matthew", "matt", "matty"],
  ["michael", "mike", "mikey", "mick"],
  ["nicholas", "nick", "nicky"],
  ["patricia", "pat", "patty", "tricia"],
  ["patrick", "pat", "paddy"],
  ["peter", "pete"],
  ["philip", "phillip", "phil"],
  ["rebecca", "becky", "becca"],
  ["richard", "rich", "rick", "dick", "richie"],
  ["robert", "rob", "bob", "bobby", "robbie"],
  ["ronald", "ron", "ronnie"],
  ["samuel", "sam", "sammy"],
  ["samantha", "sam", "sammy"],
  ["stephen", "steven", "steve", "stevie"],
  ["susan", "sue", "susie", "suzy"],
  ["theodore", "theo", "ted", "teddy"],
  ["thomas", "tom", "tommy"],
  ["timothy", "tim", "timmy"],
  ["victoria", "vicky", "vicki", "tori"],
  ["william", "will", "bill", "billy", "willie"],
  ["zachary", "zach", "zack"],
];

// given name → Set of group ids it belongs to (a name can be in several).
const NICKNAME_INDEX = new Map();
NICKNAME_GROUPS.forEach((group, gi) => {
  for (const name of group) {
    if (!NICKNAME_INDEX.has(name)) NICKNAME_INDEX.set(name, new Set());
    NICKNAME_INDEX.get(name).add(gi);
  }
});

/** Do two GIVEN names refer to the same person's name? Nickname- and diminutive-aware. */
export function givenNamesEquivalent(a, b) {
  if (!a || !b) return true; // nothing to contradict
  if (a === b) return true;
  const ga = NICKNAME_INDEX.get(a);
  const gb = NICKNAME_INDEX.get(b);
  if (ga && gb) {
    for (const g of ga) if (gb.has(g)) return true;
  }
  // Diminutive by truncation: "dan"/"daniel", "ann"/"anna". Bounded to a short
  // stem so "chris"/"christopher-anything" style false friends stay rare.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && short.length <= 5 && long.startsWith(short)) return true;
  return false;
}

/**
 * Can these two names belong to one person? Missing names never contradict.
 *
 * Multi-token vs multi-token: surnames must match (exactly — a surname is not
 * nicknamed) AND given names must be equivalent.
 * Single-token vs multi-token: the lone token must be equivalent to the other's
 * given name or equal to its surname ("Katie" ~ "Katie Smith", "Mom" ✗).
 */
export function namesCompatible(aFolded, bFolded) {
  if (!aFolded || !bFolded) return true;
  if (aFolded === bFolded) return true;
  const at = nameTokens(aFolded);
  const bt = nameTokens(bFolded);
  if (at.length === 0 || bt.length === 0) return true;

  if (at.length === 1 || bt.length === 1) {
    const [one, many] = at.length === 1 ? [at[0], bt] : [bt[0], at];
    if (many.length === 1) return givenNamesEquivalent(one, many[0]);
    if (givenNamesEquivalent(one, many[0])) return true;
    return one === many[many.length - 1];
  }

  const aSur = at[at.length - 1];
  const bSur = bt[bt.length - 1];
  if (aSur !== bSur) return false;
  return givenNamesEquivalent(at[0], bt[0]);
}

// ── Record facts ────────────────────────────────────────────────────────────

/**
 * Normalize any writer's record shape into the fact bundle every rule reads.
 * Accepts the union of shapes in the codebase: `{name|fullName}`,
 * `{phoneNumbers|phones|phone|phone_primary|phones_all}`, `{emails}` as an
 * array OR as the comma-joined string the `contacts` columns store.
 */
export function extractFacts(record, extra = {}) {
  const r = record || {};
  const name = _firstString(r.name, r.fullName, r.full_name);
  const folded = foldName(name);
  const tokens = nameTokens(folded);

  const phones = new Set();
  for (const raw of _collect(r.phoneNumbers, r.phones, r.phonesAll, r.phones_all)) {
    const k = phoneKey(raw);
    if (k) phones.add(k);
  }
  for (const scalar of [r.phone, r.phonePrimary, r.phone_primary]) {
    const k = phoneKey(scalar);
    if (k) phones.add(k);
  }

  const emails = new Set();
  for (const raw of _collect(r.emails, r.emailAddresses)) {
    const k = emailKey(raw);
    if (k) emails.add(k);
  }
  const scalarEmail = emailKey(r.email);
  if (scalarEmail) emails.add(scalarEmail);

  const source = _firstString(r.source) || null;
  const externalId = normalizeExternalId(source, _firstString(r.externalId, r.external_id));

  return {
    id: extra.id ?? r.id ?? null,
    name: name || null,
    nameKey: folded,
    // Canonical name bucket: first + last only, so "John Smith" and
    // "John Michael Smith" land in the same rule-4 candidate bucket.
    nameKeyCanon:
      tokens.length > 1 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : folded,
    phones,
    emails,
    company: _firstString(r.company, r.organization)?.toLowerCase() || null,
    city: _firstString(r.city, r.location)?.toLowerCase() || null,
    source,
    externalId,
    sourceKey: sourceKey(source, externalId),
    linkedAmberId: _firstString(r.linkedAmberId, r.linked_amber_id) || null,
  };
}

function _firstString(...vals) {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

// Accept arrays and comma-joined strings interchangeably (the `contacts` table
// stores phones_all / emails as comma strings; the API sends arrays).
function _collect(...vals) {
  const out = [];
  for (const v of vals) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item.value === "string") out.push(item.value);
      }
    } else if (typeof v === "string" && v.trim()) {
      out.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

/**
 * THE DEFAULT KEY TOKEN: "type|value", plaintext, in memory only.
 *
 * The index is a map from token to contact id, and nothing in the matching logic
 * ever reads a token apart -- it only compares them. That is what lets the DB
 * layer substitute a different tokenizer: `contact_identity_keys` stores
 * HMAC(pepper, value) rather than the number itself, so db/contact-identity.js
 * passes a `keyOf` that hashes, and both halves of the index -- the keys derived
 * from live contact rows and the keys read out of the table -- land in the same
 * keyspace. Callers that have no database (the payload clusterer, every unit
 * test in this file) get this one and keep working on plaintext.
 */
export const IDENTITY_KEY = (type, value) => `${type}|${value}`;

/** Every match key a record claims, tokenized by `keyOf`. */
export function factKeys(facts, keyOf = IDENTITY_KEY) {
  const keys = [];
  if (facts.sourceKey) keys.push(keyOf("source", facts.sourceKey));
  for (const p of facts.phones) keys.push(keyOf("phone", p));
  for (const e of facts.emails) keys.push(keyOf("email", e));
  return keys;
}

/** Union b into a, returning a NEW fact bundle. Never drops a value (I3). */
export function unionFacts(a, b) {
  return {
    id: a.id ?? b.id ?? null,
    name: a.name || b.name,
    nameKey: a.nameKey || b.nameKey,
    nameKeyCanon: a.nameKeyCanon || b.nameKeyCanon,
    phones: new Set([...a.phones, ...b.phones]),
    emails: new Set([...a.emails, ...b.emails]),
    company: a.company || b.company,
    city: a.city || b.city,
    source: a.source || b.source,
    externalId: a.externalId || b.externalId,
    sourceKey: a.sourceKey || b.sourceKey,
    linkedAmberId: a.linkedAmberId || b.linkedAmberId,
  };
}

// ── The invariants ──────────────────────────────────────────────────────────

/** I1: both sides carry phones and share none. */
export function phonesConflict(a, b) {
  if (a.phones.size === 0 || b.phones.size === 0) return false;
  for (const p of a.phones) if (b.phones.has(p)) return false;
  return true;
}

/**
 * Gate every merge goes through. Returns { ok, reason }.
 *   phone_conflict → I1: two known-different lines, never one person
 *   name_conflict  → I2: e.g. a household line shared by two people
 */
export function canMerge(a, b) {
  if (phonesConflict(a, b)) return { ok: false, reason: "phone_conflict" };
  if (!namesCompatible(a.nameKey, b.nameKey)) return { ok: false, reason: "name_conflict" };
  return { ok: true, reason: null };
}

/**
 * Signals that a fuzzy NAME match is really the same person (rule 4). A name
 * alone never merges — one of these must also hold.
 *
 *   company / city              — the same person, same employer or place
 *   email_domain                — a shared NON-freemail domain (same company)
 *   linked_amber_id             — both rows resolve to one verified Amber user
 *   same_source_duplicate_card  — two cards from the SAME source, identical
 *                                 folded name, and neither carries a phone or
 *                                 an email. This is Apple's own duplicate-card
 *                                 shape; nothing about them can contradict, and
 *                                 they arrived from one address book.
 */
export function corroborators(a, b) {
  const out = [];
  if (a.company && b.company && a.company === b.company) out.push("company");
  if (a.city && b.city && a.city === b.city) out.push("city");
  if (a.linkedAmberId && b.linkedAmberId && a.linkedAmberId === b.linkedAmberId) {
    out.push("linked_amber_id");
  }
  const aDomains = new Set([...a.emails].map(emailDomain).filter((d) => d && !isFreemailDomain(d)));
  if (aDomains.size) {
    for (const e of b.emails) {
      const d = emailDomain(e);
      if (d && aDomains.has(d)) {
        out.push("email_domain");
        break;
      }
    }
  }
  if (
    a.source &&
    b.source &&
    a.source === b.source &&
    a.nameKey &&
    a.nameKey === b.nameKey &&
    a.phones.size === 0 &&
    b.phones.size === 0 &&
    a.emails.size === 0 &&
    b.emails.size === 0
  ) {
    out.push("same_source_duplicate_card");
  }
  return out;
}

// ── Payload clustering (fixes single-payload duplicate cards) ────────────────

/**
 * Collapse an incoming payload onto itself BEFORE looking at the database.
 *
 * One tester's 767-row book carried 190 excess rows that all arrived in a SINGLE
 * sync: Apple duplicate cards, same name and phone, two device identifiers. No
 * DB-side rule can help — both rows are new — so the payload is clustered first.
 *
 * Greedy rather than plain union-find, deliberately: `canMerge` is not
 * transitive (A~B and B~C does not give A~C), so a blind union could chain two
 * incompatible records together through a middleman. Each record instead joins
 * the first existing cluster that (a) shares a match key with it and (b) passes
 * `canMerge` against the cluster's UNIONED facts. Payload order decides, so the
 * result is deterministic for a given payload.
 *
 * Returns [{ facts, records: [{ record, facts, index }] }] in first-seen order.
 */
export function clusterPayload(records) {
  const clusters = [];
  const byKey = new Map(); // "type|value" → cluster[]
  const byNameKey = new Map(); // folded name → cluster[]

  records.forEach((record, index) => {
    const facts = extractFacts(record);
    const keys = factKeys(facts);

    // An identical (source, external_id) is the SOURCE's own assertion that this
    // is one card — it joins unconditionally, ahead of the identity gate. Two
    // cards with one source id and contradictory phones are a contradictory
    // payload, not two people; splitting them would duplicate the row that the
    // old last-wins upsert kept as one.
    let target = null;
    if (facts.sourceKey) {
      for (const cluster of byKey.get(`source|${facts.sourceKey}`) || []) {
        target = cluster;
        break;
      }
    }
    const seen = new Set();
    if (!target) {
      for (const key of keys) {
        for (const cluster of byKey.get(key) || []) {
          if (seen.has(cluster)) continue;
          seen.add(cluster);
          if (canMerge(cluster.facts, facts).ok) {
            target = cluster;
            break;
          }
        }
        if (target) break;
      }
    }

    // Rule 4 inside the payload. Two cards can be the same person while sharing
    // NO identifier at all — the duplicate cards one address book ships with no
    // phone and no email, which share only a name. Clustering has to apply the
    // same corroborated-name rule the DB matcher does, or those pairs are only
    // ever caught on the NEXT sync (and never, if neither card is ever written
    // separately). The corroborator requirement is unchanged: a bare name match
    // still does not merge.
    if (!target) {
      for (const nameKey of [facts.nameKey, facts.nameKeyCanon]) {
        for (const cluster of (nameKey && byNameKey.get(nameKey)) || []) {
          if (seen.has(cluster)) continue;
          seen.add(cluster);
          if (!canMerge(cluster.facts, facts).ok) continue;
          if (corroborators(cluster.facts, facts).length === 0) continue;
          target = cluster;
          break;
        }
        if (target) break;
      }
    }

    if (target) {
      target.facts = unionFacts(target.facts, facts);
      target.records.push({ record, facts, index });
    } else {
      target = { facts, records: [{ record, facts, index }] };
      clusters.push(target);
    }

    // Index the cluster under every key it now claims (its own and the union's).
    for (const key of factKeys(target.facts)) {
      const list = byKey.get(key);
      if (!list) byKey.set(key, [target]);
      else if (!list.includes(target)) list.push(target);
    }
    for (const nameKey of [target.facts.nameKey, target.facts.nameKeyCanon]) {
      if (!nameKey) continue;
      const list = byNameKey.get(nameKey);
      if (!list) byNameKey.set(nameKey, [target]);
      else if (!list.includes(target)) list.push(target);
    }
  });

  return clusters;
}

// ── Matching a cluster against what the owner already has ───────────────────

/**
 * Build the in-memory index the matcher reads.
 *
 * Keys come from BOTH the `contact_identity_keys` table AND the live contact
 * rows. Deriving from rows matters for two reasons: accounts that predate the
 * keys table still match, and a key CLAIMED by one row while a second row
 * carries the same phone (the shared-line case) still surfaces both candidates,
 * so a re-sync resolves to the row with the compatible name instead of inserting
 * a third. keyOwner records who formally holds each key.
 *
 * contactRows: rows from `contacts` (snake_case columns are accepted).
 * keyRows:     [{ token, contact_id }] -- or [{ key_type, key_value, contact_id }],
 *              which is tokenized with `keyOf`. The DB layer passes tokens it has
 *              already hashed; tests pass the plaintext pair.
 * keyOf:       tokenizer, see IDENTITY_KEY. It is stored on the returned index so
 *              resolveFacts tokenizes the SAME way it was built -- getting those
 *              two out of step would make every lookup miss and every record
 *              resolve as new, which is a silent duplicate of the whole book.
 */
export function buildIdentityIndex({ contactRows = [], keyRows = [], keyOf = IDENTITY_KEY } = {}) {
  const facts = new Map();
  const byKey = new Map();
  const byNameKey = new Map();
  const keyOwner = new Map();

  const add = (map, key, id) => {
    if (!key) return;
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(id);
  };

  for (const row of contactRows) {
    const id = String(row.id);
    const f = extractFacts(row, { id });
    facts.set(id, f);
    for (const key of factKeys(f, keyOf)) add(byKey, key, id);
    add(byNameKey, f.nameKey, id);
    if (f.nameKeyCanon !== f.nameKey) add(byNameKey, f.nameKeyCanon, id);
  }

  for (const kr of keyRows) {
    const id = String(kr.contact_id);
    const key = kr.token ?? keyOf(kr.key_type, kr.key_value);
    keyOwner.set(key, id);
    // A key row for a contact we did not load (soft-deleted) still claims the
    // key — that is the point of the non-partial unique index — but it must not
    // become a merge candidate, so only index it when the row is live.
    if (facts.has(id)) add(byKey, key, id);
  }

  return { facts, byKey, byNameKey, keyOwner, keyOf };
}

const _lowestId = (ids) =>
  [...ids].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a) < String(b) ? -1 : 1;
  })[0] ?? null;

/**
 * Resolve one record (or one payload cluster) against the index.
 *
 * Returns { contactId, rule, reviewLinks } — contactId null means "insert".
 *   rule: 'source' | 'phone' | 'email' | 'name+<corroborator>'
 *   reviewLinks: [{ candidateContactId, reason }] for pairs we refused to merge
 *
 * `exclude` lets a caller re-resolve while skipping a row another cluster in the
 * same payload already claimed, so two clusters never write to one row.
 */
export function resolveFacts(facts, index, { exclude = new Set() } = {}) {
  const reviewLinks = [];
  // Tokenize exactly the way this index was built. Defaulting here rather than
  // requiring it keeps indexes built by older callers working.
  const keyOf = index.keyOf ?? IDENTITY_KEY;
  // `live` = a real candidate row; `usable` = also not already claimed by another
  // cluster in this payload. The distinction matters: an excluded row must not be
  // MERGED into twice, but it is not a refusal either, so it must not be logged as
  // one — while a row refused on identity grounds must be logged even if some
  // other cluster happens to have claimed it.
  const live = (id) => index.facts.has(String(id));
  const usable = (id) => live(id) && !exclude.has(String(id));

  // 1. Same source, same external id — definitionally the same record.
  if (facts.sourceKey) {
    const key = keyOf("source", facts.sourceKey);
    const candidates = [...(index.byKey.get(key) || [])].filter(usable);
    const owner = index.keyOwner.get(key);
    if (owner && usable(owner) && !candidates.includes(owner)) candidates.push(owner);
    if (candidates.length) {
      return { contactId: _lowestId(candidates), rule: "source", reviewLinks };
    }
  }

  // 2. Phone, then 3. email — deterministic identity keys.
  for (const [type, values, reason] of [
    ["phone", facts.phones, "same_phone_as"],
    ["email", facts.emails, "same_email_as"],
  ]) {
    const candidates = new Set();
    for (const v of values) {
      for (const id of index.byKey.get(keyOf(type, v)) || []) {
        if (live(id)) candidates.add(String(id));
      }
    }
    if (candidates.size === 0) continue;

    const mergeable = [...candidates].filter(
      (id) => usable(id) && canMerge(index.facts.get(id), facts).ok,
    );
    if (mergeable.length) {
      // I1 holds by construction for a phone hit (a shared phone is not a
      // conflict) and is enforced by canMerge for an email hit.
      return { contactId: _lowestId(mergeable), rule: type, reviewLinks };
    }
    // I2: a real match on the identifier, refused on identity. Keep both rows
    // and remember the link rather than silently dropping the signal.
    for (const id of candidates) {
      if (canMerge(index.facts.get(id), facts).ok) continue; // merely claimed, not refused
      reviewLinks.push({ candidateContactId: id, reason });
    }
  }

  // 4. Fuzzy name — only with a corroborating signal.
  const nameCandidates = new Set();
  for (const key of [facts.nameKey, facts.nameKeyCanon]) {
    for (const id of (key && index.byNameKey.get(key)) || []) {
      if (live(id)) nameCandidates.add(String(id));
    }
  }
  let bestNameOnly = null;
  for (const id of [...nameCandidates].sort((a, b) => Number(a) - Number(b))) {
    const other = index.facts.get(id);
    const gate = canMerge(other, facts);
    if (gate.ok && !usable(id)) continue; // claimed by another cluster this payload
    if (!gate.ok) {
      // Same name, incompatible identity (I1's two-Katies case). Worth a review
      // row only when the refusal was about the name; a phone conflict on an
      // identical name is a decided "different people".
      if (gate.reason === "name_conflict") bestNameOnly = bestNameOnly ?? id;
      continue;
    }
    const signals = corroborators(other, facts);
    if (signals.length) {
      return { contactId: id, rule: `name+${signals[0]}`, reviewLinks };
    }
    bestNameOnly = bestNameOnly ?? id;
  }

  // I4: identical name, nothing to back it up. Do not merge, do not block.
  if (bestNameOnly) {
    reviewLinks.push({
      candidateContactId: bestNameOnly,
      reason: "same_name_no_corroboration",
    });
  }

  return { contactId: null, rule: null, reviewLinks };
}

/**
 * Full decision pass for a payload: cluster it, then resolve each cluster.
 *
 * Two clusters can legitimately point at one existing row (e.g. one carries the
 * phone, the other the email of a row that has both). The first cluster in
 * payload order wins the row; later ones re-resolve with it excluded so a single
 * statement batch never contains two writers for one id.
 *
 * Returns { decisions, clusters } where each decision is
 *   { cluster, contactId, rule, action: 'update'|'merge'|'insert', reviewLinks }
 */
export function planPayload(records, index) {
  const clusters = clusterPayload(records);
  const claimed = new Set();
  const decisions = [];

  for (const cluster of clusters) {
    // `claimed` is passed as `exclude`, so a row another cluster already took is
    // never returned again — the re-resolve happens inside resolveFacts itself.
    const res = resolveFacts(cluster.facts, index, { exclude: claimed });
    if (res.contactId) claimed.add(String(res.contactId));
    decisions.push({
      cluster,
      contactId: res.contactId,
      rule: res.rule,
      action: res.contactId ? (res.rule === "source" ? "update" : "merge") : "insert",
      reviewLinks: res.reviewLinks,
    });
  }

  return { decisions, clusters };
}
