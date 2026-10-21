#!/usr/bin/env node
/**
 * RUN THE LIBRARY TESTS.
 *
 * The layout is written in TypeScript and imported from the tests as ".js",
 * which is what TypeScript's own resolution expects and what Node cannot do.
 * Rather than have every test run be a hand-typed tsc invocation that somebody
 * has to remember -- and that therefore does not get run -- this transpiles
 * lib/ into a scratch directory and runs node --test against it.
 *
 * TYPE ERRORS ARE NOT THIS SCRIPT'S JOB. `tsc --noEmit -p .` checks types
 * against the whole app; here the type-only imports are elided and tsc's exit
 * code is deliberately ignored, so a missing type declaration cannot stop the
 * behavioural tests from running. What is checked is that the JavaScript came
 * out.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".lib-test-build");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const lib = path.join(root, "lib");
const sources = readdirSync(lib).filter((f) => f.endsWith(".ts"));
const tests = readdirSync(lib).filter((f) => f.endsWith(".test.mjs"));
if (tests.length === 0) {
  console.log("no lib tests");
  process.exit(0);
}
for (const f of [...sources, ...tests]) cpSync(path.join(lib, f), path.join(out, f));

const tsc = path.join(root, "node_modules", ".bin", "tsc");
try {
  execFileSync(
    tsc,
    [
      ...sources.map((f) => path.join(out, f)),
      "--target", "es2020",
      "--module", "esnext",
      "--moduleResolution", "bundler",
      "--outDir", out,
    ],
    { stdio: "pipe" },
  );
} catch {
  // Unresolved type-only imports are expected here; the emit still happens.
}

/**
 * ADD THE EXTENSION NODE INSISTS ON AND THE BUNDLER REFUSES.
 *
 * The app is bundled by Turbopack, which resolves `./constellation` from a .ts
 * file and rejects `./constellation.js`. Node's loader wants the opposite: a
 * real path with a real extension. Writing the source to please Node breaks
 * `next build`, and writing it to please Turbopack breaks the tests -- so the
 * source is written the way the app needs it and the rewrite happens here,
 * where the two worlds meet. Only relative specifiers with no extension are
 * touched.
 */
for (const file of sources.map((f) => f.replace(/\.ts$/, ".js"))) {
  const full = path.join(out, file);
  if (!existsSync(full)) continue;
  const src = readFileSync(full, "utf8").replace(
    /(\bfrom\s*")(\.\.?\/[^"]*?)(")/g,
    (m, a, spec, b) => (/\.[a-z]+$/i.test(spec) ? m : `${a}${spec}.js${b}`),
  );
  writeFileSync(full, src);
}

const missing = sources
  .map((f) => f.replace(/\.ts$/, ".js"))
  .filter((f) => !existsSync(path.join(out, f)));
if (missing.length) {
  console.error(`transpile produced nothing for: ${missing.join(", ")}`);
  process.exit(1);
}

execFileSync(
  process.execPath,
  ["--test", ...tests.map((f) => path.join(out, f))],
  { stdio: "inherit" },
);
