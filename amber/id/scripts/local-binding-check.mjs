/**
 * `export { X } from "..."` CREATES NO LOCAL BINDING, AND THIS HAS NOW SHIPPED
 * THREE TIMES.
 *
 *   node scripts/local-binding-check.mjs
 *
 * WHAT IT IS. These two lines look interchangeable and are not:
 *
 *   export { REACTION_KINDS } from "../lib/reaction-kinds.js";   // re-export only
 *   import { REACTION_KINDS } from "../lib/reaction-kinds.js";   // local binding
 *   export { REACTION_KINDS };                                   // ...and re-export
 *
 * The first hands the name to importers of this module and leaves THIS module
 * without it. Any function in the file that reads the name throws
 * `ReferenceError: X is not defined` -- but only when it is CALLED, so the
 * module imports cleanly, the server boots, every route registers, and the
 * failure surfaces as one endpoint 500ing in production.
 *
 * WHY NOTHING ELSE CATCHES IT. It is valid syntax and valid ESM, so the parser
 * is happy. It is not a typo, so no spell check sees it. There are no types in
 * this codebase to notice the name is unbound. And the unit tests import the
 * module and call the exported function -- which works, because the IMPORTER
 * gets the binding; only the module's own internals do not.
 *
 * THE THREE TIMES:
 *   post-social.js       isReactionKind is not defined  (found in review)
 *   note-media-store.js  ReferenceError in production -- "Could not save that
 *                        reaction", and it took feed comments and voice notes
 *                        with it
 *   dm-store.js          the same shape, unfired, waiting for the first person
 *                        to react to a direct message
 *
 * WHAT THIS DOES. Finds every `export { ... } from "..."`, and for each name it
 * re-exports, asks whether the same file mentions that name anywhere OUTSIDE
 * that statement. If it does, the file needs a real import and does not have
 * one. That is the whole rule, and it is exact rather than heuristic: a name
 * referenced in a module that has no binding for it is a ReferenceError waiting
 * for a caller.
 *
 * A file that only forwards a name -- never touching it -- is fine and is left
 * alone. That is what a re-export is for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ROOTS = ["src"];

/** Every .js under the roots, excluding tests and node_modules. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, so a name that appears only in a note about this very bug
 * does not count as a use. Conservative in the right direction: it can only
 * remove text, so a real use is never hidden.
 *
 * STRING LITERALS ARE LEFT ALONE, and the first version of this file did strip
 * them -- which broke the check completely and is worth the note. Blanking
 * `"../lib/reaction-kinds.js"` turns
 *
 *   export { REACTION_KINDS } from "../lib/reaction-kinds.js";
 *
 * into `export { REACTION_KINDS } from  ;`, which the statement pattern below
 * (quite reasonably) does not match -- so the check found nothing, reported
 * "no unbound re-exports in 278 files", and passed on a file I had just broken
 * on purpose to test it. A gate that cannot fail is worse than no gate, because
 * it is also a claim.
 *
 * The mutation test is the only reason I know: I broke note-media-store.js
 * again, ran this, and it said clean.
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const RE_EXPORT = /export\s*\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?/g;

const problems = [];
const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const stripped = code(raw);
  for (const m of stripped.matchAll(RE_EXPORT)) {
    // The name this module would have used, i.e. the LOCAL side of `as`.
    const names = m[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const as = /^(.+?)\s+as\s+(.+)$/.exec(part);
        return as ? as[2].trim() : part.trim();
      })
      .filter((n) => n && n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n));

    // Everything in the file except this statement.
    const rest = stripped.slice(0, m.index) + stripped.slice(m.index + m[0].length);
    for (const name of names) {
      const used = new RegExp(`\\b${name}\\b`).test(rest);
      if (!used) continue;
      // Unless a real import already provides it under that name.
      const imported = new RegExp(
        `import\\s*\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${name}\\b[^}]*\\}\\s*from`,
      ).test(rest);
      if (imported) continue;
      const line = raw.slice(0, raw.indexOf(m[0].slice(0, 24))).split("\n").length;
      problems.push({
        file: relative(ROOT, file),
        line,
        name,
      });
    }
  }
}

if (problems.length === 0) {
  console.log(`No unbound re-exports in ${files.length} files.`);
  process.exit(0);
}

console.log("Re-exported names this module also USES, with no local binding:\n");
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}  "${p.name}" is re-exported but never imported here.`);
}
console.log(
  `\n${problems.length} problem(s). ` +
    `Each one is a ReferenceError the first time the function that reads it is called.\n` +
    `Fix: add \`import { ${problems[0].name} } from "..."\` and re-export it separately.`,
);
process.exitCode = 1;
