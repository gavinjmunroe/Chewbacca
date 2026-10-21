/**
 * THE SERVER IS WRITTEN IN AMERICAN ENGLISH TOO.
 *
 * "Stop using British English for stuff. Use American English."
 *
 * It had spread to about ninety files here -- behaviour, honoured, favour,
 * recognise, judgement, normalise -- almost all in comments, which no user reads
 * but every future reader of the codebase does, and some of it in PROMPTS: the
 * chat system prompt asked the model for a place's "neighbourhood" and to
 * "normalise" rows, and the place-search query builder sent "neighbourhood" to a
 * search API indexing mostly US content. Those are worse queries, not just a
 * different dialect.
 *
 * Checked rather than remembered, for the same reason the client has
 * scripts/spelling-check.mts: a convention held up by memory drifts one file at a
 * time, and an app being shown to users and investors should read as one voice.
 *
 * Run with the rest: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src", "db", "scripts"];
const SKIP = new Set(["node_modules", "_archive", ".git", "dist", "build"]);

const BRITISH = [
  "colour", "behaviour", "flavour", "honour", "neighbour", "favour", "rumour",
  "humour", "armour", "vapour", "labour", "endeavour",
  "recognise", "organise", "realise", "apologise", "emphasise", "minimise",
  "maximise", "normalise", "summarise", "prioritise", "initialise", "serialise",
  "memoise", "utilise", "analyse", "paralyse",
  "defence", "offence", "pretence", "licence",
  "centre", "metre", "theatre", "fibre", "litre", "calibre", "sombre",
  "travelled", "travelling", "labelled", "labelling", "modelling",
  "signalling", "fuelled", "marvellous", "skilful", "wilful",
  "instalment", "enrolment", "judgement", "acknowledgement",
  "whilst", "amongst", "grey", "catalogue", "dialogue", "programme",
  "kerb", "plough", "smoulder", "moustache", "aeroplane", "cheque",
];

/**
 * DELIBERATE EXCEPTIONS, each with its reason. An exception list is only
 * defensible when every line on it says why.
 */
/**
 * EVERY APPLIED MIGRATION, AS A DIRECTORY AND NOT A LIST OF FILES.
 *
 * This started as one file with one word on it, and that was the wrong shape.
 * The Americanization pass edited the comments in TEN already-applied
 * migrations, `npm run migrate` then refused to run at all -- "10 already-applied
 * migration(s) have been edited. The database no longer matches what these
 * files say." -- and a deploy was blocked by a spelling change.
 *
 * A migration file is not source. It is the text of a row in schema_migrations
 * with a checksum over it, and the checksum is the whole point: it is what
 * proves the database in front of you is the one these files describe. So the
 * rule is the directory, not the file, and it is the same rule the immutability
 * test below enforces from the other side: once a migration is committed,
 * nothing edits it. Not a typo, not a comment, not a dialect.
 */
const MIGRATIONS_DIR = "db/migrations/";

const ALLOWED = [
  {
    // A CLASSIFICATION KEYWORD, not prose. The lexicon carries BOTH spellings
    // because both are things a user types about the person next door, and
    // replacing one with the other would stop matching half of them.
    file: "src/lib/observation-dimensions.js",
    word: "neighbour",
  },
  {
    // This file lists every word it looks for.
    file: "src/lib/spelling.test.js",
    word: "*",
  },
  {
    // A CLASSIFICATION KEYWORD, not prose. American theaters are routinely
    // named "Theatre" -- the Chicago Theatre, the Paramount Theatre -- so
    // matching only "theater" would miss half the venues in an address book.
    file: "src/lib/contact-kind.js",
    word: "theatre",
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs|sql)$/.test(name)) out.push(full);
  }
  return out;
}

test("no British spellings outside the documented exceptions", () => {
  const files = ROOTS.flatMap((r) => {
    try {
      return walk(join(ROOT, r));
    } catch {
      return [];
    }
  });
  const re = new RegExp(`\\b(${BRITISH.join("|")})[a-z]*`, "gi");
  const hits = [];

  for (const file of files) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (rel.startsWith(MIGRATIONS_DIR)) continue;
    if (ALLOWED.some((a) => a.file === rel && a.word === "*")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const m of line.matchAll(re)) {
          const word = m[0].toLowerCase();
          const excused = ALLOWED.some(
            (a) => a.file === rel && (a.word === "*" || word.startsWith(a.word)),
          );
          if (!excused) hits.push(`${rel}:${i + 1} ${m[0]}`);
        }
      });
  }

  assert.deepEqual(
    hits,
    [],
    `British spellings found:\n  ${hits.slice(0, 40).join("\n  ")}`,
  );
  // A sanity floor: if the walk ever stops finding files, this test would pass
  // by looking at nothing, which is the failure mode every checker has.
  assert.ok(files.length > 100, `only walked ${files.length} files`);
});
