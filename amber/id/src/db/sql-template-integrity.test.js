/**
 * A STRAY BACKTICK INSIDE A SQL TEMPLATE LITERAL IS VALID JAVASCRIPT AND A
 * SILENTLY TRUNCATED QUERY. THIS IS THE GUARD.
 *
 * Run with the rest: npm test
 *
 * WHAT HAPPENED. address-book-store.js had a prose comment INSIDE its SQL
 * template that spelled the jsonb concatenation operator in backticks, because
 * backticks are how you write an operator in a comment. The template literal is
 * also delimited by backticks, so the first one closed the string:
 *
 *   const sql = <btick>UPDATE contacts SET ...
 *      -- the blob MERGES. <btick>||<btick> on jsonb is a key union, so
 *      -- ... the rest of the statement ...<btick>;
 *
 * which parses as
 *
 *   const sql = ("UPDATE contacts SET ...  -- the blob MERGES. ")
 *               || ("  on jsonb is a key union, so ... the rest ...");
 *
 * The left operand is a non-empty string, so `||` short-circuits and `sql` is
 * the truncated half. Postgres answered "syntax error at end of input", the
 * function's own catch swallowed it as a non-fatal enrichment failure, and
 * storeAppleCardDetails wrote NOTHING for any user on any sync, ever: no synced
 * city, no region, no title, no department, and no apple_notes -- the column
 * holding the hundreds of Apple contact notes testers kept asking about and
 * being told did not exist.
 *
 * WHY EVERY EXISTING CHECK PASSED. The file is valid JavaScript, so node, tsc
 * and eslint were all right to say nothing. The string is a real string, so
 * every unit test that inspected it passed. sql-fake.js pattern-matches SQL
 * rather than parsing it, so the fake accepted the truncated statement happily.
 * Only a real Postgres rejected it, and the sole code path that reaches a real
 * Postgres logged one warning and carried on. Nothing was ever going to catch
 * this except running the statement against an actual database, which is what
 * scripts/smoke-real-postgres.mjs now does -- and this test, which catches it in
 * a millisecond instead of a deploy.
 *
 * The scan is over the AST, not the text, so a backtick that legitimately
 * appears inside a nested template cannot trip it. It borrows eslint's parser --
 * eslint is already a dependency, and lint is the tool that should have caught
 * this -- so it adds nothing to install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Linter } from "eslint";

const ROOT = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const RULE = "amber/no-operator-between-template-literals";
const LEAK = "amber/no-leaked-concatenation-in-template";

function makeLinter() {
  const linter = new Linter({ configType: "eslintrc" });
  linter.defineRule(RULE, {
    create(context) {
      const isTemplate = (n) => n && n.type === "TemplateLiteral";
      const check = (node) => {
        // '+' IS EXCLUDED ON PURPOSE, and it is the one judgment call here.
        //
        // Joining two template literals with '+' is a real and common thing to
        // write -- there are dozens in this tree, nearly all log lines built
        // from a prefix and a detail -- so flagging it would require an
        // allowlist, and an allowlist is a thing people append to rather than
        // read.
        //
        // Every OTHER operator between two template literals is this bug. '||'
        // and '&&' short-circuit, so one half is silently discarded at runtime;
        // a comparison between two literal templates is either constant or a
        // typo. None of them appear anywhere in this tree on purpose.
        if (node.operator === "+") return;
        if (!isTemplate(node.left) || !isTemplate(node.right)) return;
        const truncated = node.left.quasis?.[0]?.value?.raw ?? "";
        context.report({
          node,
          message:
            `'${node.operator}' between two template literals -- a backtick inside the ` +
            `first one closed it early and the rest of the string was discarded. ` +
            `It ends "...${truncated.slice(-70).replace(/\n/g, "\\n")}"`,
        });
      };
      return { LogicalExpression: check, BinaryExpression: check };
    },
  });
  linter.defineRule(LEAK, {
    create(context) {
      return {
        TemplateLiteral(node) {
          for (const quasi of node.quasis) {
            const raw = quasi.value.raw;
            // A closing quote followed by '+', or a '+' at a line end followed
            // by an opening quote, INSIDE a template literal. That is a string
            // concatenation someone wrote while forgetting they were already
            // inside a template, so the source itself becomes part of the text.
            //
            // It happened in renderGathered, in the instruction that fires on
            // exactly the turns that found nothing: the model was told
            //   Do NOT reply with a short "I " +
            //   "don't have that"
            // quotes, plus sign and indentation included, on every thin answer.
            if (/"\s*\+\s*$/.test(raw) || /"\s*\+\s*\n\s*"/.test(raw)) {
              context.report({
                node: quasi,
                message:
                  "template literal contains leaked source concatenation, which reaches the " +
                  `reader verbatim: ...${raw.slice(-70).replace(/\n/g, "\\n")}`,
              });
            }
          }
        },
      };
    },
  });
  return linter;
}

test("no source file joins two template literals with a short-circuiting operator", () => {
  const linter = makeLinter();
  const files = sourceFiles(ROOT);
  assert.ok(files.length > 100, `expected to scan the whole tree, saw ${files.length} files`);

  // THE PARSER HAS TO WORK OR THIS TEST HAS TO FAIL. A guard that quietly skips
  // itself when its parser is missing is worse than no guard, because the suite
  // still goes green. This canary proves the scan can actually see the bug.
  //
  // ONE CANARY PER RULE, and the second one exists because of a mistake made
  // right here: LEAK was defined and then the sweep below was left enabling only
  // RULE, so the new guard was inert and the suite stayed green anyway. A rule
  // that is defined but not enabled is indistinguishable from a clean tree.
  const canaries = [
    [RULE, "const sql = `SELECT 1 -- note. ` || ` the rest of it `;\n"],
    [LEAK, 'const p = `say this. Do NOT say "I " +\n        "do not have that". ok`;\n'],
  ];
  for (const [rule, code] of canaries) {
    const hits = linter.verify(
      code,
      { parserOptions: { ecmaVersion: "latest", sourceType: "module" }, rules: { [RULE]: "error", [LEAK]: "error" } },
      { filename: "canary.js" },
    );
    assert.ok(
      hits.some((m) => m.ruleId === rule),
      `${rule} cannot detect the bug it exists for: ${JSON.stringify(hits)}`,
    );
  }

  const found = [];
  for (const file of files) {
    const messages = linter.verify(
      fs.readFileSync(file, "utf8"),
      { parserOptions: { ecmaVersion: "latest", sourceType: "module" }, rules: { [RULE]: "error", [LEAK]: "error" } },
      { filename: file },
    );
    for (const m of messages) {
      // A file eslint's parser cannot read is not this test's business: node
      // itself will refuse to import it, loudly, which is the outcome we want.
      if (m.fatal || (m.ruleId !== RULE && m.ruleId !== LEAK)) continue;
      found.push(`${path.relative(ROOT, file)}:${m.line} -- ${m.message}`);
    }
  }

  assert.deepEqual(found, [], `\n  ${found.join("\n  ")}\n`);
});

test("the statement storeAppleCardDetails builds is a whole statement", () => {
  // The narrow, direct assertion for the function that actually broke: the
  // template still has to contain its own last clause. It fails on the exact
  // edit that caused the outage rather than on a general pattern.
  const text = fs.readFileSync(path.join(ROOT, "db", "address-book-store.js"), "utf8");
  const match = text.match(/const sql = `([\s\S]*?)`;/);
  assert.ok(match, "could not find the UPDATE template in address-book-store.js");
  const sql = match[1];
  assert.ok(/^UPDATE contacts AS c SET/.test(sql.trim()), "the statement no longer starts with UPDATE");
  assert.ok(sql.includes("FROM (VALUES"), "the VALUES source is gone -- the template was truncated");
  assert.ok(sql.includes("WHERE c.owner_id"), "the owner scope is gone -- the template was truncated");
  assert.ok(
    !sql.includes("`"),
    "a backtick is inside the SQL template again; it will close the string and discard the rest",
  );
});
