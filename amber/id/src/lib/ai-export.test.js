/**
 * TWO EXPORT FORMATS THAT ARE NOT A CONTRACT, AND A MATCHER THAT MUST NOT
 * GUESS.
 *
 * Both halves of this feature fail quietly rather than loudly. A parser that
 * mis-reads a field produces an import with no matches, which looks exactly
 * like an export with nothing in it. A matcher that is too eager produces a
 * timeline full of conversations that have nothing to do with the person,
 * which looks exactly like a product that does not work -- and once somebody
 * has seen one wrong row on a relationship they care about, they stop
 * believing the right ones.
 *
 * So both get tested against fixtures small enough to read.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { detectProvider, parseExport, readExportBuffer } from "./ai-export.js";
import { __test } from "../db/org-ai-import.js";

const { mentionsIn, oneLine, conversationUrl } = __test;

/* ------------------------------------------------------------- the parsers */

/** ChatGPT keeps a conversation as a tree of nodes, keyed by id. */
const CHATGPT = [
  {
    conversation_id: "c-1",
    title: "Follow-up to Henderson about the renewal",
    create_time: 1_730_000_000,
    update_time: 1_730_000_900,
    mapping: {
      root: { id: "root", message: null },
      a: {
        id: "a",
        message: {
          author: { role: "system" },
          content: { content_type: "text", parts: ["You are a helpful assistant for Dana Whitfield"] },
        },
      },
      b: {
        id: "b",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Draft a note to dana@henderson-cpa.com"] },
        },
      },
    },
  },
];

/** Claude keeps a flat array. */
const CLAUDE = [
  {
    uuid: "u-1",
    name: "Prep for the Whitfield call",
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    chat_messages: [
      { sender: "human", text: "What should I ask Dana Whitfield on Thursday?" },
      { sender: "assistant", content: [{ type: "text", text: "Ask about the renewal timing." }] },
    ],
  },
];

test("both export shapes are recognized from the data, not the filename", () => {
  // Somebody renames a download, or unzips it, or has one from a year ago.
  // The shape is the only thing that reliably says what wrote it.
  assert.equal(detectProvider(CHATGPT), "chatgpt");
  assert.equal(detectProvider(CLAUDE), "claude");
  assert.equal(detectProvider([{ something: "else" }]), null);
  assert.equal(detectProvider("not a list"), null);
});

test("a ChatGPT export parses, and system turns are left out", () => {
  const { provider, conversations } = parseExport(CHATGPT);
  assert.equal(provider, "chatgpt");
  assert.equal(conversations.length, 1);

  const [c] = conversations;
  assert.equal(c.id, "c-1");
  assert.ok(c.text.includes("dana@henderson-cpa.com"));

  /*
   * THE BUG THIS PREVENTS. Custom instructions are replayed as a system turn
   * on every single conversation. Including them would make every
   * conversation in the export "mention" whoever the person named in their
   * profile, and that one name would appear on its node four thousand times.
   */
  assert.ok(
    !c.text.includes("helpful assistant"),
    "a system turn leaked into the matchable text",
  );
});

test("a Claude export parses, including typed content blocks", () => {
  const { provider, conversations } = parseExport(CLAUDE);
  assert.equal(provider, "claude");
  assert.equal(conversations.length, 1);
  assert.ok(conversations[0].text.includes("Dana Whitfield"));
  // The assistant's reply is in a content block rather than a text field, and
  // Claude has used both shapes.
  assert.ok(conversations[0].text.includes("renewal timing"));
});

test("timestamps survive seconds, milliseconds and ISO", () => {
  // ChatGPT writes float seconds; Claude writes ISO. Reading seconds as
  // milliseconds dates everything to 1970 and silently puts the whole import
  // at the bottom of every timeline.
  const gpt = parseExport(CHATGPT).conversations[0];
  const claude = parseExport(CLAUDE).conversations[0];
  assert.equal(gpt.occurredAt.getUTCFullYear(), 2024);
  assert.equal(claude.occurredAt.getUTCFullYear(), 2026);
});

test("a file that is not a conversation export says so instead of throwing", () => {
  // Somebody will upload the wrong zip. That should be a sentence on a
  // screen, not a 500.
  assert.equal(parseExport({ hello: "world" }).error, "not_a_conversation_export");
  assert.equal(parseExport([{ nope: 1 }]).error, "unrecognized_format");
  assert.equal(readExportBuffer(Buffer.from("not json")).error, "not_json");
  assert.equal(readExportBuffer("not a buffer").error, "no_file");
});

test("a bare .json is accepted, since people unzip things", () => {
  const buf = Buffer.from(JSON.stringify(CLAUDE), "utf8");
  const { json, error } = readExportBuffer(buf, "conversations.json");
  assert.equal(error, undefined);
  assert.equal(detectProvider(json), "claude");
});

/* ------------------------------------------------------------- the matcher */

const ENTRIES = [
  {
    personId: "p-dana",
    label: "Dana Whitfield",
    via: "person",
    emails: ["dana@henderson-cpa.com"],
    tokens: ["dana", "whitfield"],
  },
  {
    personId: "p-sam",
    label: "Sam",            // one token: deliberately unmatchable by name
    via: "person",
    emails: ["sam@other.com"],
    tokens: null,
  },
  {
    personId: "p-dana",
    label: "Henderson CPA",
    via: "account",
    emails: [],
    domain: "henderson-cpa.com",
    tokens: ["henderson"],
  },
];

test("an email address is a match and is the strongest one", () => {
  const hits = mentionsIn("please reply to dana@henderson-cpa.com about this", ENTRIES);
  assert.equal(hits.size, 1);
  assert.equal(
    hits.get("p-dana").via,
    "email",
    "a firm-name match should not downgrade an address match for the same person",
  );
});

test("a full name matches and a first name alone never does", () => {
  assert.ok(mentionsIn("meeting with Dana Whitfield tomorrow", ENTRIES).has("p-dana"));

  /*
   * THE FALSE POSITIVE THAT WOULD SINK THIS. "Dana" shows up in conversations
   * about nothing. A timeline that attributes a stranger's chat to a real
   * relationship is one nobody trusts again, and no amount of later accuracy
   * repairs the first wrong row somebody sees.
   */
  const loose = mentionsIn("dana is a nice name for a boat", ENTRIES);
  assert.ok(!loose.has("p-dana"), "a single name token should not be a match");
});

test("a one-token person is unmatchable by name rather than matched loosely", () => {
  // "Sam" as a whole contact name cannot be matched safely, so it is not
  // matched at all. Their address still works.
  assert.ok(!mentionsIn("I spoke to sam about it", ENTRIES).has("p-sam"));
  assert.ok(mentionsIn("cc sam@other.com", ENTRIES).has("p-sam"));
});

test("a firm is matched by domain or by name, and lands on somebody there", () => {
  const byDomain = mentionsIn("their site is henderson-cpa.com", ENTRIES);
  assert.equal(byDomain.get("p-dana")?.via, "domain");

  const byName = mentionsIn("the Henderson engagement", ENTRIES);
  assert.equal(byName.get("p-dana")?.via, "account");
});

test("ordinary conversations match nothing", () => {
  // The baseline that makes the rest meaningful: most of an export is not
  // about anybody, and it has to come back empty.
  for (const text of [
    "write me a python script to parse a csv",
    "what is a good recipe for carbonara",
    "explain the difference between tcp and udp",
    "",
  ]) {
    assert.equal(mentionsIn(text, ENTRIES).size, 0, `matched something in: ${text}`);
  }
});

/* ------------------------------------------------------------ the one line */

test("the summary is the conversation's own title when it has one", () => {
  // Both products auto-title with a description of what the conversation was
  // about, which is the summary we would otherwise pay a model to write.
  assert.equal(
    oneLine({ title: "Follow-up to Henderson about the renewal", text: "..." }),
    "Follow-up to Henderson about the renewal",
  );
  // An untitled thread falls back to its first line rather than to nothing.
  assert.equal(oneLine({ title: "New chat", text: "help me draft a note\nmore" }), "help me draft a note");
  assert.equal(oneLine({ title: null, text: "" }), "Untitled conversation");
});

test("the link points back at the tool that owns the conversation", () => {
  // What is stored is a reference, so the reference has to work. A node whose
  // only content is "you worked on something" with no way back is worse than
  // no row at all.
  assert.equal(conversationUrl("chatgpt", "c-1"), "https://chat.openai.com/c/c-1");
  assert.equal(conversationUrl("claude", "u-1"), "https://claude.ai/chat/u-1");
  assert.equal(conversationUrl("copilot", "x"), null);
  assert.equal(conversationUrl("chatgpt", null), null);
});

test("the export manifest is recognized as an index, not as a broken export", () => {
  /*
   * THE FILE PEOPLE ACTUALLY RECEIVE NOW.
   *
   * Claude's export stopped being one zip. The email delivers a small JSON
   * listing five separate downloads -- conversations, projects, memories,
   * frames, metadata -- each with its own expiring link. Somebody who
   * follows the obvious instruction, "export your data and drop the file
   * in", drops this.
   *
   * The old reader parsed it as a conversation export, found no
   * conversations, and reported the format as unrecognized. True and
   * useless: the file names exactly which pieces exist and where to get
   * them, so the error carries that instead and the screen can list them.
   */
  const manifest = Buffer.from(
    JSON.stringify({
      instructions: "Download each file using the export_url.",
      total_files: 2,
      data_files: [
        { category: "conversations", filename: "conversations-000.zip", export_url: "https://x/1" },
        { category: "projects", filename: "projects-000.zip", export_url: "https://x/2" },
      ],
      version: "1.0",
    }),
  );

  const out = readExportBuffer(manifest, "member-manifest.json");
  assert.equal(out.error, "manifest_not_data");
  assert.equal(out.manifest.length, 2);
  assert.ok(out.manifest.some((f) => f.category === "projects"));
  assert.ok(out.manifest.every((f) => f.url?.startsWith("https://")));
});

test("an ordinary conversation export is still read as one", () => {
  /*
   * The manifest check keys on data_files AND instructions together. A
   * conversation export is a bare array and must not be caught by it --
   * breaking the common path to improve an error message would be a poor
   * trade.
   */
  const normal = Buffer.from(JSON.stringify([{ uuid: "a", chat_messages: [] }]));
  const out = readExportBuffer(normal, "conversations.json");
  assert.equal(out.error, undefined);
  assert.ok(Array.isArray(out.json));
});
