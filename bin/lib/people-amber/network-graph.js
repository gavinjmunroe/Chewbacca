/**
 * A PERSONAL NETWORK GRAPH HAS THE PERSON IN IT.
 *
 * What this replaced drew edges only BETWEEN contacts, from two rules: same
 * company, same email address domain. On a real 966-contact address book that
 * produced a screenful of unconnected dots with one dense blob in the corner,
 * and the reaction it earned was the correct one -- it is not a picture of
 * somebody's network, it is a picture of which of their contacts happen to
 * work together.
 *
 * THREE THINGS WERE WRONG, and only the third is about drawing:
 *
 *   THE OWNER WAS NOT A NODE. Every contact in the book is connected to the
 *   person whose book it is. That is the one edge that always exists, it is
 *   the reason the record exists at all, and it was the only edge not drawn.
 *
 *   CLUSTERS WERE COMPLETE GRAPHS. Thirty people sharing a school's mail
 *   domain emitted 435 edges, one per pair. A cluster is now a GROUP: a label
 *   and a membership list, which the client colors rather than fences.
 *
 *   NOTHING WAS WEIGHTED BY THE RELATIONSHIP. contact_channel_stats and
 *   contact_scores know who this person actually talks to. None of it reached
 *   the graph, so every dot looked equally important, which means none did.
 *
 * TWO CARDS FOR ONE PERSON ARE ONE NODE. An address book assembled from Apple
 * and Google contains the same human twice, spelled two ways -- "Nate Kaplan"
 * with the company PWC, "Nathan Kaplan" with an address at pwc.com. Drawn as
 * two dots that is not a smaller mistake than a wrong edge: it is the network
 * claiming you know two people you do not. `foldDuplicates` collapses them on
 * evidence only, and every folded node names the cards it stands for.
 *
 * PURE. Contacts and stats in, nodes and edges out. No database, no network.
 */

import { nameRelation, variantKeysOf } from "./name-nicknames.js";
import { classifyContact } from "./contact-kind.js";
import { originsOf } from "./contact-origin.js";

const OWNER_ID = "me";

/** Reserved so a company literally called "Places" cannot collide with it. */
export const PLACES_KEY = "__places";

const lower = (v) => String(v ?? "").trim().toLowerCase();

/** Employers that are not a shared workplace. */
const GENERIC_ORGS = new Set([
  "self", "self employed", "self-employed", "freelance", "retired", "student",
  "unemployed", "n/a", "na", "none", "home", "personal",
]);

/**
 * Mail domains that say nothing about who somebody works with.
 *
 * Without this, every gmail.com address in the book becomes one cluster of
 * four hundred strangers -- which is worse than no edge at all, because it
 * asserts a relationship that is not there.
 */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com",
  "comcast.net", "sbcglobal.net", "verizon.net", "att.net", "cox.net",
]);

export function emailDomainOf(email) {
  const at = String(email ?? "").lastIndexOf("@");
  if (at < 0) return null;
  const d = lower(String(email).slice(at + 1));
  if (!d || !d.includes(".")) return null;
  return FREEMAIL.has(d) ? null : d;
}

export function organizationOf(contact) {
  const org = lower(contact?.company ?? contact?.organization ?? contact?.metadata?.company);
  if (!org || GENERIC_ORGS.has(org)) return null;
  return org;
}

/**
 * How strongly this person is tied to the owner, in [0, 1].
 *
 * Recency leads, because a network graph is read in the present tense: the
 * person you spoke to this week is the one you are looking for. Frequency and
 * the sheer existence of a channel fill in behind it.
 *
 * A contact with no interaction history scores above zero on purpose. They are
 * still in the book, they are still someone's contact, and a freshly imported
 * address book with no history yet must not render as nine hundred invisible
 * nodes.
 */
export function tieStrength(stat, { now = Date.now() } = {}) {
  const FLOOR = 0.12;
  if (!stat) return FLOOR;

  const last = stat.last_at ?? stat.last_interaction_at ?? null;
  const t = last ? Date.parse(last) : NaN;
  let recency = 0;
  if (Number.isFinite(t)) {
    const days = Math.max(0, (now - t) / 86_400_000);
    recency = Math.pow(0.5, days / 90); // half-life of a quarter
  }

  const n = Number(stat.count_90d ?? 0);
  const frequency = n > 0 ? Math.min(1, Math.log1p(n) / Math.log(31)) : 0;

  const score = 0.6 * recency + 0.4 * frequency;
  return Math.max(FLOOR, Math.min(1, FLOOR + (1 - FLOOR) * score));
}

/**
 * Fold a company name and a mail domain onto the same key when they are the
 * same company.
 *
 * "PWC" arrived from Apple as a company field on two cards; "pwc.com" arrived
 * from Google as an email domain on five others. Those are one employer and
 * they were drawn as two unrelated clusters, with what is very likely the same
 * person ("Nate Kaplan", "Nathan Kaplan") sitting in each.
 *
 * The key is the significant label: the second-level name of a domain, or the
 * company name reduced to letters and digits. It is deliberately crude -- it
 * will not fold "PwC" onto "pricewaterhousecoopers.com" -- but it is exact
 * where it fires, and a crude fold that is always right beats a clever one
 * that occasionally merges two different firms.
 */
export function clusterKeyOf({ company = null, domain = null }) {
  if (domain) {
    const parts = String(domain).toLowerCase().split(".").filter(Boolean);
    if (parts.length < 2) return parts[0] ?? null;
    // The significant label is the one directly before the public suffix:
    // "pwc" in pwc.com, "ipsd" in k12.ipsd.org, "acme" in acme.co.uk. A short
    // list of two-part suffixes is enough -- anything not on it is treated as
    // a single-label suffix, which is right for every ordinary domain.
    const TWO_PART = new Set([
      "co.uk", "ac.uk", "org.uk", "gov.uk", "net.uk", "sch.uk",
      "com.au", "net.au", "org.au", "edu.au", "gov.au",
      "co.nz", "co.jp", "or.jp", "ne.jp", "ac.jp",
      "co.in", "co.za", "com.br", "com.mx", "com.sg",
    ]);
    const lastTwo = parts.slice(-2).join(".");
    const idx = TWO_PART.has(lastTwo) ? parts.length - 3 : parts.length - 2;
    return parts[idx] ?? parts[0] ?? null;
  }
  if (company) {
    const k = String(company).toLowerCase().replace(/[^a-z0-9]/g, "");
    return k || null;
  }
  return null;
}

const digitsOf = (v) => String(v ?? "").replace(/\D+/g, "").slice(-10);

/** Every address on a card, however the row happens to carry them. */
export function emailsOf(contact) {
  const raw = Array.isArray(contact?.emails)
    ? contact.emails
    : String(contact?.emails ?? "").split(/[,;|\s]+/);
  const out = new Set();
  for (const e of raw) {
    const v = lower(e);
    if (v.includes("@")) out.add(v);
  }
  return out;
}

/** Every phone on a card, normalized to its last ten digits. */
export function phonesOf(contact) {
  const raw = [
    contact?.phone,
    contact?.phone_primary,
    contact?.phone_primary_normalized,
    ...(Array.isArray(contact?.phoneNumbers) ? contact.phoneNumbers : []),
    ...String(contact?.phones_all ?? "").split(/[,;|]/),
  ];
  const out = new Set();
  for (const p of raw) {
    const d = digitsOf(p);
    if (d.length === 10) out.add(d);
  }
  return out;
}

/**
 * The name, reduced to something two cards can be compared on.
 *
 * PARENTHESES COME OFF FIRST. A Google export writes "Nathan Kaplan (US)" and
 * an Apple one writes "Nate Kaplan"; keeping the "(US)" makes those a
 * two-token name and a three-token name, which no rule here will ever pair.
 * The parenthetical is a label somebody's tooling added, not part of anyone's
 * name, and it is the single most common reason two cards for one person look
 * unrelated.
 */
/** The name without the label an exporter bolted onto it. */
export function cleanName(name) {
  return String(name ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function nameKeyOf(name) {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Every employer this card points at, company field and mail domains alike. */
export function employerKeysOf(contact) {
  const out = new Set();
  const org = organizationOf(contact);
  if (org) {
    const k = clusterKeyOf({ company: org });
    if (k) out.add(k);
  }
  for (const e of emailsOf(contact)) {
    const d = emailDomainOf(e);
    if (!d) continue;
    const k = clusterKeyOf({ domain: d });
    if (k) out.add(k);
  }
  return out;
}

const overlaps = (a, b) => {
  for (const v of a) if (b.has(v)) return true;
  return false;
};

/**
 * COLLAPSE THE SAME PERSON INTO ONE DOT.
 *
 * Two rules, and nothing softer than these:
 *
 *   SHARED IDENTITY. The same mobile number or the same email address. One
 *   human owns one mailbox; this is the rule that needs no second opinion.
 *
 *   SAME NAME AT THE SAME EMPLOYER. The names agree exactly or through the
 *   nickname table, AND the two cards point at one company -- by its name on
 *   one and its mail domain on the other, which is exactly how Apple and
 *   Google each describe the same job. Neither half is enough alone: two
 *   people at one firm share an employer, and two strangers share a first
 *   name, but one Nathan Kaplan at PWC and one Nate Kaplan at PWC in a
 *   nine-hundred-card book is one man.
 *
 * A NICKNAME MATCH NEVER STANDS ON ITS OWN. "Nate" and "Nathan" with no shared
 * employer stay two dots, because outside the coincidence of a shared workplace
 * they are simply two names.
 *
 * The survivor is the fuller card, and it carries the other's name in
 * `aliases` so a merge is always visible rather than inferred.
 */
export function foldDuplicates(contacts) {
  const rows = (contacts ?? []).filter((c) => c && c.id != null);
  const prepared = rows.map((c) => ({
    id: String(c.id),
    row: c,
    name: String(c.full_name ?? c.name ?? "").trim(),
    key: nameKeyOf(c.full_name ?? c.name ?? ""),
    emails: emailsOf(c),
    phones: phonesOf(c),
    employers: employerKeysOf(c),
  }));

  const parent = new Map(prepared.map((p) => [p.id, p.id]));
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) {
      const next = parent.get(x);
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (x, y) => {
    const a = find(x);
    const b = find(y);
    if (a !== b) parent.set(a, b);
  };

  // ── shared identity ───────────────────────────────────────────────────────
  const byKey = new Map();
  for (const p of prepared) {
    for (const e of p.emails) {
      const k = `e:${e}`;
      const first = byKey.get(k);
      if (first) union(p.id, first);
      else byKey.set(k, p.id);
    }
    for (const ph of p.phones) {
      const k = `p:${ph}`;
      const first = byKey.get(k);
      if (first) union(p.id, first);
      else byKey.set(k, p.id);
    }
  }

  // ── same name at the same employer ────────────────────────────────────────
  //
  // Bucketed by every key the name could be filed under, so "Nate Kaplan" and
  // "Nathan Kaplan" meet. A bucket that grows past a few dozen is a placeholder
  // name rather than a person and is left alone.
  const nameBuckets = new Map();
  for (const p of prepared) {
    if (!p.key || p.employers.size === 0) continue;
    for (const variant of variantKeysOf(p.key)) {
      const list = nameBuckets.get(variant);
      if (list) list.push(p);
      else nameBuckets.set(variant, [p]);
    }
  }
  for (const list of nameBuckets.values()) {
    if (list.length < 2 || list.length > 24) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.id === b.id) continue;
        if (!nameRelation(a.key, b.key)) continue;
        if (!overlaps(a.employers, b.employers)) continue;
        union(a.id, b.id);
      }
    }
  }

  // ── one row per person ────────────────────────────────────────────────────
  const clusters = new Map();
  for (const p of prepared) {
    const root = find(p.id);
    const list = clusters.get(root);
    if (list) list.push(p);
    else clusters.set(root, [p]);
  }

  const merged = [];
  for (const list of clusters.values()) {
    if (list.length === 1) {
      const only = list[0];
      merged.push({
        ...only.row,
        id: only.id,
        ids: [only.id],
        aliases: [],
        mergedCount: 1,
        sources: [only.row.source].filter(Boolean),
      });
      continue;
    }
    // The fuller card survives: more channels, then a longer written-out name
    // ("Nathan" over "Nate"), then the lowest id so the answer never wobbles.
    const ranked = list.slice().sort((x, y) => {
      const cx = x.emails.size + x.phones.size + (organizationOf(x.row) ? 1 : 0);
      const cy = y.emails.size + y.phones.size + (organizationOf(y.row) ? 1 : 0);
      if (cx !== cy) return cy - cx;
      const lx = cleanName(x.name).length;
      const ly = cleanName(y.name).length;
      if (lx !== ly) return ly - lx;
      return x.id.localeCompare(y.id);
    });
    const keep = ranked[0];
    // WHICH RECORD SURVIVES AND WHICH NAME IS SHOWN ARE TWO QUESTIONS.
    //
    // The survivor is the card with the most on it, because that is the record
    // everything else hangs off. But the fullest card is often the sparsest
    // NAME: the Apple card carried a phone and a company and said "Nate", the
    // Google card carried only an address and said "Nathan Kaplan (US)", and
    // letting the record decide the label put "Nate Kaplan" on screen. The
    // name is picked on its own terms -- the longest written-out form, once
    // the exporter's parenthetical is off it.
    //
    // The parenthetical is only dropped here, where two spellings had to be
    // chosen between anyway. An unmerged card keeps whatever the user actually
    // has written on it, because a label they typed themselves may be the only
    // thing telling two people apart.
    const display =
      ranked
        .map((p) => cleanName(p.name))
        .filter(Boolean)
        .sort((x, y) => y.length - x.length || x.localeCompare(y))[0] || keep.name;
    const emails = new Set();
    const phones = new Set();
    for (const p of ranked) {
      for (const e of p.emails) emails.add(e);
      for (const ph of p.phones) phones.add(ph);
    }
    // Every other spelling this dot stands for. A name that only differed by
    // the parenthetical is not another spelling, it is the same name.
    const aliases = [
      ...new Set(ranked.map((p) => p.name).filter((n) => n && cleanName(n) !== display)),
    ];
    merged.push({
      ...keep.row,
      id: keep.id,
      ids: ranked.map((p) => p.id),
      full_name: display,
      name: display,
      emails: [...emails],
      phoneNumbers: [...phones],
      company: ranked.map((p) => p.row.company ?? p.row.metadata?.company).find(Boolean) ?? null,
      title: ranked.map((p) => p.row.title).find(Boolean) ?? null,
      city: ranked.map((p) => p.row.city).find(Boolean) ?? null,
      aliases,
      mergedCount: ranked.length,
      // EVERY CARD'S SOURCE, not just the survivor's. The whole reason two
      // cards became one person is that they came from two different places,
      // so keeping only the winner's label throws away the most interesting
      // thing the merge just learned -- and it is the thing the outer field is
      // arranged by.
      sources: [...new Set(ranked.map((p) => p.row.source).filter(Boolean))],
    });
  }
  return merged;
}

/**
 * Is this contact card the owner's own?
 *
 * An address book usually contains its owner. Drawn as an ordinary contact it
 * is a second "you" floating somewhere in the graph, connected to yourself,
 * which is both wrong and slightly unsettling to look at. It is also the card
 * most likely to carry every domain the person has ever used, so it silently
 * joins every group it touches.
 *
 * FOUR WAYS IN, three of them identity and one of them deliberately narrow:
 *
 *   linked_amber_id equal to the owner's. The strongest possible statement,
 *   made by the system itself.
 *
 *   A phone that normalizes to one of the owner's.
 *
 *   An address that is one of the owner's own -- a sign-in identity or a
 *   connected mailbox.
 *
 *   THE NAME, and only under conditions that make it safe: it matches the name
 *   on the owner's Amber profile exactly, no other card in the book carries
 *   that name, and the card holds no phone number that is NOT the owner's. The
 *   last clause is what keeps a father and son apart -- a second Karthik
 *   Devarakonda with his own mobile on the card is a different man and stays a
 *   dot. Sharing a surname is never enough; sharing the whole name, uniquely,
 *   with nothing contradicting it, is how the "me" card Apple gives everybody
 *   actually presents, and leaving it drawn was the complaint.
 */
export function isOwnCard(
  contact,
  {
    ownerPhone = null,
    ownerPhones = [],
    ownerEmails = [],
    ownerAmberId = null,
    ownerName = null,
    nameIsUnique = false,
  } = {},
) {
  if (ownerAmberId && contact?.linked_amber_id && String(contact.linked_amber_id) === String(ownerAmberId)) {
    return true;
  }

  const mine = new Set(
    [ownerPhone, ...(ownerPhones ?? [])].map(digitsOf).filter((d) => d.length === 10),
  );
  const theirs = phonesOf(contact);
  if (mine.size && overlaps(theirs, mine)) return true;

  const myMail = new Set((ownerEmails ?? []).map((e) => lower(e)).filter((e) => e.includes("@")));
  if (myMail.size && overlaps(emailsOf(contact), myMail)) return true;

  if (ownerName && nameIsUnique) {
    const key = nameKeyOf(ownerName);
    if (key && key === nameKeyOf(contact?.full_name ?? contact?.name)) {
      // A phone that is not one of mine means this is somebody else with my name.
      for (const p of theirs) if (!mine.has(p)) return false;
      return true;
    }
  }
  return false;
}

/**
 * Build the graph.
 *
 * `contacts` are the owner's rows; `statsById` maps contact id to a rolled-up
 * interaction stat. Returns `{ nodes, edges, groups, stats }` with the owner
 * first.
 *
 * GROUPS ARE MEMBERSHIP, NOT PLACE. A shared employer or school used to be a
 * hub the client drew a ring around, and a ring is a claim about everything
 * inside it -- so the moment the layout dropped an unrelated person in that
 * circle, the picture asserted a colleague who was not one. A group is now a
 * label and a list of ids. The client colors its members and highlights them on
 * demand; where a dot sits says nothing about who it works for.
 *
 * A PERSON MAY BELONG TO SEVERAL GROUPS. Somebody can be a schoolmate and a
 * colleague and a cofounder, and their addresses say so -- one at the school
 * district, one at the company. Every non-freemail domain on a card counts,
 * plus the company field.
 *
 * The hub nodes and membership edges are still emitted, unchanged, because iOS
 * reads them. Nothing on the web reads them any more.
 */
export function buildNetworkGraph(
  contacts,
  statsById = new Map(),
  {
    now = Date.now(),
    scoresById = new Map(),
    sourcesById = new Map(),
    ownerName = "You",
    ownerPhone = null,
    ownerPhones = [],
    ownerEmails = [],
    ownerAmberId = null,
    ownerProfileName = null,
  } = {},
) {
  const folded = foldDuplicates(contacts);

  const phones = [ownerPhone, ...(ownerPhones ?? [])].filter(Boolean);

  // A name is only usable as an owner signal when exactly one card carries it.
  const profileKey = nameKeyOf(ownerProfileName);
  let sameName = 0;
  if (profileKey) {
    for (const c of folded) if (nameKeyOf(c.full_name ?? c.name) === profileKey) sameName += 1;
  }
  const nameIsUnique = sameName === 1;

  // FIXPOINT, because folding the owner's own card teaches us addresses we did
  // not know were the owner's -- and a second self-card carrying one of them
  // would otherwise stay drawn. Bounded, since each pass can only add.
  let identityEmails = new Set((ownerEmails ?? []).map((e) => lower(e)).filter(Boolean));
  let identityPhones = new Set(phones.map(digitsOf).filter((d) => d.length === 10));
  const ownCardIds = new Set();
  for (let pass = 0; pass < 3; pass += 1) {
    let found = false;
    for (const c of folded) {
      if (ownCardIds.has(String(c.id))) continue;
      const own = isOwnCard(c, {
        ownerPhones: [...identityPhones],
        ownerEmails: [...identityEmails],
        ownerAmberId,
        ownerName: ownerProfileName,
        nameIsUnique,
      });
      if (!own) continue;
      ownCardIds.add(String(c.id));
      for (const e of emailsOf(c)) identityEmails.add(e);
      for (const p of phonesOf(c)) identityPhones.add(p);
      found = true;
    }
    if (!found) break;
  }

  const ownCards = folded.filter((c) => ownCardIds.has(String(c.id)));
  const rows = folded.filter((c) => !ownCardIds.has(String(c.id)));

  /**
   * Interaction totals for a folded person are the sum of their cards.
   *
   * The channel travels with the most recent timestamp rather than being
   * summed, because it answers a different question: not how much contact
   * there is, but what the last of it actually was. Saying "emailed" when the
   * last thing that happened was a meeting is the same class of overclaim as
   * saying "spoke" for a thread somebody was CC'd on.
   */
  const statFor = (c) => {
    let last = null;
    let channel = null;
    let count = 0;
    let any = false;
    for (const id of c.ids ?? [String(c.id)]) {
      const s = statsById.get?.(id) ?? statsById[id] ?? null;
      if (!s) continue;
      any = true;
      const t = s.last_at ?? s.last_interaction_at ?? null;
      if (t && (!last || Date.parse(t) > Date.parse(last))) {
        last = t;
        channel = s.channel ?? null;
      }
      count += Number(s.count_90d ?? 0);
    }
    return any ? { last_at: last, count_90d: count, channel } : null;
  };

  const nodes = [
    {
      id: OWNER_ID,
      kind: "owner",
      name: ownerName,
      strength: 1,
      // Reported so a client can say "this card is you" rather than leaving
      // somebody to wonder where their own card went.
      foldedCards: ownCards.reduce((n, c) => n + (c.mergedCount ?? 1), 0),
    },
  ];
  const edges = [];
  const nodeById = new Map();

  /**
   * HOW CLOSE SOMEBODY IS, FROM THE MODEL THE REST OF AMBER ALREADY USES.
   *
   * `tieStrength` below re-derived this from raw recency and a 90-day count,
   * and it was wrong in both directions at once: a card carrying nothing but
   * the first name "Alex", with one observation five weeks old, scored 0.60
   * and sat in the owner's closest circle, while a real friend with a full
   * card and eighty interactions who had been quiet for two years scored 0.12
   * -- the absolute floor.
   *
   * contact_scores already answers this properly. It blends warmth (recency
   * and measured cadence), evidence (how many facts are actually on file) and
   * completeness (how much of the record is filled in), it is tuned through
   * scoring_params rather than through constants in this file, and it is what
   * every other ranked surface reads. The graph disagreeing with it was not a
   * second opinion, it was a bug.
   *
   * tieStrength stays as the fallback for a contact the rollup has not scored
   * yet -- a fresh import, a contact created since the last job ran -- because
   * a missing score should mean "not computed", never "not close".
   *
   * For a person assembled from several cards the score is the highest of
   * them: the merge says these are one human, so the closest reading of that
   * human is the true one.
   */
  const strengthFor = (c, stat) => {
    let best = null;
    for (const id of c.ids ?? [String(c.id)]) {
      const v = scoresById.get?.(id) ?? scoresById[id];
      const n = Number(v);
      if (Number.isFinite(n) && (best === null || n > best)) best = n;
    }
    if (best === null) return tieStrength(stat, { now });
    return Math.max(0, Math.min(1, best));
  };

  for (const c of rows) {
    const id = String(c.id);
    const stat = statFor(c);
    const strength = strengthFor(c, stat);
    const name =
      String(c.full_name ?? c.name ?? "").trim() ||
      [c.first_name ?? c.firstName, c.last_name ?? c.lastName]
        .filter(Boolean).join(" ").trim() ||
      "Unnamed";

    const node = {
      id,
      kind: "contact",
      name,
      company: c.company ?? c.metadata?.company ?? null,
      title: c.title ?? null,
      city: c.city ?? null,
      strength,
      lastAt: stat?.last_at ?? null,
      // "email" | "calendar" | "message" | "note", or null when the rollup has
      // a timestamp but no channel breakdown for it yet.
      lastChannel: stat?.channel ?? null,
      count90d: Number(stat?.count_90d ?? 0),
      // What this dot stands for, when it stands for more than one card.
      aliases: c.aliases ?? [],
      mergedCount: c.mergedCount ?? 1,
      // "person" or "place". A dentist's office is a contact, not somebody you
      // know, and lumping the two together is a third of the picture reading
      // as noise. See src/lib/contact-kind.js.
      entity: classifyContact(c),
      // WHERE THIS PERSON CAME INTO THE BOOK FROM, best first. The outer field
      // of the graph is ordered by this, because for somebody with no
      // interaction history it is the only true thing left to order by.
      // A merged person carries every card's origins.
      origins: originsOf([
        ...(c.ids ?? [String(c.id)]).flatMap((cid) => sourcesById.get?.(cid) ?? sourcesById[cid] ?? []),
        ...(c.sources ?? [c.source]),
      ]),
      groupKeys: [],
    };
    nodes.push(node);
    nodeById.set(id, node);

    edges.push({ fromId: OWNER_ID, toId: id, kind: "knows", weight: strength, label: null });
  }

  // ── every group a person belongs to ───────────────────────────────────────
  //
  // Keyed by the significant label, so a company field and a mail domain for
  // the same employer land in one group. Each group remembers the nicest name
  // it saw: a typed company name reads better than a domain.
  const groups = new Map(); // key -> { key, label, kind, members:Map, sawCompany }

  const join = (key, label, kind, contact) => {
    if (!key) return;
    let g = groups.get(key);
    if (!g) {
      g = { key, label, kind, members: new Map(), sawCompany: kind === "organization" };
      groups.set(key, g);
    }
    // A human-typed company name beats a domain as the label.
    if (kind === "organization" && !g.sawCompany) {
      g.label = label;
      g.kind = "organization";
      g.sawCompany = true;
    }
    g.members.set(String(contact.id), contact);
  };

  for (const c of rows) {
    const org = organizationOf(c);
    if (org) join(clusterKeyOf({ company: org }), c.company ?? c.metadata?.company ?? org, "organization", c);

    const seenDomains = new Set();
    for (const e of emailsOf(c)) {
      const d = emailDomainOf(e);
      if (!d || seenDomains.has(d)) continue;
      seenDomains.add(d);
      join(clusterKeyOf({ domain: d }), d, "domain", c);
    }
  }

  // ── the one group that is not an employer ─────────────────────────────────
  //
  // Businesses, schools, gyms, surgeries, no-reply mailboxes. Given a key of
  // its own so it can never collide with a real company's, and exempt from the
  // size rules below because it is a category rather than a workplace: a book
  // with eighty of these still wants one chip for them.
  const places = rows.filter((c) => nodeById.get(String(c.id))?.entity === "place");

  const out = [];
  if (places.length > 0) {
    out.push({
      key: PLACES_KEY,
      id: PLACES_KEY,
      label: "Businesses & places",
      kind: "category",
      memberCount: places.length,
      memberIds: places.map((c) => String(c.id)),
    });
    for (const c of places) nodeById.get(String(c.id))?.groupKeys.push(PLACES_KEY);
  }

  for (const g of groups.values()) {
    const members = [...g.members.values()];
    // One person is not a group, and a "group" the size of the address book is
    // a mail provider rather than a workplace.
    if (members.length < 2 || members.length > 60) continue;
    const hubId = `${g.kind === "organization" ? "org" : "dom"}:${g.key}`;
    out.push({
      key: g.key,
      id: hubId,
      label: g.label,
      kind: g.kind,
      memberCount: members.length,
      memberIds: members.map((m) => String(m.id)),
    });
    nodes.push({
      id: hubId,
      kind: g.kind,
      name: g.label,
      strength: Math.min(1, 0.3 + members.length / 60),
      memberCount: members.length,
    });
    for (const m of members) {
      const id = String(m.id);
      nodeById.get(id)?.groupKeys.push(g.key);
      edges.push({
        fromId: hubId,
        toId: id,
        kind: g.kind,
        weight: g.kind === "organization" ? 0.8 : 0.5,
        label: g.label,
      });
    }
  }

  // Biggest first, then alphabetical, so a legend built straight off this list
  // is in a stable, sensible order without the client having to sort it. The
  // category sorts ahead of the employers whatever its size, because it is the
  // one chip somebody reaches for to clear the noise.
  out.sort(
    (a, b) =>
      (a.kind === "category" ? 0 : 1) - (b.kind === "category" ? 0 : 1) ||
      b.memberCount - a.memberCount ||
      a.label.localeCompare(b.label),
  );

  return {
    nodes,
    edges,
    groups: out,
    stats: {
      people: rows.length - places.length,
      places: places.length,
      cards: (contacts ?? []).length,
      merged: rows.reduce((n, c) => n + ((c.mergedCount ?? 1) - 1), 0),
      clusters: out.length,
      edges: edges.length,
      foldedOwnCards: ownCards.reduce((n, c) => n + (c.mergedCount ?? 1), 0),
    },
  };
}
