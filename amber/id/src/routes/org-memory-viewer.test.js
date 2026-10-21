/**
 * EVERY ROUTE THAT READS A RELATIONSHIP MUST SAY WHO IS ASKING.
 *
 * THE BOUNDARY THIS PROTECTS is the one with no org_id behind it. Two
 * companies are kept apart by a row-level policy comparing a column, which is
 * hard to get wrong and impossible to forget -- the database refuses.
 *
 * Two COLLEAGUES are kept apart by a parameter. `history({ orgId, personId })`
 * and `history({ orgId, personId, viewerId })` are both valid JavaScript, both
 * return rows, and only one of them is correct. Omit it and the function does
 * what it was asked: viewerId is null, the visibility predicate matches
 * nothing the viewer owns, and depending on the arm either everything
 * disappears or everything appears. There is no error either way.
 *
 * That is the shape of a leak that ships: it is one word, in one route, added
 * by somebody who copied the route above it and trimmed what looked like
 * boilerplate. It passes review because the diff is short and the route
 * works.
 *
 * SO THIS IS A STRUCTURAL TEST rather than a behavioral one. A behavioral
 * test proves the route that exists today is right. This one is about the
 * route somebody writes next year, which is the only one that can still go
 * wrong.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./", import.meta.url));

/**
 * The store functions whose answer depends on who is asking.
 *
 * Named explicitly rather than inferred, because the list is short, the cost
 * of missing one is a leak, and a heuristic ("anything taking orgId") would
 * flag thirty correct call sites and get itself ignored.
 */
const VIEWER_AWARE = [
  "getPerson",
  "history",
  "listPeople",
  "getAccount",
  "accountHistory",
  "goingCold",
  /*
   * KNOWLEDGE BELONGS HERE TOO, and the ask bar is why it was added.
   *
   * A retrieval layer is the classic way a careful permission model gets
   * bypassed: every screen is right, and then something assembles context by
   * reading the tables because it is "just for grounding". The model cannot
   * know what it is not allowed to repeat, so anything that reaches it
   * reaches the person who asked.
   */
  "searchPages",
  "getPage",
  "listFiles",
  "listAttachments",
];

function routeFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => ({ file: f, src: readFileSync(join(DIR, f), "utf8") }));
}

/**
 * Comments out, string literals kept: a name in prose is not a call.
 *
 * The block comment is blanked CHARACTER BY CHARACTER rather than collapsed
 * to a space, so that every line reported below is the line in the real file.
 * Collapsing is the obvious way to write this and it silently shifts every
 * finding by however long the comments above it ran -- and these files are
 * heavily commented. A finding nobody can locate is a finding nobody acts on.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * The text of one call's arguments, by walking brackets from the opening
 * paren.
 *
 * A REGEX CANNOT DO THIS. These calls contain nested object literals, ternary
 * expressions and further calls, so `\(([^)]*)\)` stops at the first inner
 * close paren -- which in `viewerId: who(request)` is in the middle of the
 * argument being looked for. The first version of this test did exactly that
 * and reported four correct routes as broken, which is how a test earns its
 * way onto the ignore list.
 */
function callArgs(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  return "";
}

test("every viewer-aware read in a route passes viewerId", () => {
  const bad = [];

  for (const { file, src } of routeFiles()) {
    const clean = stripComments(src);
    for (const fn of VIEWER_AWARE) {
      // `await fn(` or `fn(`, not `.fn(` -- a method of the same name on some
      // other object is not this function.
      const re = new RegExp(`(?<![.\\w])${fn}\\s*\\(`, "g");
      for (const m of clean.matchAll(re)) {
        const open = m.index + m[0].length - 1;
        const args = callArgs(clean, open);
        if (!/\bviewerId\b/.test(args)) {
          const line = clean.slice(0, m.index).split("\n").length;
          bad.push(`${file}:${line} ${fn}() is called without viewerId`);
        }
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "these return the wrong rows for the person asking — either hiding a " +
      "colleague's published work or showing their private notes:\n  " + bad.join("\n  "),
  );
});

test("the viewer-aware list still names functions that exist", () => {
  /*
   * THE WAY THE TEST ABOVE GOES QUIET. Rename history() to timeline() and the
   * check above passes forever: it searches for a string nothing contains,
   * finds nothing, and reports green. A list of names is only a safeguard
   * while the names are real.
   */
  const store = [
    readFileSync(fileURLToPath(new URL("../db/org-memory-store.js", import.meta.url)), "utf8"),
    readFileSync(fileURLToPath(new URL("../db/org-knowledge-store.js", import.meta.url)), "utf8"),
  ].join("\n");
  const missing = VIEWER_AWARE.filter(
    (fn) => !new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`).test(store),
  );
  assert.deepEqual(
    missing,
    [],
    `renamed or removed: ${missing.join(", ")} — the viewerId check above is now searching for nothing`,
  );
});

test("every viewer-aware store function actually uses the viewer it was given", () => {
  /*
   * THE OTHER HALF, and the subtler one. The test above proves the routes
   * pass viewerId. It cannot prove the store does anything with it.
   *
   * A function that accepts `viewerId = null` and never mentions it again is
   * the most convincing possible leak: every caller is correct, every review
   * sees the parameter being handed over, and the predicate that was supposed
   * to use it is not there. The parameter becomes documentation of an
   * intention rather than an enforcement of one.
   */
  const store = [
    readFileSync(fileURLToPath(new URL("../db/org-memory-store.js", import.meta.url)), "utf8"),
    readFileSync(fileURLToPath(new URL("../db/org-knowledge-store.js", import.meta.url)), "utf8"),
  ].join("\n");
  const clean = stripComments(store);

  const bad = [];
  for (const fn of VIEWER_AWARE) {
    const at = clean.search(new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`));
    if (at < 0) continue;
    // To the next export, which is this function's body.
    const rest = clean.slice(at + 10);
    const end = rest.search(/\nexport\s/);
    const body = end < 0 ? rest : rest.slice(0, end);

    if (!/\bviewerId\b/.test(body)) {
      bad.push(`${fn}() does not mention viewerId at all`);
      continue;
    }

    /*
     * MENTIONED IS NOT USED, and "bound as a parameter" is not used either.
     * An earlier version of this check accepted viewerId appearing in the
     * params array, which getPerson does -- so deleting the predicate while
     * leaving the binding passed the test. The binding is the part that
     * looks right; the predicate is the part that does something.
     *
     * So the bar is one of exactly two things: the function builds a
     * visibility predicate itself, or it hands viewerId to another function
     * on this list that does. getAccount is the second kind -- it reads a
     * firm, which is company-level, and delegates the people to listPeople.
     */
    /*
     * THREE HELPERS, NOT TWO. The relationship ledger builds its predicate
     * with visibleInteractions/visiblePeople; knowledge builds its with
     * visibleClause from the audience store, because a page's audience is a
     * different mechanism from an interaction's visibility.
     *
     * Listing only the first two reported four correct knowledge functions as
     * broken -- the test knowing one spelling of "is this guarded" and
     * calling the others unguarded. Worth naming: a structural check is only
     * as good as its list of what correct looks like, and the failure mode is
     * confident noise rather than silence.
     */
    const buildsPredicate =
      /visibleInteractions\s*\(|visiblePeople\s*\(|visibleClause\s*\(/.test(body);
    const delegates = VIEWER_AWARE.some(
      (other) => other !== fn && new RegExp(`${other}\\s*\\(\\s*\\{[^}]*\\bviewerId\\b`).test(body),
    );
    if (!buildsPredicate && !delegates) {
      bad.push(
        `${fn}() takes viewerId, binds it perhaps, and never turns it into a visibility predicate ` +
          "nor hands it to something that does",
      );
    }
  }

  assert.deepEqual(
    bad,
    [],
    "the parameter is being accepted and ignored, which reads as a boundary and is not one:\n  " +
      bad.join("\n  "),
  );
});
