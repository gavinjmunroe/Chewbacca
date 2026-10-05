// @ts-nocheck
// people who: "who do I know who ...", read as a sentence and answered
// with the facets it could apply and a plain line for the ones it could not.

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db } = require("./db");
const { sayNextStep } = require("./health");
const { clayKey } = require("./resolve");

// ---------------------------------------------------------------- find
//
// The question a relationship store exists to answer: "who do I know who ...".
//
// It reads a plain sentence and pulls facets out of it rather than asking for
// flags, because the questions people actually ask are sentences. What it will
// not do is pretend. A query about a city is answered with the people it can
// find and an explicit line saying the city was ignored and why, because 0 of
// 3,229 people in this store have a location. Silently dropping the half of a
// question you cannot answer is how a demo becomes a lie: the list looks right
// and nobody notices the filter never ran.
const FACETS = [
  {
    key: "yc",
    test: /\b(yc|y ?combinator)\b/i,
    label: "Y Combinator",
    sql: `(p.company REGEXP_YC)`,
    match: (p) => /\(YC ?[SWFX]?\d|\bY Combinator\b/i.test(p.company || ""),
  },
  {
    key: "founder",
    test: /\b(founders?|founded|co-?founders?|ceos?|started a company)\b/i,
    label: "founders and CEOs",
    match: (p) => /\b(founder|co-?founder|cofounder|ceo)\b/i.test(p.role || ""),
  },
  {
    key: "hardware",
    test: /\b(hardware|robotics|semiconductors?|chips?|silicon|embedded|devices)\b/i,
    label: "hardware",
    match: (p) =>
      /\b(hardware|robotics|semiconductor|chip|silicon|embedded|devices|electrical)\b/i.test(
        `${p.company || ""} ${p.role || ""}`,
      ),
  },
  // Two different questions that share vocabulary. "Who has raised" is about
  // people whose own company took money; "who is an investor" is about people
  // who work at a fund. Conflating them returned a medical scribe at Unio
  // Health Partners for a question about funded founders, because the word
  // "Partners" is in half the company names in America.
  {
    key: "funded",
    test: /\b(raised|raising|funded|funding|pre-?seed|seed round|series [a-d]|got into y ?combinator)\b/i,
    label: "founders whose company raised",
    match: (p) =>
      /\(YC ?[SWFX]?\d|\bY Combinator\b/i.test(p.company || "") ||
      (/\b(founder|co-?founder|cofounder|ceo)\b/i.test(p.role || "") &&
        /stealth|\(YC|labs|\bAI\b|technologies|inc\b/i.test(p.company || "")),
  },
  {
    key: "investor",
    test: /\b(vcs?|investors?|angels?|venture capital|works at a fund)\b/i,
    label: "investors",
    match: (p) =>
      /\b(ventures?|capital|vc)\b/i.test(p.company || "") ||
      /\b(investor|investment|venture|partner)\b/i.test(p.role || ""),
  },
  {
    key: "private-equity",
    test: /\b(private equity|\bpe\b|buyout|growth equity)\b/i,
    label: "private equity",
    match: (p) =>
      /\b(private equity|buyout|growth equity|capital partners|capital management)\b/i.test(
        `${p.company || ""} ${p.role || ""}`,
      ),
  },
  {
    key: "stealth",
    test: /\bstealth\b/i,
    label: "stealth",
    match: (p) => /stealth/i.test(p.company || ""),
  },
];

// WHAT THIS STORE CANNOT KNOW, AND WHAT IT WOULD COST TO FIND OUT.
//
// A network question usually has one clause the local data cannot answer:
// funding stage, a hometown as opposed to a current city, a fraternity, a
// degree. Answering the rest and going quiet about that clause is the failure
// this whole command exists to avoid, so each one is named, with the reason,
// and with what it would actually take.
//
// The costs are deliberately not invented. Clay bills enrichment per record
// and does not bill search, which is measured rather than assumed: the credit
// balance did not move across hundreds of searches. The per-record price of an
// enrichment depends on the provider waterfall it runs, and a failed lookup
// still spends, so the honest thing to print is the balance, the rate the user
// can read for themselves, and the size of the job.
const CLAY_GAPS = [
  {
    key: "funding",
    test: /\b(raised|raising|funded|funding|pre-?seed|seed round|series [a-d])\b/i,
    have: "which of them work at companies whose name says YC, and every role with its start date",
    missing: "the actual round, its size, and when it closed",
    clay: "a funding lookup per company",
  },
  {
    key: "origin",
    test: /\b(from|grew up|hometown|originally)\s+[A-Z][a-z]+/,
    have: "where each person lives now",
    missing: "where they are from, which is a different field and not in a LinkedIn export",
    clay: "a profile enrichment per person to read their education and early roles",
  },
  {
    key: "fraternity",
    test: /\b(fraternity|sorority|frat|greek|society|eating club)\b/i,
    have: "which school they went to, when it is on their profile",
    missing: "the chapter or society, which LinkedIn keeps in activities and societies",
    clay: "an education enrichment per person",
  },
  {
    key: "degree",
    test: /\b(major|degree|studied|graduated|class of|my year|same year)\b/i,
    have: "the school, from your own export where you overlap",
    missing: "their degree, field of study and graduation year",
    clay: "an education enrichment per person",
  },
];

function clayAdvice(q, affected) {
  const hits = CLAY_GAPS.filter((g) => g.test.test(q));
  if (!hits.length) return;
  const key = clayKey();
  say();
  for (const g of hits) {
    say(`  ${c.yel(`Partly answered: ${g.key}.`)}`);
    say(c.dim(`    have    ${g.have}`));
    say(c.dim(`    missing ${g.missing}`));
  }
  say();
  if (key) {
    say(c.dim(`  A Clay key is configured. Search is free and already used above.`));
    say(c.dim(`  Going further needs ${hits.map((g) => g.clay).join(" and ")}, which Clay`));
    say(c.dim(`  bills per record. ${affected} people would be looked up.`));
    say(c.dim(`  Failed lookups still spend, so try a handful before all ${affected}.`));
  } else {
    say(c.dim(`  To go further, put a Clay API key in ~/.chewbacca/clay-key.`));
    say(c.dim(`  Search costs nothing. ${hits.map((g) => g.clay).join(" and ")} is billed`));
    say(c.dim(`  per record, and a failed lookup still spends. ${affected} people is the`));
    say(c.dim(`  size of the job.`));
  }
  say();
}

// Places this store cannot filter on, because nothing fills `location`. Listed
// so the gap can be named precisely rather than guessed at.
// Longest first. "new york" listed before "new york city" matches the shorter
// one and leaves "City" behind as a stray search term, which then filters on
// the word City. Alternation in JS is first-match, not longest-match, so the
// order in this list is load-bearing.
const PLACE = /\b(new york city|san francisco bay area|bay area|san francisco|new york|los angeles|nyc|sf|la\b|chicago|boston|seattle|austin|denver|miami|london|naperville|wisconsin|madison|remote|[A-Z][a-z]+, ?[A-Z]{2})\b/i;

/**
 * The words in a question that no structured filter consumed.
 *
 * This used to be computed inline purely so the output could say "ignored: X".
 * It is now the input to the evidence search as well, so it is one function:
 * the terms reported as unanswered and the terms actually searched must be the
 * same list, or the report is lying about what was tried.
 *
 * The stopword set is grammar, not domain knowledge, and that distinction comes
 * from Karthik's gather.js. There is deliberately no synonym table: a question's
 * own words work for "podcasting" and "orthodontist" without anybody predicting
 * them, and a hand-written vocabulary only ever fits the person who wrote it.
 */
function ignoredTerms(stripped, freeText) {
  return stripped
    .replace(new RegExp(PLACE.source, "gi"), " ")
    .replace(
      /\b(who|whom|what|which|do|does|did|i|me|my|know|that|is|are|am|in|at|the|a|an|of|from|with|and|or|to|for|people|anyone|someone|connections?|list|pull|up|show|find|tell|give)\b/gi,
      " ",
    )
    // MORE GRAMMAR, once these terms started being SEARCHED rather than just
    // printed. "founders who went to school with me" was searching for "went",
    // which hits any observation containing the word and contributes nothing
    // but noise to the result. Verbs of motion and being are grammar in a
    // question about people, the same way "know" and "tell" already were.
    .replace(
      /\b(went|goes|going|gone|been|being|was|were|has|have|had|get|got|also|still|any|some|their|there|they|them|his|her|he|she|we|us|our|you|your|about|like|than|then|when|where|how|why|all|both|each|other|same|such|only|own|very|can|will|would|should|could|may|might|must|shall)\b/gi,
      " ",
    )
    .replace(/[^\w ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !freeText.includes(w))
    .slice(0, 8); // a ceiling, because each term is a LIKE over every observation
}

function cmdWho(argv) {
  const { rest, flags } = parseArgs(argv);
  const q = rest.join(" ").trim();
  if (!q) die('Ask a question: people who "founders at YC companies"');

  const d = db();
  const rows = d
    .prepare(
      `SELECT p.id, p.name, p.role, p.company, p.linkedin, p.nickname, p.location,
              COALESCE(s.base_score,0) AS score
         FROM people p LEFT JOIN person_scores s ON s.person_id = p.id
        WHERE p.deleted_at IS NULL AND p.muted_at IS NULL`,
    )
    .all();

  const hits = FACETS.filter((f) => f.test.test(q));
  // Only proper nouns survive as free text. "everyone who has gotten funded"
  // contains no searchable term, and matching its words against every company
  // and role returns whatever happens to contain "assistant". A capitalised
  // word that is not the first word of the sentence is a name, a company or a
  // school, and those are the only leftovers worth filtering on.
  const stripped = q
    .replace(new RegExp(FACETS.map((f) => f.test.source).join("|"), "gi"), " ")
    .replace(new RegExp(PLACE.source, "gi"), " ");
  const freeText = stripped
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^[A-Z][a-zA-Z&.-]{2,}$/.test(w))
    .map((w) => w.replace(/[^\w&.-]/g, ""))
    .filter(Boolean);

  let out = rows;
  for (const f of hits) out = out.filter(f.match);

  // "in the past 24 months" is answerable, because every role Clay returned
  // carries the month it started and those are stored as a `career` fact. This
  // does not know what round somebody raised; it knows when they started the
  // thing, which is the part a date question actually turns on.
  // "MOVED INTO A HIGHER ROLE" is a comparison between two jobs, and the career
  // history has both with their dates. Seniority is read off the titles: an
  // intern is below an analyst is below a manager is below a director is below
  // a VP is below a chief or a founder. Somebody counts when their newest role
  // outranks their oldest one.
  let riseNote = null;
  if (/\b(higher role|more senior|moved up|promoted|stepped up|senior role)\b/i.test(q)) {
    const RANK = [
      [/\b(intern|trainee|apprentice)\b/i, 1],
      [/\b(assistant|coordinator|analyst|associate)\b/i, 2],
      [/\b(engineer|designer|manager|lead|specialist)\b/i, 3],
      [/\b(senior|principal|staff|director)\b/i, 4],
      [/\b(head of|vp|vice president|partner)\b/i, 5],
      [/\b(chief|cto|ceo|coo|cfo|founder|owner|president)\b/i, 6],
    ];
    const rank = (t) => RANK.reduce((a, [re, n]) => (re.test(t) ? Math.max(a, n) : a), 0);
    const careers = new Map(
      d.prepare(`SELECT person_id, value FROM quick_facts WHERE key='career'`).all()
        .map((r) => [r.person_id, r.value]),
    );
    const ids = new Map(
      d.prepare(`SELECT id, name FROM people WHERE deleted_at IS NULL`).all()
        .map((r) => [r.name, r.id]),
    );
    const checkable = out.filter((p) => careers.has(ids.get(p.name)));
    if (checkable.length) {
      out = checkable.filter((p) => {
        // The fact reads newest first, so the last entry is the earliest job.
        const parts = (careers.get(ids.get(p.name)) || "").split(";").map((x) => x.trim());
        if (parts.length < 2) return false;
        return rank(parts[0]) > rank(parts[parts.length - 1]);
      });
      riseNote = `${checkable.length} had two or more dated roles to compare.`;
    } else {
      riseNote = `nobody here has enough role history to say whether they moved up.`;
    }
  }

  let recencyNote = null;
  const recency = q.match(/\b(?:past|last)\s+(\d+)\s*(month|year)s?\b/i);
  if (recency) {
    const months = Number(recency[1]) * (/year/i.test(recency[2]) ? 12 : 1);
    const cut = new Date();
    cut.setMonth(cut.getMonth() - months);
    const cutStr = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}`;
    const careers = new Map(
      d.prepare(`SELECT person_id, value FROM quick_facts WHERE key='career'`).all()
        .map((r) => [r.person_id, r.value]),
    );
    const ids = new Map(
      d.prepare(`SELECT id, name FROM people WHERE deleted_at IS NULL`).all()
        .map((r) => [r.name, r.id]),
    );
    const withDates = out.filter((p) => careers.has(ids.get(p.name)));
    if (withDates.length) {
      out = withDates.filter((p) => {
        const v = careers.get(ids.get(p.name)) || "";
        return (v.match(/\((\d{4}-\d{2})/g) || []).some((m) => m.slice(1) >= cutStr);
      });
      recencyNote = `${withDates.length} had dated roles to check against the last ${months} months.`;
    } else {
      recencyNote = `nobody in this result has dated role history yet, so the time window was not applied.`;
    }
  }

  // Filter on place when the question names one and the data can answer it.
  // "New York City or San Francisco" is two places, and matching only the
  // first silently answers half the question.
  const placeAll = q.match(new RegExp(PLACE.source, "gi")) || [];
  const placeMatch = placeAll.length ? [placeAll.join(" or ")] : null;
  let placeNote = null;
  if (placeMatch) {
    const terms = [...new Set(placeAll.flatMap((pm) => PLACE_ALIASES[pm.toLowerCase()] || [pm.toLowerCase()]))];
    const withLoc = out.filter((p) => p.location && p.location.trim());
    const inPlace = withLoc.filter((p) =>
      terms.some((t) => p.location.toLowerCase().includes(t)),
    );
    // Only narrow when there is something to narrow with. Filtering a set
    // where nobody has a location returns nothing and looks like an answer.
    if (withLoc.length) {
      out = inPlace;
      const blind = rows.filter((p) => !p.location || !p.location.trim()).length;
      placeNote = `${withLoc.length} of these had a location to check; ${blind} people in the store still have none.`;
    } else {
      placeNote = `nobody in this result has a location yet, so place was not applied.`;
    }
  }
  if (freeText.length)
    out = out.filter((p) =>
      freeText.some((w) =>
        new RegExp(`\\b${w}`, "i").test(`${p.company || ""} ${p.role || ""} ${p.name}`),
      ),
    );

  // THE PART OF THE QUESTION NOTHING ANSWERED IS A SEARCH, NOT A SHRUG.
  //
  // Ported from Karthik's retrieval ladder in amber-id (`src/db/gather.js`).
  // His finding: Amber routed each question to one fixed slice of the database
  // chosen by how it was PHRASED, so "who do I know at USC" read observations
  // and "who goes to USC" read nothing. The author had data everywhere, so it
  // looked fine to him and shrugged at everybody else.
  //
  // `people who` had the same shape. It filtered the `people` table only, and
  // never once read `observations` -- which is where `people distill` and
  // `people infer --apply` write everything they learn. Inference was
  // write-only: the kit could conclude somebody went to your school, store it,
  // and then answer "who went to school with me" by ignoring it.
  //
  // So this does not route. Whatever the facets and place and free text could
  // not consume is searched against the evidence tables directly, and the
  // INVENTORY IS REPORTED INCLUDING ZEROS. "I searched 41,000 observations for
  // 'school' and 3 matched" is a fact the user can act on. "nothing answers
  // that yet" is a shrug that cannot be checked.
  const leftover = ignoredTerms(stripped, freeText);
  let evidence = null;
  if (leftover.length) {
    const like = leftover.map(() => `(o.body LIKE ? COLLATE NOCASE)`).join(" OR ");
    const args = leftover.map((w) => `%${w}%`);
    const obs = d
      .prepare(
        `SELECT DISTINCT o.person_id AS id FROM observations o
          WHERE o.deleted_at IS NULL AND o.person_id IS NOT NULL AND (${like})`,
      )
      .all(...args);
    const facts = d
      .prepare(
        `SELECT DISTINCT person_id AS id FROM quick_facts
          WHERE ${leftover.map(() => `(value LIKE ? COLLATE NOCASE)`).join(" OR ")}`,
      )
      .all(...args);
    const found = new Set([...obs, ...facts].map((r) => r.id));
    const scanned = d
      .prepare(
        `SELECT COUNT(*) AS n FROM observations WHERE deleted_at IS NULL AND person_id IS NOT NULL`,
      )
      .get().n;
    const inSet = out.filter((p) => found.has(p.id));
    evidence = {
      terms: leftover,
      scanned,
      people: found.size,
      matched: inSet.length,
      // DID THE EVIDENCE ACTUALLY DISCRIMINATE? Terms are OR'd, so one common
      // word carries the whole clause: "investors who love pickleball" matched
      // every one of 19 investors, because "love" appears all over a decade of
      // messages. Narrowing 19 to 19 and announcing it reads as a finding when
      // nothing was found, which is the same class of lie as the silent drop
      // this whole layer exists to fix.
      discriminated: inSet.length > 0 && inSet.length < out.length,
    };
    // NARROW ONLY WHEN THERE IS SOMETHING TO NARROW WITH, the same rule the
    // place filter already follows. Filtering a set where nobody has evidence
    // returns an empty list that reads like a confident answer.
    if (inSet.length) out = inSet;
  }

  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const limit = Number(flags.limit || 25);

  say();
  say(`  ${c.b(q)}`);
  const applied = [
    ...hits.map((f) => f.label),
    ...(freeText.length ? [`matching "${freeText.join(" ")}"`] : []),
  ];
  if (placeMatch) applied.push(`in ${placeMatch[0]}`);
  // WHAT THE QUESTION ASKED AND THIS DID NOT DO.
  //
  // "founders who went to school with me" answered "founders" and returned 356
  // rows. The school half contributed nothing and the output never said so, so
  // a list that looks right is the only evidence the user gets. The leftover
  // span is already computed above for free-text matching; it just was never
  // reported.
  const ignored = leftover.join(" ");
  if (recency) applied.push(`started within ${recency[1]} ${recency[2]}s`);
  say(
    c.dim(
      `  ${applied.length ? `filtered on ${applied.join(", ")}` : "no filter matched, showing everyone"}  ${c.b(String(out.length))} found`,
    ),
  );
  // THE INVENTORY, INCLUDING THE ZEROS. An answer path that cannot say what it
  // looked at can only shrug, and a shrug is indistinguishable from a bug.
  if (evidence) {
    const { terms, scanned, people, matched } = evidence;
    const what = `"${terms.join(" ")}"`;
    // SAY WHAT THE EVIDENCE IS, NOT JUST THAT THERE WAS SOME. A keyword hit in
    // a recorded fact is weaker than a role or a company, which are structured
    // fields somebody filled in. Karthik's rule is that every layer is returned
    // labelled with what it is so the weak evidence can be offered AS weak; the
    // failure it prevents is a list of twelve keyword matches reading like
    // twelve verified answers.
    if (matched && evidence.discriminated)
      say(
        c.dim(
          `  ${what} is not a field, so it was matched against ${scanned} recorded facts: ${people} people mention it, ${matched} of them here. Showing those, on that evidence alone.`,
        ),
      );
    else if (matched)
      say(
        c.yel(
          `  ${what} matched every one of these ${matched} already, so it ruled nobody out. Treat the list as answering the rest of the question only.`,
        ),
      );
    else if (people)
      say(
        c.yel(
          `  searched ${scanned} recorded facts for ${what}: ${people} people match, but none of them passed the other filters. Not narrowed.`,
        ),
      );
    else
      say(
        c.yel(
          `  searched ${scanned} recorded facts for ${what} and found nothing. Try "people distill" or "people infer --apply" to record more.`,
        ),
      );
  } else if (ignored) {
    say(c.yel(`  ignored: "${ignored}" - nothing in this store answers that yet`));
  }
  if (placeNote) say(c.dim(`  ${placeNote}`));
  if (recencyNote) say(c.dim(`  ${recencyNote}`));
  if (riseNote) say(c.dim(`  ${riseNote}`));
  say();

  for (const p of out.slice(0, limit)) {
    const who = p.nickname ? `${p.name} ${c.dim(`(${p.nickname})`)}` : p.name;
    say(
      `    ${c.b(who.padEnd(p.nickname ? 38 : 24))} ${c.cyn((p.role || "").slice(0, 24).padEnd(25))} ${(p.company || "").slice(0, 26).padEnd(27)} ${c.dim((p.location || "").slice(0, 26))}`,
    );
  }
  if (out.length > limit) say(c.dim(`    ... and ${out.length - limit} more`));
  say();
  // An empty answer from an empty store is not an answer about their network.
  if (!out.length) sayNextStep(d);
  clayAdvice(q, out.length || rows.length);

}

// What a place is called depends on who is saying it. "SF" and "San Francisco
// Bay Area" and "Bay Area" are one answer to "where do you live"; LinkedIn
// writes whichever it likes, so a literal match on the user's word finds a
// third of the people it should.
const PLACE_ALIASES = {
  "new york city": ["new york"],
  "san francisco bay area": ["bay area", "san francisco"],
  sf: ["san francisco", "bay area"],
  "san francisco": ["san francisco", "bay area"],
  "bay area": ["bay area", "san francisco"],
  nyc: ["new york"],
  "new york": ["new york"],
  "new york city": ["new york"],
  la: ["los angeles"],
  "los angeles": ["los angeles"],
  boston: ["boston"],
  seattle: ["seattle"],
  austin: ["austin"],
  chicago: ["chicago"],
  london: ["london"],
};

module.exports = {
  cmdWho,
};
