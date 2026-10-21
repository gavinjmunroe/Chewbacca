/**
 * THE FACTS WE STORED HAVE TO REACH THE PROMPT.
 *
 * Run with the rest: npm test
 *
 * A user said "Karthik, Sagar, Shirley Park BTG USC are all good people" and the
 * server wrote every one of them:
 *
 *   FACT_CONTACT_FACT contact=508e6208 category=personality
 *   FACT_CONTACT_FACT contact=e873ee26 category=personality
 *   FACT_CONTACT_FACT contact=b474121a category=personality
 *
 * Two minutes later he asked "Who are Sagar, Karthik, and Shirley Park BTG USC?"
 * and Amber said "Those three names don't ring a bell yet from anything you've
 * shared with me before" -- with all three contact cards rendered underneath it.
 *
 * Nothing was lost. The `chat` lane was given CHAT_SYSTEM, today's date, and a
 * digest of the first user message of four other threads. There was no path by
 * which one stored fact about one person could reach the model.
 *
 * buildTaggedMemory is that path, and these are its rules. The one that matters
 * most is the last: it returns "" rather than an empty heading, because a "here
 * is what you know" block with nothing under it invites exactly the answer this
 * is fixing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildTaggedMemory, asksAboutTheBook } from "../routes/chat.js";

const OWNER = "82728e56-d936-4d38-b1a4-a880f5a3019e";
const KARTHIK = "508e6208-b6af-4f19-95d4-87961eb5df1a";
const SAGAR = "e873ee26-710c-412c-a118-b113e105a456";
const SHIRLEY = "b474121a-2fcd-45d1-a48a-e47af0e46d70";

/** A fake store, so nothing here touches a database. */
function store(map, selfRows = []) {
  return {
    loadContent: async (_owner, ids) => {
      const out = {};
      for (const id of ids) if (map[id]) out[id] = map[id];
      return out;
    },
    loadSelf: async () => selfRows,
  };
}

const THE_REAL_CASE = {
  [KARTHIK]: [{ text: "Karthik is a good person" }],
  [SAGAR]: [{ text: "Sagar is a good person" }],
  [SHIRLEY]: [{ text: "Shirley Park is at BTG USC" }, { text: "Shirley Park is a good person" }],
};

test("the facts of every tagged person reach the block", async () => {
  const tagged = [
    { id: KARTHIK, name: "Karthik" },
    { id: SAGAR, name: "Sagar" },
    { id: SHIRLEY, name: "Shirley Park" },
  ];
  const out = await buildTaggedMemory(OWNER, tagged, store(THE_REAL_CASE));

  for (const line of [
    "Karthik is a good person",
    "Sagar is a good person",
    "Shirley Park is at BTG USC",
    "Shirley Park is a good person",
  ]) {
    assert.ok(out.includes(line), `missing from the prompt: ${line}`);
  }
  // And the instruction that makes the failure impossible to repeat verbatim.
  assert.ok(/does not ring a bell|ring a bell/i.test(out));
});

test("nothing tagged means no block at all", async () => {
  // NOT an empty heading. "Here is what you know about the people in this
  // message:" followed by nothing is worse than silence — it tells the model to
  // announce that it knows nothing.
  assert.equal(await buildTaggedMemory(OWNER, [], store({})), "");
  assert.equal(await buildTaggedMemory(OWNER, null, store({})), "");
});

test("a tagged person with no stored facts contributes nothing", async () => {
  // The honest case: Mark Lynn is in the address book and has never been
  // mentioned. He is tagged, he has no facts, and he must not produce an empty
  // section with his name over it.
  const out = await buildTaggedMemory(
    OWNER,
    [{ id: "mark", name: "Mark Lynn" }],
    store({ mark: [] }),
  );
  assert.equal(out, "");
});

test("one person with facts and one without yields only the one with", async () => {
  const out = await buildTaggedMemory(
    OWNER,
    [{ id: "mark", name: "Mark Lynn" }, { id: SAGAR, name: "Sagar" }],
    store({ mark: [], [SAGAR]: [{ text: "Sagar is a good person" }] }),
  );
  assert.ok(out.includes("Sagar is a good person"));
  assert.ok(!out.includes("Mark Lynn"));
});

test("a person's label carries their title and company when known", async () => {
  const out = await buildTaggedMemory(
    OWNER,
    [{ id: SHIRLEY, name: "Shirley Park", title: "Analyst", company: "BTG" }],
    store({ [SHIRLEY]: [{ text: "Shirley Park is a good person" }] }),
  );
  assert.ok(out.includes("Shirley Park — Analyst — BTG"));
});

test("facts read oldest-first, so the newest sits nearest the question", async () => {
  // The store returns newest first. The block prints the newest N in reverse, so
  // the most recent thing said about someone is the last line the model reads.
  const out = await buildTaggedMemory(
    OWNER,
    [{ id: SAGAR, name: "Sagar" }],
    store({ [SAGAR]: [{ text: "newest" }, { text: "middle" }, { text: "oldest" }] }),
  );
  const order = ["oldest", "middle", "newest"].map((t) => out.indexOf(t));
  assert.deepEqual([...order].sort((a, b) => a - b), order, `wrong order: ${out}`);
});

test("the block is capped, and the cap does not depend on how many contacts exist", async () => {
  const many = {};
  const tagged = [];
  for (let i = 0; i < 40; i += 1) {
    const id = `c${i}`;
    many[id] = Array.from({ length: 50 }, (_, j) => ({ text: `fact ${i}-${j} ${"x".repeat(60)}` }));
    tagged.push({ id, name: `Person ${i}` });
  }
  const out = await buildTaggedMemory(OWNER, tagged, store(many));
  // This rides the critical path in front of the first token; an address book
  // with a thousand contacts must not be able to grow it.
  assert.ok(out.length <= 4000, `block was ${out.length} chars`);
  assert.ok(out.length > 0);
});

test("junk rows are skipped rather than printed as blanks", async () => {
  const out = await buildTaggedMemory(
    OWNER,
    [{ id: SAGAR, name: "Sagar" }],
    store({ [SAGAR]: [null, { text: "   " }, { text: null }, { text: "Sagar is a good person" }] }),
  );
  assert.ok(out.includes("Sagar is a good person"));
  assert.ok(!/- \s*$/m.test(out), "printed an empty bullet");
});

test("a store that throws costs the block, not the turn", async () => {
  const out = await buildTaggedMemory(OWNER, [{ id: SAGAR, name: "Sagar" }], {
    loadContent: async () => {
      throw new Error("db down");
    },
    loadSelf: async () => [],
  });
  assert.equal(out, "");
});

// ── the user's own facts ─────────────────────────────────────────────────────

test("wantSelf pulls the user's own facts, which live somewhere else entirely", async () => {
  const out = await buildTaggedMemory(OWNER, [], {
    ...store({}, [{ text: "is focusing on Amber" }, { fact_text: "moved to Austin" }]),
  }, );
  assert.equal(out, "", "self facts are off by default");

  const withSelf = await buildTaggedMemory(
    OWNER,
    [],
    { ...store({}, [{ text: "is focusing on Amber" }, { fact_text: "moved to Austin" }]), wantSelf: true },
  );
  assert.ok(withSelf.includes("is focusing on Amber"));
  assert.ok(withSelf.includes("moved to Austin"));
  assert.ok(withSelf.includes("The user themselves"));
});

// ── the whole-book floor ─────────────────────────────────────────────────────

test("a question about the book at large is recognized", () => {
  for (const q of [
    "Do you know anything about any of my contacts?",
    "do you know anything about my contacts",
    "what do you know about all my contacts",
    "how many contacts do I have",
    "tell me about my network",
    "anything about my address book?",
  ]) {
    assert.equal(asksAboutTheBook(q), true, q);
  }
});

test("a question about one person is NOT a question about the book", () => {
  for (const q of [
    "What do you know about my roommate Mark Lynn?",
    "Who are Sagar, Karthik, and Shirley Park BTG USC?",
    "Tell me about Sagar",
    "what should I get Karthik for his birthday",
  ]) {
    assert.equal(asksAboutTheBook(q), false, q);
  }
});

test("with nobody named, the floor answers off the contact cards", async () => {
  // "Do you know anything about any of my contacts?" was answered with "Right
  // now I don't have any contacts or notes in front of me for you" against 1,231
  // contacts. That is the sentence this test exists to make impossible — and the
  // answer now comes from the CARDS (taglines, area codes, companies), not from
  // an aggregate count, because a new user's count is all an aggregate has.
  const out = await buildTaggedMemory(OWNER, [], {
    loadContent: async () => ({}),
    loadSelf: async () => [],
    wantOverview: true,
    // USC on FOUR cards, because that is what makes it a label rather than a
    // name -- see src/lib/name-split.js. Two would be a coincidence.
    loadBook: async () => [
      { id: "1", full_name: "Shirley Park USC BTG", first_name: "Shirley Park USC BTG", last_name: null, phone_primary: "+12135550001", fact_count: 0 },
      { id: "2", full_name: "Nina USC", first_name: "Nina", last_name: null, phone_primary: "+12135550002", fact_count: 0 },
      { id: "3", full_name: "Omar USC", first_name: "Omar", last_name: null, phone_primary: "+13105550003", fact_count: 0 },
      { id: "4", full_name: "Priya USC", first_name: "Priya", last_name: null, phone_primary: "+13105550004", fact_count: 0 },
      { id: "5", full_name: "Sagar Patel", first_name: "Sagar", last_name: "Patel", phone_primary: "+16465550005", company: "Stripe", fact_count: 0 },
    ],
    loadOverview: async () => {
      throw new Error("must not be reached when there are cards");
    },
  });
  assert.ok(out.includes("5 contacts"), out);
  assert.ok(/4 tagged "USC"/.test(out), out);
  assert.ok(/4 in Los Angeles/.test(out), out);
  assert.ok(/1 in New York/.test(out), out);
  assert.ok(/NO saved notes or personal facts/i.test(out), out);
  assert.ok(/NEVER say you have no contacts/i.test(out));
});

test("the aggregate is the fallback only when there are no cards to read", async () => {
  const out = await buildTaggedMemory(OWNER, [], {
    loadContent: async () => ({}),
    loadSelf: async () => [],
    wantOverview: true,
    loadBook: async () => [],
    loadOverview: async () => ({ total: 1231, withNotes: 0, topNoted: [] }),
  });
  assert.ok(out.includes("1231"), out);
});

test("the floor does not fire when a named person had facts", async () => {
  // A question that names someone AND mentions contacts must be answered about
  // the person, not about how many contacts exist.
  const out = await buildTaggedMemory(OWNER, [{ id: SAGAR, name: "Sagar" }], {
    ...store({ [SAGAR]: [{ text: "Sagar is a good person" }] }),
    wantOverview: true,
    loadBook: async () => {
      throw new Error("must not be called");
    },
    loadOverview: async () => {
      throw new Error("must not be called");
    },
  });
  assert.ok(out.includes("Sagar is a good person"));
  assert.ok(!out.includes("contacts synced"));
});

test("an empty book still returns nothing rather than a false claim", async () => {
  const out = await buildTaggedMemory(OWNER, [], {
    loadContent: async () => ({}),
    loadSelf: async () => [],
    wantOverview: true,
    loadBook: async () => [],
    loadOverview: async () => ({ total: 0, withNotes: 0, topNoted: [] }),
  });
  assert.equal(out, "");
});
