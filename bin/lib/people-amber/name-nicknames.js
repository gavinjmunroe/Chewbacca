/**
 * NATE IS NATHAN.
 *
 * Two cards for one man sat in the same address book -- "Nate Kaplan" from
 * Apple with the company field "PWC", and "Nathan Kaplan (US)" from Google with
 * an address at pwc.com -- and nothing in the system connected them, because
 * every rule that could have connected them starts with "the same name" and
 * those are not the same string.
 *
 * A NICKNAME IS NOT A FUZZY MATCH. Levenshtein distance would pair "Nate" with
 * "Kate" long before it paired it with "Nathan", which is six edits away. The
 * relation is lexical, not metric: English has a closed, well-known set of
 * short forms, and a table of them is exact where it fires and silent where it
 * does not. That is the right trade for something that decides whether two
 * people are one person.
 *
 * AMBIGUITY IS KEPT, NOT RESOLVED. "Nate" is short for Nathan and for
 * Nathaniel, and those are two different names. So a token maps to a SET of
 * roots and two tokens agree when their sets intersect: nate~nathan, and
 * nate~nathaniel, but nathan and nathaniel never agree with each other. A
 * single canonical form per token would have quietly merged them.
 *
 * A NICKNAME MATCH IS WEAKER THAN AN EXACT ONE and the callers are told which
 * they got. `nameRelation` returns "exact" or "nickname", and every caller here
 * demands more corroboration for the second.
 *
 * PURE. Strings in, strings out.
 */

/**
 * Each row is one name and its short forms; the FIRST entry is the root.
 *
 * A form that belongs to two names appears in both rows on purpose -- that is
 * what makes "nate" ambiguous rather than wrongly certain.
 */
const GROUPS = [
  ["abigail", "abby", "abbie", "gail"],
  ["alexander", "alex", "alec", "xander", "sandy"],
  ["alexandra", "alex", "alexa", "lexi", "sasha"],
  ["andrew", "andy", "drew"],
  ["anthony", "tony", "ant"],
  ["benjamin", "ben", "benji", "benny"],
  ["bradley", "brad"],
  ["cameron", "cam"],
  ["charles", "charlie", "chuck", "chas"],
  ["christian", "chris"],
  ["christina", "chris", "tina", "christy", "chrissy"],
  ["christopher", "chris", "topher", "kit"],
  ["daniel", "dan", "danny"],
  ["david", "dave", "davey"],
  ["deborah", "deb", "debbie", "debra"],
  ["dennis", "denny"],
  ["donald", "don", "donnie"],
  ["douglas", "doug"],
  ["edward", "ed", "eddie", "ted", "teddy", "ned"],
  ["elizabeth", "liz", "lizzie", "beth", "betty", "eliza", "libby", "betsy"],
  ["frederick", "fred", "freddie", "fritz"],
  ["gregory", "greg", "gregg"],
  ["gerald", "gerry", "jerry"],
  ["harold", "harry", "hal"],
  ["jacob", "jake"],
  ["james", "jim", "jimmy", "jamie"],
  ["jeffrey", "jeff", "geoff"],
  ["jennifer", "jen", "jenny", "jenn"],
  ["jessica", "jess", "jessie"],
  ["john", "johnny", "jack", "jon"],
  ["jonathan", "jon", "jonny", "johnny"],
  ["joseph", "joe", "joey"],
  ["joshua", "josh"],
  ["katherine", "kathryn", "catherine", "kate", "katie", "kathy", "cathy", "kat", "katy"],
  ["kenneth", "ken", "kenny"],
  ["lawrence", "larry", "laurence", "laurie"],
  ["leonard", "leo", "lenny", "len"],
  ["margaret", "maggie", "meg", "peggy", "marge", "margie"],
  ["matthew", "matt", "matty"],
  ["michael", "mike", "mikey", "mick", "micky"],
  ["nathan", "nate"],
  ["nathaniel", "nate", "nat"],
  ["nicholas", "nick", "nicky", "nico"],
  ["patricia", "pat", "patty", "trish", "tricia"],
  ["patrick", "pat", "paddy"],
  ["peter", "pete"],
  ["philip", "phillip", "phil"],
  ["rebecca", "becca", "becky", "bex"],
  ["richard", "rich", "rick", "ricky", "richie", "dick"],
  ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["ronald", "ron", "ronnie"],
  ["russell", "russ"],
  ["samuel", "sam", "sammy"],
  ["samantha", "sam", "sammy"],
  ["stephen", "steven", "steve", "stevie"],
  ["susan", "sue", "susie", "suzy", "suzanne"],
  ["theodore", "theo", "ted", "teddy"],
  ["thomas", "tom", "tommy"],
  ["timothy", "tim", "timmy"],
  ["vincent", "vince", "vinny"],
  ["victoria", "vicky", "vicki", "tori"],
  ["william", "will", "bill", "billy", "willy", "liam"],
  ["zachary", "zach", "zack", "zak"],
];

/** token -> the set of full names it can be short for. */
const ROOTS = new Map();
for (const group of GROUPS) {
  const root = group[0];
  for (const form of group) {
    let set = ROOTS.get(form);
    if (!set) ROOTS.set(form, (set = new Set()));
    set.add(root);
  }
}

/**
 * Every full name a token could be.
 *
 * A token that is not in the table is only itself, which is the answer for
 * surnames and for every name the table has never heard of.
 */
export function rootsOf(token) {
  const t = String(token ?? "").trim().toLowerCase();
  if (!t) return new Set();
  const known = ROOTS.get(t);
  return known ? new Set(known) : new Set([t]);
}

/** "exact" when the tokens are the same string, "nickname" when they can be the same person, else null. */
export function tokenRelation(a, b) {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  if (!x || !y) return null;
  if (x === y) return "exact";
  const rx = rootsOf(x);
  for (const r of rootsOf(y)) if (rx.has(r)) return "nickname";
  return null;
}

/** Longest name first, so a merge keeps "Nathan" rather than "Nate". */
export function isShortFormOf(short, full) {
  return tokenRelation(short, full) === "nickname" && String(short).length < String(full).length;
}

const MAX_TOKENS = 4;

/**
 * How two normalized name keys relate.
 *
 * A key is space-joined, lowercased, sorted tokens -- the form the duplicate
 * detector already builds. Sorted means position carries no information, so
 * matching is a bipartite assignment rather than a zip: every token on the left
 * has to pair with a distinct token on the right. With names this short an
 * exhaustive search is instant and, unlike a greedy pass, it cannot fail to
 * find a pairing that exists.
 *
 * Returns "exact" only when every pair is identical, "nickname" when a full
 * pairing exists but at least one pair needed the table, and null otherwise --
 * including when the token counts differ, because "John Smith" and "John Smith
 * Jr" are not automatically the same man.
 */
export function nameRelation(keyA, keyB) {
  const a = String(keyA ?? "").split(" ").filter(Boolean);
  const b = String(keyB ?? "").split(" ").filter(Boolean);
  if (a.length === 0 || a.length !== b.length) return null;
  if (a.join(" ") === b.join(" ")) return "exact";
  // Beyond a handful of tokens this is not a person's name, it is a label that
  // survived splitting. Demand the exact match that was already ruled out.
  if (a.length > MAX_TOKENS) return null;

  const used = new Array(b.length).fill(false);
  let loose = false;

  const assign = (i) => {
    if (i === a.length) return true;
    for (let j = 0; j < b.length; j += 1) {
      if (used[j]) continue;
      const rel = tokenRelation(a[i], b[j]);
      if (!rel) continue;
      used[j] = true;
      const before = loose;
      if (rel === "nickname") loose = true;
      if (assign(i + 1)) return true;
      loose = before;
      used[j] = false;
    }
    return false;
  };

  if (!assign(0)) return null;
  return loose ? "nickname" : "exact";
}

/**
 * Every key this name could also be filed under.
 *
 * Used for BUCKETING, not for deciding. Two rows only ever get compared if they
 * share a bucket, so "Nate Kaplan" has to be findable under "kaplan nathan" as
 * well as under itself or it never meets "Nathan Kaplan" at all. The cross
 * product is capped because a name of four nickname tokens would otherwise
 * generate more keys than it is worth.
 */
export function variantKeysOf(nameKey) {
  const tokens = String(nameKey ?? "").split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  let combos = [[]];
  for (const t of tokens) {
    const roots = [...rootsOf(t)].sort();
    const next = [];
    for (const combo of combos) {
      for (const r of roots) {
        next.push([...combo, r]);
        if (next.length >= 12) break;
      }
      if (next.length >= 12) break;
    }
    combos = next;
  }
  const out = new Set([tokens.join(" ")]);
  for (const combo of combos) out.add([...combo].sort().join(" "));
  return [...out];
}
