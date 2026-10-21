/**
 * A SIGN-IN CHALLENGE MUST NOT COME BACK IN THE RESPONSE THAT ASKED FOR IT.
 *
 * THE FAILURE IS NOT A LEAK, IT IS A BYPASS. The point of mailing a sign-in
 * link is that holding the mailbox is the proof. Return the token in the
 * reply to the request that asked for it and the mailbox stops mattering:
 * anybody who can POST an address gets a session for it, and every other
 * control -- domain restriction, invitation, verification -- is decoration on
 * a door with no lock.
 *
 * IT IS ALSO THE EASIEST MISTAKE IN THE FILE, because it is the one thing
 * that makes the route pleasant to test by hand. `return { ok: true, token }`
 * saves opening a mailbox during development, works perfectly, and is three
 * characters. It has shipped in other people's products for exactly that
 * reason.
 *
 * THE RULE HAS TO BE NARROW OR IT IS USELESS. The first version of this file
 * flagged any response carrying a token and found ten -- every one of them a
 * SESSION token, returned to a caller that had just proved who it was, which
 * is the correct and necessary end of signing in. A check that cannot tell
 * those apart from the bypass is a check somebody turns off.
 *
 * So the question is not "does a response contain a token". It is: does the
 * handler that ISSUES a challenge also return it. The challenge issuers are
 * named below; inside a handler that calls one, whatever it produced must not
 * reach the reply.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./", import.meta.url));

/**
 * Functions that mint a secret whose whole purpose is to be DELIVERED
 * somewhere else -- an inbox, an SMS -- rather than handed back.
 */
const CHALLENGE_ISSUERS = ["issueLoginToken", "issueOtp", "issueOtpCode", "issueMagicLink"];

/**
 * Strip comments WITHOUT destroying line numbers.
 *
 * The obvious `replace(/\/\*[\s\S]*?\*\//g, " ")` collapses a forty-line
 * header into one space, after which every line number this file reports is
 * wrong by however long the comments above it were -- and these files are
 * heavily commented, so "org-auth.js:69" pointed forty lines from the truth.
 * A finding nobody can locate is a finding nobody acts on.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function routeFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => ({ file: f, src: stripComments(readFileSync(join(DIR, f), "utf8")) }));
}

/** The text from `from` to the close of the brace or paren it opens. */
function balanced(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

/** Every `app.<verb>("path", ... )` handler in a file, with its body. */
function handlers(src) {
  const out = [];
  for (const m of src.matchAll(/app\.(get|post|patch|put|delete)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const body = balanced(src, open);
    const path = body.match(/"([^"]+)"/)?.[1] ?? "?";
    out.push({ path, body, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

test("a handler that issues a sign-in challenge does not return it", () => {
  const bad = [];

  for (const { file, src } of routeFiles()) {
    for (const h of handlers(src)) {
      const issuer = CHALLENGE_ISSUERS.find((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(h.body));
      if (!issuer) continue;

      /*
       * What the issuer's result was called. `const issued = await
       * issueLoginToken(...)` is the shape in this codebase; anything else
       * is reported rather than guessed at, because silently failing to find
       * the variable would turn this into a test that always passes.
       */
      const assigned = h.body.match(
        new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*await\\s+${issuer}\\s*\\(`),
      );
      if (!assigned) {
        bad.push(
          `${file}:${h.line} ${h.path} calls ${issuer}() without assigning it to a name — ` +
            "this check cannot follow where the token went, so it has to be read by hand",
        );
        continue;
      }
      const name = assigned[1];

      /*
       * Every response this handler produces, and whether the issued value
       * appears in it -- as `issued.token`, as a destructured `token`, or
       * bare.
       */
      for (const r of h.body.matchAll(/(?:return\s+reply[^;]*?\.send\s*\(|return\s+)\{/g)) {
        const open = h.body.indexOf("{", r.index + r[0].length - 1);
        const text = balanced(h.body, open);
        const mentionsIssued =
          new RegExp(`\\b${name}\\s*\\.\\s*token\\b`).test(text) ||
          new RegExp(`(^|[{,\\s])${name}\\s*(?:,|:|\\}|$)`).test(text) ||
          /(^|[{,\s])token\s*(?:,|:|\}|$)/.test(text);
        if (mentionsIssued) {
          const line = h.line + h.body.slice(0, r.index).split("\n").length - 1;
          bad.push(
            `${file}:${line} ${h.path} issues a sign-in challenge and returns it — ` +
              "holding the mailbox is no longer the proof",
          );
        }
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "anybody who can post an address would get a session for it:\n  " + bad.join("\n  "),
  );
});

test("the challenge issuers this check watches still exist", () => {
  /*
   * THE WAY THE TEST ABOVE GOES QUIET. Rename issueLoginToken and the check
   * finds no handlers, examines nothing, and reports green forever. A list of
   * names only protects anything while the names are real -- so at least one
   * of them has to still be somewhere in the tree.
   */
  const src = readdirSync(fileURLToPath(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(fileURLToPath(new URL("../db/", import.meta.url)), f), "utf8"))
    .join("\n");

  const found = CHALLENGE_ISSUERS.filter((fn) =>
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`).test(src),
  );
  assert.ok(
    found.length > 0,
    `none of ${CHALLENGE_ISSUERS.join(", ")} exist any more — the disclosure check is searching for nothing`,
  );
});
