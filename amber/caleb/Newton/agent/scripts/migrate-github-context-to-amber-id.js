#!/usr/bin/env node
/**
 * One-way migration: calebnewtonusc/caleb-context and
 * calebnewtonusc/amber-knowledge-base GitHub repos -> amber-id Pinecone KB.
 *
 * Amber no longer reads context from GitHub at runtime. This script is the
 * bridge: it reads every markdown file from the retired context repos,
 * chunks by heading, assigns each chunk a health dimension, and ingests
 * into the target tenant's Pinecone namespace via amber-id.
 *
 * Usage (run once per target user):
 *
 *   GITHUB_TOKEN=...                    \
 *   AMBER_ID_API_URL=...                \
 *   AMBER_ID_API_KEY=...                \
 *   TARGET_DID=did:privy:xxxxx          \
 *   node Newton/agent/scripts/migrate-github-context-to-amber-id.js
 *
 * Optional:
 *   CONTEXT_REPOS=calebnewtonusc/caleb-context,calebnewtonusc/amber-knowledge-base
 *   DRY_RUN=1                           # print plan, write nothing
 *
 * amber-id side: this script hits POST /knowledge/ingest-as which must be
 * implemented admin-side (x-api-key auth, body { target_did, items[] }).
 * See FOLLOWUP.md for the amber-id backend task.
 *
 * Exit codes: 0 = success, 1 = skipped (bad config), 2 = ingest error.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const AMBER_ID_API_URL = process.env.AMBER_ID_API_URL;
const AMBER_ID_API_KEY = process.env.AMBER_ID_API_KEY;
const TARGET_DID = process.env.TARGET_DID;
// Dry-run is now the DEFAULT — this script writes user knowledge to
// production Pinecone. Operators must opt in to the destructive path
// with APPLY=1 (preferred) or the legacy DRY_RUN=0. Any other value
// (including unset) leaves the script in dry-run.
const APPLY = process.env.APPLY === "1" || process.env.DRY_RUN === "0";
const DRY_RUN = !APPLY;

// Canonical retired context source. Extend via CONTEXT_REPOS if you have
// other repos to migrate before archival.
const DEFAULT_REPOS = ["calebnewtonusc/caleb-context"];
const REPOS = (process.env.CONTEXT_REPOS || DEFAULT_REPOS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Filename -> most-fitting dimension. Anything not in this map defaults
// to "intellectual" (the catch-all for knowledge-hemisphere content).
const FILENAME_TO_DIMENSION = [
  { match: /CALEB\.md$/i, dim: "spiritual" },
  { match: /NOW\.md$/i, dim: "intellectual" },
  { match: /PEOPLE\.md$/i, dim: "social" },
  { match: /STACK\.md$/i, dim: "intellectual" },
  { match: /SYSTEM\.md$/i, dim: "intellectual" },
  { match: /STORIES|EXPERIENCES/i, dim: "emotional" },
  { match: /health|wellness/i, dim: "physical" },
  { match: /money|finance|business/i, dim: "financial" },
  { match: /prayer|faith|church|scripture/i, dim: "spiritual" },
  { match: /people|contact|team/i, dim: "social" },
];

function dimensionForFilename(path) {
  for (const { match, dim } of FILENAME_TO_DIMENSION) {
    if (match.test(path)) return dim;
  }
  return "intellectual";
}

function chunk(text, path) {
  // Split on markdown H2 headings. Fall back to 1500-char windows if no H2.
  const parts = text.split(/\n(?=##\s)/);
  if (parts.length > 1) {
    return parts.map((p) => p.trim()).filter(Boolean);
  }
  const windows = [];
  const WIN = 1500;
  for (let i = 0; i < text.length; i += WIN) {
    windows.push(text.slice(i, i + WIN));
  }
  return windows;
}

async function listRepoFiles(repo) {
  const out = [];
  async function walk(dir = "") {
    const url = `https://api.github.com/repos/${repo}/contents/${dir}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[${repo}] list ${dir || "/"} ${res.status}`);
      return;
    }
    const items = await res.json();
    for (const item of items) {
      if (item.type === "file" && /\.(md|mdx|txt)$/i.test(item.name)) {
        out.push(item.path);
      } else if (item.type === "dir") {
        await walk(item.path);
      }
    }
  }
  await walk();
  return out;
}

async function readRepoFile(repo, path) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  try {
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function ingestItems(items) {
  if (DRY_RUN) {
    console.log(`[dry-run] would ingest ${items.length} items`);
    return { ok: true, count: items.length };
  }
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/ingest-as`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify({ target_did: TARGET_DID, items }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ingest-as ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({ ok: true }));
}

async function main() {
  if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is required.");
    process.exit(1);
  }
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
    console.error("AMBER_ID_API_URL and AMBER_ID_API_KEY are required.");
    process.exit(1);
  }
  if (!TARGET_DID) {
    console.error(
      "TARGET_DID (the Privy DID receiving the migrated KB) is required.",
    );
    process.exit(1);
  }

  console.log(`Target DID: ${TARGET_DID}`);
  console.log(`Repos: ${REPOS.join(", ")}`);
  if (DRY_RUN) {
    console.log(
      "DRY-RUN (default). Re-run with APPLY=1 to actually write to amber-id.",
    );
  } else {
    console.log("APPLY=1 set — writing to amber-id Pinecone for real.");
  }

  let total = 0;
  for (const repo of REPOS) {
    console.log(`\n[${repo}] listing files...`);
    const paths = await listRepoFiles(repo);
    console.log(`[${repo}] ${paths.length} files`);

    const batch = [];
    for (const p of paths) {
      const text = await readRepoFile(repo, p);
      if (!text) continue;
      const dim = dimensionForFilename(p);
      const chunks = chunk(text, p);
      for (let i = 0; i < chunks.length; i++) {
        batch.push({
          text: chunks[i],
          kind: "context",
          source: `github:${repo}/${p}#chunk-${i}`,
          healthDimension: dim,
          visibility: "private",
          extra: { repo, path: p, chunkIndex: i, chunkCount: chunks.length },
        });
      }
    }

    console.log(`[${repo}] prepared ${batch.length} chunks`);
    if (batch.length === 0) continue;

    // Ingest in pages of 50 to avoid request-size limits.
    const PAGE = 50;
    for (let i = 0; i < batch.length; i += PAGE) {
      const slice = batch.slice(i, i + PAGE);
      try {
        await ingestItems(slice);
        total += slice.length;
        console.log(`[${repo}] ingested ${i + slice.length}/${batch.length}`);
      } catch (err) {
        console.error(`[${repo}] ingest error at batch ${i}: ${err.message}`);
        process.exit(2);
      }
    }
  }

  console.log(`\nDone. ${total} chunks ingested for ${TARGET_DID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
