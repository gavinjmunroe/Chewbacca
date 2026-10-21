/**
 * THE LADDER ANSWERS THE QUESTIONS THAT USED TO GET "I DON'T HAVE ANY INFORMATION".
 *
 * Run with the rest: npm test
 *
 * Every one of these was a real reply from a real tester, against an account
 * holding 1,231 synced contacts:
 *
 *   "Who do I know that goes to USC?"   -> "I don't have any information."
 *   "Who do I know in my contacts?"     -> "I don't have any information."
 *   "How many people do I know?"        -> "I don't have any information."
 *   "Do I know anyone in New York?"     -> "I don't have any information."
 *   "Whose birthday is it today?"       -> "I don't know, you didn't tell me."
 *
 * None of those were true of the database. They were true of the SLICE the
 * question's phrasing happened to route to. So the test that matters most here
 * is `termsFrom`: it must pull usable terms out of a sentence with no vocabulary
 * table behind it, because a table is what made the app work for its author and
 * nobody else.
 *
 * The layer queries are injected. This file is about the ladder's contract --
 * what it searches, how it labels, what it refuses to repeat, and what it says
 * when it finds nothing -- not about SQL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gatherEverything, termsFrom } from "./gather.js";

const OWNER = "82728e56-d936-4d38-b1a4-a880f5a3019e";

const SHAPE = {
  total: 1231,
  withPhone: 1180,
  withEmail: 210,
  withCompany: 96,
  withSyncedNote: 402,
  withBirthday: 88,
  withTags: 140,
  withAmberNote: 3,
  tags: [
    { tag: "usc", count: 30, examples: ["Arjun", "Nina"] },
    { tag: "btg", count: 4, examples: ["Shirley Park"] },
  ],
  metros: [
    { metro: "New York", count: 101 },
    { metro: "Los Angeles", count: 51 },
  ],
};

/** Injected layers, so nothing here touches a database. */
function deps({ stated = [], labeled = [], implied = [], birthdays = null, shape = SHAPE } = {}) {
  return {
    statedLayer: async () => stated,
    labeledLayer: async () => labeled,
    impliedLayer: async () => implied,
    bookShape: async () => shape,
    upcomingBirthdays: async () => birthdays ?? [],
  };
}

// ── terms, with no vocabulary table ─────────────────────────────────────────

test("the question's own words become the search terms", () => {
  // "goes" no longer yields "goe": the stem rules require a longer word before
  // they cut, precisely so four-letter words are not sheared into non-words.
  assert.deepEqual(termsFrom("Who do I know that goes to USC?"), ["goes", "usc"]);
  assert.deepEqual(termsFrom("Do I know anyone in New York?"), ["new", "york"]);
  assert.deepEqual(termsFrom("who works at Stripe"), ["works", "work", "stripe"]);
});

test("terms work for words nobody predicted", () => {
  // The whole point. A synonym table works for the domains its author thought
  // of; this works for whatever a person actually types.
  for (const [q, want] of [
    ["anyone in podcasting?", "podcasting"],
    ["do I know an orthodontist", "orthodontist"],
    ["who was in Kappa Sigma", "kappa"],
    ["anyone from Tepper", "tepper"],
  ]) {
    assert.ok(termsFrom(q).includes(want), `${q} -> ${JSON.stringify(termsFrom(q))}`);
  }
});

test("plurals reach a card written in the singular, and BOTH forms are kept", () => {
  // "do I know any lawyers" has to find the card that says "lawyer". Mechanical,
  // not a vocabulary.
  for (const [q, plural, singular] of [
    ["do I know any lawyers", "lawyers", "lawyer"],
    ["any doctors?", "doctors", "doctor"],
    ["who is in sales", "sales", "sale"],
  ]) {
    const t = termsFrom(q);
    assert.ok(t.includes(plural), q);
    assert.ok(t.includes(singular), q);
  }

  // OVER-GENERATING IS THE RIGHT DIRECTION and "sales" -> "sale" is the case
  // that proves it: the singular is a different word and will almost never match
  // anything, so the cost is one extra term in a query. The cost of the other
  // direction is a card the user wrote that Amber cannot find, which is
  // invisible to everyone including us. A spurious match gets discarded by the
  // model; a missed one is the bug this whole file exists for.

  // The strip is only applied where it cannot mangle the word: not on short
  // words, and not on a double s.
  assert.ok(!termsFrom("who is in the biz").includes("bi"));
  assert.ok(!termsFrom("anyone in fitness").includes("fitnes"));
});

test("grammar is dropped and domain words never are", () => {
  assert.deepEqual(termsFrom("who do I know"), []);
  assert.deepEqual(termsFrom(""), []);
  assert.deepEqual(termsFrom(null), []);
  // A REAL WORD IS STILL NEVER DROPPED. Only the scaffolding is.
  assert.deepEqual(termsFrom("what do you know about my dentist"), ["dentist"]);
  assert.ok(termsFrom("anyone from Tepper").includes("tepper"));
});

test("a question about the book itself yields no terms at all", () => {
  // Ten mock books were asked these and all ten answered "I don't have any
  // information" while the shape beside the answer knew the exact total, the
  // top labels and the top metros. Searching notes for the literal string
  // "contact" finds "contact him at work" and misses the question; worse, the
  // term made the question look SPECIFIC, so an empty result was reported as
  // `thin` -- an apology -- rather than as "you asked about the book".
  for (const q of [
    "Who do I know in my contacts?",
    "How many people do I know?",
    "Do you know anything about any of my contacts?",
    "tell me about my network",
    "who are all my friends",
  ]) {
    assert.deepEqual(termsFrom(q), [], q);
  }
});

test("a name in any script survives tokenizing", () => {
  // Measured before the fix, and every one of these is a real user's name:
  //   "Müller-Lüdenscheidt" -> ["ller","denscheidt"]
  //   "Şahin Öztürk"        -> ["ahin","zt","rk"]
  //   "東京"                 -> []            (no terms at all)
  //   "نيويورك"              -> []            (no terms at all)
  // A stripped-to-nothing question then read as "they asked about their whole
  // book" and was answered with a summary of it.
  assert.ok(termsFrom("wer kennt Müller-Lüdenscheidt").includes("müller"));
  assert.ok(termsFrom("wer kennt Müller-Lüdenscheidt").includes("lüdenscheidt"));
  assert.ok(termsFrom("Şahin Öztürk").includes("şahin"));
  assert.ok(termsFrom("Şahin Öztürk").includes("öztürk"));
  assert.deepEqual(termsFrom("who do I know in 東京"), ["東京"]);
  assert.ok(termsFrom("من أعرف في نيويورك").includes("نيويورك"));
  assert.ok(termsFrom("ai đó ở Việt Nam").includes("việt"));
});

test("no term can ever carry a regex metacharacter", () => {
  // The strong layer joins the terms into `(t1|t2|...)` and hands that to `~*`.
  // If a metacharacter survived tokenizing, a question could change the meaning
  // of the pattern -- at best matching everything, at worst failing to compile
  // and costing the layer. So the guarantee lives here, on the way in, and it
  // has to hold for deliberately hostile input.
  const hostile = [
    "a|b|.*|(((",
    "who do I know at C++ (the language) [seriously]?",
    "%_\\ wildcard",
    "'; SELECT * FROM users; --",
    "$1 ${terms} {{name}}",
    "^start end$ a{2,3} x?y",
    "back\\slash and /slash/",
    "\u0000null byte",
  ];
  for (const q of hostile) {
    for (const t of termsFrom(q)) {
      assert.doesNotMatch(t, /[.*+?^${}()|[\]\\]/, `term ${JSON.stringify(t)} from ${JSON.stringify(q)}`);
      // And it must still be a usable pattern when joined the way the layer joins it.
      assert.doesNotThrow(() => new RegExp(`(${t})`, "i"));
    }
    assert.doesNotThrow(() => new RegExp(`(${termsFrom(q).join("|") || "x"})`, "i"));
  }
});

test("terms are capped, so a pasted paragraph cannot blow up the queries", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  assert.ok(termsFrom(long).length <= 12);
});

// ── the layers ──────────────────────────────────────────────────────────────

test("a note the user saved is the strong layer and leads", async () => {
  const g = await gatherEverything(OWNER, "who do I know in New York?", {
    deps: deps({
      stated: [
        { contactId: "1", name: "Maya", city: "New York", where: "note", excerpts: ["Maya moved to New York"] },
      ],
      implied: [{ contactId: "9", name: "Ted", areaCode: "646", metro: "New York" }],
    }),
  });
  assert.equal(g.layers.stated.length, 1);
  assert.equal(g.inventory.thin, false);
  // The weak layer is still returned. It is not a fallback chain -- "only one
  // person fits according to your notes, but these have area codes that might
  // be appropriate as well".
  assert.equal(g.layers.implied.length, 1);
});

test("a synced Apple note counts as strongly as one told to Amber", async () => {
  // "His Apple contacts have detailed information about the 200 people he knows
  //  in New York, and Amber won't be able to retrieve that at all."
  const g = await gatherEverything(OWNER, "who do I know in New York?", {
    deps: deps({
      stated: [
        { contactId: "1", name: "Dev", where: "synced note", excerpts: ["met at the NYC office, knows Ravi"] },
      ],
    }),
  });
  assert.equal(g.layers.stated[0].where, "synced note");
  assert.equal(g.inventory.thin, false);
});

test("the USC case: thirty contacts tagged in their own name are found", async () => {
  // "There are maybe 30 contacts that have the tag USC in their name. If Caleb
  //  asks about that it should say 30 contacts have the USC tag."
  const labeled = Array.from({ length: 30 }, (_, i) => ({
    contactId: `t${i}`,
    name: `Person ${i}`,
    tags: ["USC"],
    matched: ["USC"],
  }));
  const g = await gatherEverything(OWNER, "Who do I know that goes to USC?", {
    deps: deps({ labeled }),
  });
  assert.equal(g.layers.labeled.length, 30);
  assert.equal(g.inventory.thin, false, "thirty tagged contacts is not thin");
});

test("nobody is listed twice across layers", async () => {
  // Somebody whose note says they live in New York must not also appear as "has
  // a New York area code" -- the fact already covers it, and listing them twice
  // reads as the app losing count.
  const g = await gatherEverything(OWNER, "anyone in New York?", {
    deps: deps({
      stated: [{ contactId: "same", name: "Maya", where: "note", excerpts: [] }],
      labeled: [{ contactId: "same", name: "Maya", tags: ["NYC"], matched: ["NYC"] }],
      implied: [{ contactId: "same", name: "Maya", areaCode: "646", metro: "New York" }],
    }),
  });
  assert.equal(g.layers.stated.length, 1);
  assert.equal(g.layers.labeled.length, 0);
  assert.equal(g.layers.implied.length, 0);
});

test("a stronger layer claims a person before a weaker one can", async () => {
  const g = await gatherEverything(OWNER, "USC?", {
    deps: deps({
      labeled: [{ contactId: "a", name: "A", tags: ["USC"], matched: ["USC"] }],
      implied: [
        { contactId: "a", name: "A", areaCode: "213", metro: "Los Angeles" },
        { contactId: "b", name: "B", areaCode: "213", metro: "Los Angeles" },
      ],
    }),
  });
  assert.deepEqual(g.layers.implied.map((r) => r.contactId), ["b"]);
});

// ── the shape, which is always computed ─────────────────────────────────────

test("how many people do I know is answerable with no notes at all", async () => {
  const g = await gatherEverything(OWNER, "How many people do I know?", {
    deps: deps({ shape: { ...SHAPE, withAmberNote: 0, withSyncedNote: 0 } }),
  });
  assert.equal(g.shape.total, 1231);
  assert.equal(g.inventory.found.totalContacts, 1231);
});

test("the shape carries the labels and the metros the book actually holds", async () => {
  const g = await gatherEverything(OWNER, "tell me about my contacts", { deps: deps() });
  assert.equal(g.shape.tags[0].tag, "usc");
  assert.equal(g.shape.tags[0].count, 30);
  assert.equal(g.shape.metros[0].metro, "New York");
  assert.equal(g.shape.metros[0].count, 101);
});

// ── birthdays ───────────────────────────────────────────────────────────────

test("a birthday question reads the birthdays that came in with the sync", async () => {
  // "If I do my Apple sync and ask 'whose birthday is it today', it should look
  //  through all the information it got from the sync. Right now it's just
  //  sputtering and saying 'I don't know, you didn't explicitly tell me'."
  const g = await gatherEverything(OWNER, "Whose birthday is it today?", {
    deps: deps({ birthdays: [{ contactId: "1", name: "Nina", month: 9, day: 9 }] }),
  });
  assert.equal(g.birthdays.length, 1);
  assert.equal(g.inventory.found.birthdays, 1);
  assert.equal(g.inventory.thin, false);
  assert.ok(g.inventory.searched.some((t) => /birthday/i.test(t)));
});

test("a question with no birthday in it does not pay for the birthday query", async () => {
  let called = false;
  const g = await gatherEverything(OWNER, "who do I know at Stripe?", {
    deps: { ...deps(), upcomingBirthdays: async () => { called = true; return []; } },
  });
  assert.equal(called, false);
  assert.equal(g.birthdays, null);
  assert.equal(g.inventory.found.birthdays, null);
});

// ── the inventory. the reason a thin answer stops being a shrug. ────────────

test("a thin result reports what was searched, including the zeros", async () => {
  const g = await gatherEverything(OWNER, "who do I know in Boise?", { deps: deps() });
  assert.equal(g.inventory.thin, true);
  assert.equal(g.inventory.found.stated, 0);
  assert.equal(g.inventory.found.labeled, 0);
  assert.equal(g.inventory.found.implied, 0);
  // The shape is still there, so even a thin answer has real numbers in it.
  assert.equal(g.inventory.found.totalContacts, 1231);
  assert.ok(g.inventory.searched.length >= 4);
  assert.ok(g.inventory.searched.some((t) => /synced/i.test(t)));
  assert.ok(g.inventory.searched.some((t) => /area code/i.test(t)));
});

test("area codes alone are NOT thin — they are the floor, and the floor counts", async () => {
  // "If there's nothing else, like no notes, then that should be something that
  //  comes up." Ten people worth texting is not "I have nothing".
  const g = await gatherEverything(OWNER, "anyone in New York?", {
    deps: deps({
      implied: Array.from({ length: 10 }, (_, i) => ({
        contactId: `i${i}`,
        name: `Person ${i}`,
        areaCode: "646",
        metro: "New York",
      })),
    }),
  });
  assert.equal(g.layers.implied.length, 10);
  // Deliberately still `thin` for the STRONG layers, which is what tells the
  // reply to explain itself and offer the web search -- while the ten names are
  // right there to be offered first.
  assert.equal(g.inventory.thin, true);
  assert.equal(g.inventory.found.implied, 10);
});

// ── it must never take the turn down ────────────────────────────────────────

test("a failing layer costs that layer and nothing else", async () => {
  const g = await gatherEverything(OWNER, "who do I know at USC?", {
    deps: {
      ...deps({ labeled: [{ contactId: "a", name: "A", tags: ["USC"], matched: ["USC"] }] }),
      statedLayer: async () => {
        throw new Error("db down");
      },
    },
  });
  assert.deepEqual(g.layers.stated, []);
  assert.equal(g.layers.labeled.length, 1, "the other layers still answered");
});

test("no owner returns an empty result rather than throwing", async () => {
  const g = await gatherEverything(null, "anything");
  assert.deepEqual(g.layers.stated, []);
  assert.equal(g.shape, null);
});

test("every layer failing still returns the contract, not an exception", async () => {
  const boom = async () => {
    throw new Error("everything is down");
  };
  const g = await gatherEverything(OWNER, "who do I know", {
    deps: {
      statedLayer: boom,
      labeledLayer: boom,
      impliedLayer: boom,
      bookShape: boom,
      upcomingBirthdays: boom,
      unfiledLayer: boom,
      namedLayer: boom,
    },
  });
  // `unfiled` joins the contract: things the user said about a name that matched
  // no card. It is a list of sentences rather than people, and like every other
  // layer it degrades to empty rather than throwing.
  // `named` joins the contract: the people whose NAME matches the question, which
  // is the strongest match there is and was missing entirely -- "what do you know
  // about Tobias Lindqvist" returned nothing for a contact sitting in the book.
  assert.deepEqual(g.layers, { named: [], stated: [], labeled: [], implied: [], unfiled: [] });
  assert.equal(g.shape, null);
  assert.equal(g.inventory.thin, true);
});
