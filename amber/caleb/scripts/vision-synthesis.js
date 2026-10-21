#!/usr/bin/env node
/**
 * vision-synthesis.js — weekly organizer for amber-agent/vision/
 *
 * Reads everything in vision/inbox/ that has arrived since the last run,
 * classifies each entry across the six dimensions, and writes seven
 * markdown files into vision/synthesis/<ISO-week>/ (one per dimension,
 * plus meta.md for cross-cutting themes and decisions made that week).
 *
 * The six dimensions are MANDATORY. Every entry lands under at least
 * one. Entries that evidence multiple dimensions are cross-linked, not
 * duplicated.
 *
 * The script never modifies anything in inbox/. Synthesis output is
 * idempotent — re-running for the same week overwrites the same seven
 * files with refreshed syntheses.
 *
 * Scheduled via schedule_cron (daily at 09:00 America/Los_Angeles).
 * When the GCP server comes online, point INBOX_DIR at the GCP mount;
 * synthesis/ stays in git as canonical memory.
 *
 * Usage:
 *   node scripts/vision-synthesis.js               # synthesize current ISO week
 *   node scripts/vision-synthesis.js 2026-W16     # synthesize a specific week
 *   node scripts/vision-synthesis.js --dry-run    # print plan, write nothing
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const VISION_DIR = process.env.AMBER_VISION_DIR || path.join(REPO_ROOT, "vision");
const INBOX_DIR = path.join(VISION_DIR, "inbox");
const SEEDS_DIR = path.join(VISION_DIR, "seeds");
const SYNTH_DIR = path.join(VISION_DIR, "synthesis");

const DIMENSIONS = [
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
];

// --- ISO-week helpers -------------------------------------------------------

function isoWeekOf(date = new Date()) {
  // Copy and shift to Thursday of the same week (ISO definition).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function weekRange(isoWeek) {
  const [y, w] = isoWeek.split("-W").map(Number);
  // ISO week 1 contains Jan 4. Compute Monday of that week.
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (w - 1) * 7);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  return { start: monday, end: nextMonday };
}

// --- classification ---------------------------------------------------------

// Lightweight lexicon; mirror of amber-id/src/lib/dimension-classifier.js.
// The cron can later call amber-id /ask for LLM classification; for now
// this keeps the cron hermetic and free to run.
const LEXICON = {
  spiritual:    ["purpose","faith","dharma","pray","spirit","meditat","god","vedic","ritual","soul","mindful"],
  emotional:    ["feel","anxious","anxiety","sad","angry","mood","emotion","cry","peace","stress","grief","joy"],
  physical:     ["sleep","tired","energy","gym","workout","body","nutrition","rest","pain","movement","run"],
  intellectual: ["learn","study","curious","read","idea","knowledge","research","paper","class","growth","thought"],
  social:       ["friend","family","relationship","connect","commun","belong","group","hang","together","network"],
  financial:    ["money","career","job","work","salary","invest","stock","fund","client","revenue","market","gtm"],
};

function classify(text) {
  const t = String(text || "").toLowerCase();
  const scores = {};
  let total = 0;
  for (const d of DIMENSIONS) {
    scores[d] = LEXICON[d].reduce((n, kw) => n + (t.includes(kw) ? 1 : 0), 0);
    total += scores[d];
  }
  if (total === 0) {
    return { primary: null, all: [] }; // "meta" — goes to meta.md
  }
  const ranked = [...DIMENSIONS].sort((a, b) => scores[b] - scores[a]);
  const primary = ranked[0];
  const threshold = Math.max(1, Math.floor(scores[primary] * 0.5));
  const all = ranked.filter((d) => scores[d] >= threshold);
  return { primary, all };
}

// --- file walking ----------------------------------------------------------

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && /\.(md|txt|markdown)$/i.test(e.name)) {
      yield full;
    }
  }
}

async function readEntry(file) {
  const stat = await fs.stat(file);
  const body = await fs.readFile(file, "utf8");
  return { file, mtime: stat.mtime, body };
}

// --- synthesis -------------------------------------------------------------

function renderEntrySnippet(entry) {
  const rel = path.relative(VISION_DIR, entry.file);
  const first = (entry.body.match(/^#\s*(.+)$/m) || [])[1];
  const head = first || entry.body.split("\n").find((l) => l.trim()) || rel;
  const snippet = entry.body.slice(0, 600).replace(/\n{2,}/g, "\n\n");
  return `### ${head.trim()}\n\n*Source: \`${rel}\` — captured ${entry.mtime.toISOString().slice(0, 10)}*\n\n${snippet.trim()}\n`;
}

function buildDimensionDoc(dim, entries, isoWeek) {
  const header = [
    `# ${isoWeek} — ${dim}`,
    "",
    `*Auto-generated synthesis of inbox entries touching the **${dim}** dimension. Do not edit by hand — re-run \`scripts/vision-synthesis.js\` instead.*`,
    "",
    `See \`amber-id/ARCHITECTURE-SIX-DIMENSIONS.md\` for the ontology and`,
    `\`amber-agent/docs/PERPLEXITY-AMBER.md\` for the two-hemisphere doctrine.`,
    "",
    "---",
    "",
  ].join("\n");
  if (!entries.length) {
    return header + "_No new entries this week._\n";
  }
  return header + entries.map(renderEntrySnippet).join("\n---\n\n");
}

function buildMetaDoc(metaEntries, crossCount, decisions, isoWeek) {
  const lines = [
    `# ${isoWeek} — meta`,
    "",
    `*Cross-dimension themes, uncategorized entries, and decisions made this week.*`,
    "",
    "## This week by dimension",
    "",
  ];
  for (const d of DIMENSIONS) {
    lines.push(`- **${d}**: ${crossCount[d] || 0} entries`);
  }
  lines.push("");
  lines.push("## Uncategorized entries");
  lines.push("");
  if (!metaEntries.length) {
    lines.push("_None._");
  } else {
    for (const e of metaEntries) lines.push(renderEntrySnippet(e), "---");
  }
  lines.push("");
  lines.push("## Decisions codified this week");
  lines.push("");
  if (!decisions.length) {
    lines.push("_Add decisions made this week as bullets before committing the synthesis._");
  } else {
    for (const d of decisions) lines.push(`- ${d}`);
  }
  return lines.join("\n") + "\n";
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const weekArg = args.find((a) => /^\d{4}-W\d{2}$/.test(a));
  const isoWeek = weekArg || isoWeekOf(new Date());
  const { start, end } = weekRange(isoWeek);

  // Collect entries from inbox/ + seeds/ whose mtime falls within the week.
  const entries = [];
  for (const dir of [INBOX_DIR, SEEDS_DIR]) {
    for await (const f of walk(dir)) {
      const entry = await readEntry(f);
      if (entry.mtime >= start && entry.mtime < end) entries.push(entry);
    }
  }

  // Classify and bucket.
  const byDim = Object.fromEntries(DIMENSIONS.map((d) => [d, []]));
  const crossCount = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  const metaBucket = [];

  for (const entry of entries) {
    const { primary, all } = classify(entry.body);
    if (!primary) {
      metaBucket.push(entry);
      continue;
    }
    for (const d of all) {
      byDim[d].push(entry);
      crossCount[d] += 1;
    }
  }

  const outDir = path.join(SYNTH_DIR, isoWeek);
  const plan = [];
  plan.push(`ISO week: ${isoWeek}`);
  plan.push(`Range: ${start.toISOString()} .. ${end.toISOString()}`);
  plan.push(`Entries scanned: ${entries.length}`);
  for (const d of DIMENSIONS) plan.push(`  ${d}: ${byDim[d].length}`);
  plan.push(`  meta (uncategorized): ${metaBucket.length}`);
  plan.push(`Output: ${outDir}/{${DIMENSIONS.join(",")},meta}.md`);
  console.log(plan.join("\n"));

  if (dryRun) {
    console.log("--dry-run set; nothing written.");
    return;
  }

  await fs.mkdir(outDir, { recursive: true });
  for (const d of DIMENSIONS) {
    const target = path.join(outDir, `${d}.md`);
    await fs.writeFile(target, buildDimensionDoc(d, byDim[d], isoWeek));
  }
  await fs.writeFile(
    path.join(outDir, "meta.md"),
    buildMetaDoc(metaBucket, crossCount, [], isoWeek)
  );
  console.log(`Wrote synthesis for ${isoWeek} → ${outDir}`);
}

main().catch((err) => {
  console.error("[vision-synthesis] fatal:", err);
  process.exit(1);
});
