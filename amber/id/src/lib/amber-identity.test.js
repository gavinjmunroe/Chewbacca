/**
 * EVERY REPLY THE USER READS IS AN AMBER REPLY. THIS IS THE GATE.
 *
 * Run with the rest: npm test
 *
 * "There should honestly be a gated rule: every time an LLM is called for a
 *  response to a user, say, 'Hey, this is going to Amber. This is Amber's
 *  context. This is the user's context.' It's never a Claude response."
 *
 * WHAT WAS ACTUALLY WRONG. Twelve prompts in routes/chat.js opened by naming
 * Amber, and every one described a different product: "a warm, sharp personal
 * assistant", "the user's warm relationship companion", "a warm, intuitive
 * personal assistant", "a warm, brief companion", and four that said only "You
 * are Amber." The iMessage prompt -- the surface the team actually texts --
 * said, verbatim, "Write like Claude".
 *
 * So the NAME was everywhere and the IDENTITY was nowhere. Asked what it was,
 * the model answered from the only self-description it had been given and
 * offered weather, dates and arithmetic. Nothing was broken; twelve authors had
 * each written one sentence.
 *
 * That is the same failure shape as the retrieval bug (gatherEverything inside
 * one branch) and the search-path bug (the ladder unread by another): right
 * where somebody thought about it, absent everywhere else, with nothing to catch
 * the next one. A convention does not fix that. A gate does.
 *
 * WHAT THIS ENFORCES. Every call site that produces prose a person will read
 * must build its system prompt from something that carries AMBER_IDENTITY. It is
 * checked over the AST rather than by calling anything, so it covers branches no
 * test would otherwise reach -- which is the whole point, since the branches
 * nobody reaches are exactly where identity went missing.
 *
 * WHAT IT DELIBERATELY DOES NOT ENFORCE. Internal extractors -- the intent
 * router, fact extraction, the phonetic name judge, answer grouping, the
 * suggestion-chip generator, reminder parsing -- return JSON or a label to other
 * code, never prose to a person. Handing those an identity block would cost
 * tokens on every turn and buy nothing. They are listed by name below, with the
 * reason each one is exempt, and the list is asserted to stay exactly this size:
 * a new exemption has to be argued for in review rather than appended to
 * quietly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AMBER_IDENTITY, amberSystem } from "./amber-identity.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Files that talk to a person. */
const USER_FACING = [
  "routes/chat.js",
  "routes/photon-webhook.js",
  "lib/amber-thread-chat.js",
];

/**
 * Calls that stream or return prose to a person.
 *
 * `stream` is the injectable alias registerChatRoutes uses; streamChat and
 * callChat are the clients themselves.
 */
const PROSE_CALLS = new Set(["stream", "streamChat", "callChat"]);

/**
 * Prose calls that are NOT a reply to a person, each with the reason.
 *
 * Keyed by the function that contains the call, so it survives reformatting and
 * line moves. Every entry is a machine talking to a machine.
 */
const NOT_A_REPLY = {
  classifyIntent: "returns an intent label to the router, never prose",
  generateSuggestions: "returns a JSON array of chips, never prose",
  extractContactSignal: "returns extracted signals as JSON",
  _extractSignalsChunked: "returns extracted signals as JSON",
  judgeNames: "returns a JSON array of contact ids",
  groupAnswerPeople: "returns section labels as JSON",
  detectAnswer: "returns a yes/no judgment about a thread question",
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("the identity block says what Amber is, not what a chatbot is", () => {
  // A gate over an empty or generic block would pass over the exact problem it
  // exists for, so the CONTENT is pinned too: the product, the six dimensions,
  // and the refusal to describe itself as a general assistant.
  assert.ok(AMBER_IDENTITY.length > 800, "the identity block is too short to say anything");
  assert.match(AMBER_IDENTITY, /^You are Amber\./);
  for (const required of [
    /memory of the people/i,
    /address book/i,
    /spiritual.*emotional.*physical.*intellectual.*social.*financial/is,
    /not a general-purpose chatbot/i,
    /what are you/i,
    /ChatGPT/,
  ]) {
    assert.match(AMBER_IDENTITY, required, `the identity block no longer covers ${required}`);
  }
  // And it must not describe itself the way the twelve old openers did.
  assert.doesNotMatch(AMBER_IDENTITY, /\bWrite like Claude\b/i);
});

test("the identity block never asks the model to guess a fact about the account", () => {
  /**
   * WHAT WENT WRONG HERE, found by asking a live model rather than by reading.
   *
   * This block used to end: "If their contacts are not synced yet, say in one
   * line that syncing is what turns it on." Every word of that is reasonable and
   * it is still a bug, because the chat branch carries NO book-state block --
   * the model is handed a condition it has no way to evaluate. So on an owner
   * with 2,897 contacts it hedged the condition back at the user: "If your
   * contacts aren't synced yet, that's the one step that turns everything on."
   * Two of eleven answers on a full book told a fully-synced user to go and sync.
   *
   * A user with three thousand people in their book being told to import their
   * address book is the single clearest possible proof that Amber does not know
   * them, which is the one thing this whole block exists to prevent.
   *
   * The rule is therefore: state facts about the account, or say nothing. An
   * instruction of the form "if X, say Y" is only safe when X is something the
   * prompt actually tells it, and the empty-book case IS told -- gather emits
   * "THIS USER HAS NO CONTACTS AT ALL" when there are none. So the block must
   * forbid guessing and lean on that block instead.
   */
  assert.match(
    AMBER_IDENTITY,
    /NEVER GUESS WHETHER THEIR CONTACTS ARE SYNCED/,
    "the rule against guessing the account's sync state is gone",
  );
  assert.match(
    AMBER_IDENTITY,
    /do not raise syncing at all/i,
    "the block no longer says what to do when the sync state is unknown",
  );
  // The old conditional, in the shape that caused it. "If their contacts are
  // not synced yet, say ..." must not come back.
  assert.doesNotMatch(
    AMBER_IDENTITY,
    /\bIf their contacts are not synced yet, say\b/,
    "the unevaluable conditional is back in the identity block",
  );
});

test("amberSystem puts the identity first and keeps the situation after it", () => {
  const out = amberSystem("THIS TURN: something specific.", null, ["and more"]);
  assert.ok(out.startsWith(AMBER_IDENTITY), "the identity is not the head of the prompt");
  assert.match(out, /THIS TURN: something specific\./);
  assert.match(out, /and more/);
  // Falsy parts are dropped rather than becoming blank lines, so a caller can
  // pass a conditional line without guarding it.
  assert.ok(!/\n\n\n/.test(out.slice(AMBER_IDENTITY.length)));
});

test("EVERY PROSE CALL TO A MODEL CARRIES AMBER'S IDENTITY", () => {
  // The gate. Read off the source, so a branch nothing exercises is covered
  // exactly like one that is.
  const problems = [];
  let checked = 0;

  for (const rel of USER_FACING) {
    const src = read(rel);
    const lines = src.split("\n");

    /**
     * Identifiers in this file that are known to carry the identity: the block
     * itself, the helper, and any const whose initializer mentions either. Two
     * passes, so a constant defined from another constant is followed.
     */
    const carriers = new Set(["AMBER_IDENTITY", "amberSystem"]);
    for (let pass = 0; pass < 3; pass += 1) {
      for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]{0,4000}?);\n/g)) {
        const [, name, body] = m;
        if ([...carriers].some((c) => new RegExp(`\\b${c}\\b`).test(body))) carriers.add(name);
      }
    }

    for (let i = 0; i < lines.length; i += 1) {
      const call = /\b(stream|streamChat|callChat)\s*\(\s*\{/.exec(lines[i]);
      if (!call || !PROSE_CALLS.has(call[1])) continue;
      // A DECLARATION IS NOT A CALL SITE. `export async function streamChat({`
      // is the client itself; it receives a system prompt, it does not build one.
      if (/^\s*(?:export\s+)?(?:async\s+)?function\s/.test(lines[i])) continue;

      // The nearest enclosing function name above this line, so an exemption can
      // be keyed to something stable.
      // THE ENCLOSING FUNCTIONS, OUTERMOST INCLUDED. A local arrow named
      // `transcript` inside detectAnswer() is not the thing an exemption is
      // about, and taking the NEAREST name found detectAnswer's helper instead
      // of detectAnswer. Collect every enclosing name and let any of them match.
      const enclosing = [];
      for (let j = i; j >= 0 && j > i - 600; j -= 1) {
        const d =
          /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(lines[j]) ||
          /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/.exec(lines[j]);
        if (d) enclosing.push(d[1]);
      }
      const fn = enclosing[0] ?? "<top level>";
      if (enclosing.some((name) => Object.prototype.hasOwnProperty.call(NOT_A_REPLY, name))) continue;

      // The argument object, from this line to its balanced close.
      let depth = 0;
      let text = "";
      for (let j = i; j < Math.min(lines.length, i + 120); j += 1) {
        text += lines[j] + "\n";
        for (const ch of lines[j]) {
          if (ch === "(") depth += 1;
          else if (ch === ")") depth -= 1;
        }
        if (depth <= 0 && j > i) break;
      }
      checked += 1;
      const systemArg = /system\s*:\s*([\s\S]*?)(?:,\n\s{0,20}[a-zA-Z_$]+\s*:|\n\s*\})/.exec(text);
      let expr = systemArg ? systemArg[1] : "";
      // THE PROMPT IS NOT ALWAYS UNDER A `system:` KEY. callChat also accepts a
      // messages array whose first entry is `{ role: "system", content }`, and
      // lib/amber-thread-chat.js builds the whole thing in a helper and passes
      // `messages: buildReplyMessages(...)`. Follow that one hop: if the call
      // hands off to a function in this file, the function's body counts.
      const handoff = /messages\s*:\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text);
      if (handoff) {
        const body = new RegExp(
          `function\\s+${handoff[1]}\\s*\\([\\s\\S]{0,6000}?\\n\\}`,
        ).exec(src);
        if (body) expr += `\n${body[0]}`;
      }
      // And an inline `{ role: "system", content: X }` makes X the prompt.
      const inlineSystem = /role\s*:\s*["']system["']\s*,\s*content\s*:\s*([A-Za-z_$][\w$]*)/.exec(text);
      if (inlineSystem) {
        const decl = new RegExp(`(?:let|const)\\s+${inlineSystem[1]}\\s*=[\\s\\S]{0,4000}?;\\n`).exec(src);
        if (decl) expr += `\n${decl[0]}`;
        // A prompt assembled with `+=` across several statements: take every
        // line that appends to it.
        for (const m of src.matchAll(new RegExp(`${inlineSystem[1]}\\s*\\+=[^;]{0,2000};`, "g"))) {
          expr += `\n${m[0]}`;
        }
      }
      const carried = [...carriers].some((c) => new RegExp(`\\b${c}\\b`).test(expr));
      if (!carried) {
        problems.push(
          `${rel}:${i + 1} in ${fn}()\n      system: ${expr.replace(/\s+/g, " ").slice(0, 160)}`,
        );
      }
    }
  }

  // The scan has to have found the call sites or it is reporting a clean sweep
  // over nothing -- the worst outcome a gate can have.
  assert.ok(checked >= 8, `only found ${checked} prose calls to check; the scan is broken`);
  assert.deepEqual(
    problems,
    [],
    "\n  A reply to a person is being generated without Amber's identity:\n\n  " +
      problems.join("\n  ") +
      "\n\n  Build the prompt with amberSystem(...) or put AMBER_IDENTITY at its head.\n" +
      "  If this call does not produce prose for a person, add its function to\n" +
      "  NOT_A_REPLY with the reason.\n",
  );
});

test("the exemption list stays exactly this size", () => {
  // An allowlist is a thing people append to instead of reading. Seven entries,
  // every one a machine talking to a machine. An eighth has to be argued for.
  assert.equal(
    Object.keys(NOT_A_REPLY).length,
    7,
    "an exemption was added to NOT_A_REPLY. Every entry must be a call that returns " +
      "JSON or a label to other code, never prose to a person.",
  );
  for (const [fn, why] of Object.entries(NOT_A_REPLY)) {
    assert.ok(why.length > 15, `${fn} has no real reason recorded`);
  }
});

test("no user-facing prompt describes Amber in its own words any more", () => {
  // The twelve openers. Each was one author's sentence about what the product is,
  // and together they were twelve slightly different products. The situation a
  // branch is in still belongs in that branch; the identity does not.
  const openers = [
    /You are Amber, a warm, sharp personal assistant/,
    /You are Amber, the user's warm,? sharp relationship companion/,
    /You are Amber, the user's warm relationship companion/,
    /You are Amber, a warm, intuitive personal assistant/,
    /You are Amber, a warm, brief companion/,
    /Write like Claude/i,
  ];
  for (const rel of USER_FACING) {
    // COMMENTS ARE NOT PROMPTS. The notes explaining what these lines USED to say
    // quote them verbatim -- including "Write like Claude" -- and a check that
    // cannot tell a prompt from a note about a prompt would forbid writing the
    // note, which is the one place the history should live.
    const src = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    for (const bad of openers) {
      assert.doesNotMatch(src, bad, `${rel} still writes its own description of Amber: ${bad}`);
    }
  }
});
