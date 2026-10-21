/**
 * SCRIPT HYGIENE AUDIT — can each script in scripts/ actually run, and is it safe
 * to run against production?
 *
 *   node scripts/script-hygiene-audit.mjs            summary
 *   node scripts/script-hygiene-audit.mjs --verbose   every finding in full
 *
 * NEEDS NO DATABASE. This reads source.
 *
 * WHY IT EXISTS. Two failures, one after the other, both mine:
 *
 *   sql-prepare-audit.mjs and contact-rollup.js reached the real database
 *   without materializing the Railway service-account JSON first. Every other
 *   script does it, and migrate.js says in capitals that it MUST happen before
 *   sql.js is imported. Without it the Cloud SQL connector falls through to
 *   whoever's personal gcloud login is lying around and dies on
 *   `invalid_grant: reauth related error (invalid_rapt)` -- forty lines of Google
 *   stack trace that look nothing like the actual cause.
 *
 *   observations-smoke.mjs and observations-compat-smoke.mjs imported
 *   "./db/sql.js", a path that does not exist under scripts/, and then TRUNCATE
 *   observations. They were harmless only because they crashed on import. An
 *   import error is not a safety mechanism, and the day somebody "fixes the
 *   path" is the day production loses a table.
 *
 * THREE CHECKS, each about a way a script can be wrong before it does anything:
 *
 *   1. imports resolve. A relative import to a file that does not exist means
 *      the script cannot run -- and a script that cannot run is either dead or a
 *      trap waiting for someone to correct the path.
 *
 *   2. anything reaching the real pool materializes credentials first. Scripts
 *      going through smoke-db.mjs are exempt: that module refuses to connect
 *      without SMOKE_DATABASE_URL and a smoke_marker table.
 *
 *   3. anything that TRUNCATEs or DROPs is gated. Through smoke-db.mjs, or
 *      behind an explicit confirmation flag. Destruction must be something you
 *      asked for by name.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "scripts");
const VERBOSE = process.argv.includes("--verbose");

const findings = [];
const add = (kind, file, detail) => findings.push({ kind, file, detail });

for (const name of fs.readdirSync(DIR).sort()) {
  if (!/\.(js|mjs)$/.test(name)) continue;
  const file = path.join(DIR, name);
  const text = fs.readFileSync(file, "utf8");
  const rel = path.join("scripts", name);

  // ── 1. do the relative imports resolve ────────────────────────────────────
  const imports = [
    ...text.matchAll(/^\s*import\s+[^;]*?from\s+["'](\.[^"']+)["']/gm),
    ...text.matchAll(/\bawait\s+import\(\s*["'](\.[^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  for (const spec of new Set(imports)) {
    const target = path.resolve(DIR, spec);
    const candidates = [target, `${target}.js`, `${target}.mjs`,
                        path.join(target, "index.js")];
    if (!candidates.some((c) => fs.existsSync(c))) {
      add("unresolved-import", rel, spec);
    }
  }

  // ── 2 and 3 ───────────────────────────────────────────────────────────────
  const viaSmokeDb = /["']\.\/smoke-db\.mjs["']/.test(text);
  // A harness that INJECTS a pool built from SMOKE_DATABASE_URL is gated the same
  // way smoke-db.mjs is -- it can only ever reach the database it was pointed at.
  // The _e2e-* runners do exactly that, and flagging them was a false positive.
  const injectsTestPool = text.includes("__injectPoolForSmokeTests");
  // A real pool: sql.js reached by an import, not merely mentioned in prose.
  const reachesPool = imports.some((s) => /(^|\/)(\.\.\/src\/)?db\/sql(\.js)?$/.test(s)
                                       || s.endsWith("src/db/sql.js"));
  const hasCreds = text.includes("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (reachesPool && !viaSmokeDb && !injectsTestPool && !hasCreds) {
    add("no-credentials", rel,
        "imports src/db/sql.js but never materializes GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }

  // ONLY SQL COUNTS AS SQL. The drift audits carry "DELETE FROM" inside their own
  // matching patterns and keyword lists, and reporting those as destructive is
  // exactly the false positive that teaches people to skip an audit's output.
  // Real SQL in this codebase lives in template literals, same assumption the
  // other audits make.
  const literals = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("\n;\n");
  const DESTRUCTIVE = /\b(TRUNCATE|DROP\s+TABLE|DROP\s+DATABASE|DELETE\s+FROM)\b/i;
  const destroys = DESTRUCTIVE.test(literals);
  const gated = viaSmokeDb
    || injectsTestPool
    || /--confirm[\w-]*/.test(text)
    || /SMOKE_DATABASE_URL/.test(text);
  if (destroys && !gated) {
    const verb = literals.match(DESTRUCTIVE)[1];
    add("ungated-destruction", rel, `${verb.toUpperCase()} with no smoke gate and no confirm flag`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const KIND = {
  "unresolved-import": "cannot run: an import does not resolve",
  "no-credentials": "reaches the real database without service-account credentials",
  "ungated-destruction": "destroys data with no gate",
};
const byKind = new Map();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}

const total = fs.readdirSync(DIR).filter((n) => /\.(js|mjs)$/.test(n)).length;
console.log(`\n  ${total} script(s) in scripts/\n`);
if (findings.length === 0) {
  console.log("  Every import resolves, every database reach carries credentials,\n" +
              "  and nothing destroys data without a gate.\n");
  process.exit(0);
}

for (const [kind, list] of byKind) {
  console.log(`  ${KIND[kind]}  (${list.length})`);
  for (const f of list) {
    console.log(`      ${f.file}`);
    if (VERBOSE) console.log(`        ${f.detail}`);
  }
  console.log("");
}
process.exit(1);
