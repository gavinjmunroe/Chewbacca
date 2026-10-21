/**
 * THE DIMENSION WORKER. Drains the classification queue.
 *
 *   railway run node scripts/dimension-worker.js            one pass, then exit
 *   railway run node scripts/dimension-worker.js --watch    keep going
 *   railway run node scripts/dimension-worker.js --status   queue depth only
 *   railway run node scripts/dimension-worker.js --no-rollup  skip the rollup
 *   railway run node scripts/dimension-worker.js --no-embed   skip embedding
 *   railway run node scripts/dimension-worker.js --batch      half price, slow
 *   railway run node scripts/dimension-worker.js --reset-attempts   re-open
 *       rows that never got a model answer (lexicon/none/pending)
 *   railway run node scripts/dimension-worker.js --reset-all        ALSO re-open
 *       rows the model already answered — use after a PROMPT CHANGE, when the
 *       existing answers are the ones you no longer trust. Never touches a row
 *       a person corrected.
 *   railway run node scripts/dimension-worker.js --force-rollup   recompute
 *       contact_dimension_state for EVERY owner, ignoring staleness. Needed
 *       after a bulk DELETE: a timestamp comparison can only notice rows that
 *       got NEWER, and a deletion is the opposite of that, so the rollup
 *       otherwise reports itself current while scores derived from deleted facts
 *       sit there untouched.
 *
 * --batch USES THE MESSAGE BATCHES API: same prompt, same parser, HALF the cost,
 * but results arrive within a 24-hour window instead of seconds. Correct for a
 * backfill nobody is waiting on; wrong for anything else, which is why it is
 * opt-in and why it refuses to combine with --watch (a watcher that blocks for
 * half an hour per pass is not a watcher). It also raises the default batch to
 * 500 facts, because the whole point is one big asynchronous job rather than
 * twenty small synchronous ones -- override with --limit=N.
 *
 * THREE JOBS, ONE CRON, IN THIS ORDER ON PURPOSE:
 *   classify  assigns the dimensions the ambiguous facts are missing
 *   embed     fills observations.embedding so semantic search can see them
 *   rollup    turns the tags into contact_dimension_state, the standing
 *             per-person score the shortlist screens read
 * The rollup goes last because it reads what the other two just wrote; running
 * it first computes scores from tags the classify pass is about to change.
 *
 * The lexicon classifies every observation as it is written. This picks up the
 * ones it was not sure about and asks a model. Running it is OPTIONAL in the
 * sense that nothing breaks without it -- those rows keep the lexicon's guess --
 * and not optional in the sense that the quality of the ambiguous half of the
 * corpus depends on it.
 *
 * ONE PASS PER RUN BY DEFAULT, because a cron entry that exits is easier to
 * reason about than a daemon that might be wedged. --watch exists for a backlog.
 *
 * It is safe to run several at once: rows are claimed with FOR UPDATE SKIP
 * LOCKED, so two workers take disjoint batches without talking to each other.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same credential shim the other scripts use: Railway hands the service account
// as JSON in an env var, and the Cloud SQL connector wants a file path.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-dimension-worker.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { runDimensionPass, pendingCount, resetAttempts } = await import("../src/db/dimension-queue.js");
const { runRollupPass, ownersNeedingRollup } = await import("../src/db/retrieval.js");
const { runEmbeddingPass, unembeddedCount } = await import("../src/db/embedding-queue.js");
const { closePool } = await import("../src/db/sql.js");
const { preflightModel, classifyViaBatchApi } = await import(
  "../src/lib/observation-dimensions.js"
);

const argv = process.argv.slice(2);
const watch = argv.includes("--watch");
const statusOnly = argv.includes("--status");
const noRollup = argv.includes("--no-rollup");
const noEmbed = argv.includes("--no-embed");
const batchMode = argv.includes("--batch");
// --reset-all implies --reset-attempts: it is the same operation over a wider
// set of statuses, and requiring both flags would be a trap.
const resetAll = argv.includes("--reset-all");
const forceRollup = argv.includes("--force-rollup");
const limitArg = argv.find((a) => a.startsWith("--limit="));
// Batch mode defaults far higher on purpose: the discount is per token, but the
// WAIT is per batch, so one 500-fact batch costs the same wall clock as one
// 25-fact batch and settles twenty times as much work for it.
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : batchMode ? 500 : 25;

if (batchMode && watch) {
  console.error(
    "--batch and --watch are mutually exclusive: a batch pass can block for up to\n" +
      "DIMENSION_BATCH_MAX_WAIT_MS (default 30 min), so watching would idle rather\n" +
      "than keep up. Use --batch for a one-shot backfill, --watch to keep current.",
  );
  process.exit(2);
}

// Between passes in --watch. Long enough that an idle queue is not a busy loop,
// short enough that a voice note recorded now is classified within the minute.
const IDLE_MS = 20000;
const BUSY_MS = 1000;

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`\n  ${sig} — finishing the current pass, then stopping.`);
  });
}

try {
  if (!process.env.OPENAI_API_KEY && !noEmbed) {
    console.log(
      "\n  OPENAI_API_KEY is not set. The embedding pass will write nothing and\n" +
        "  facts will burn their three attempts; semantic search stays dark.\n" +
        "  Set the key, or pass --no-embed.\n",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "\n  ANTHROPIC_API_KEY is not set. Every classify call will return null,\n" +
        "  rows will burn their attempts and settle for the lexicon's guess.\n" +
        "  Set the key, or do not run this.\n",
    );
  }

  const depth = await pendingCount();
  const unembedded = await unembeddedCount();
  const stale = await ownersNeedingRollup(500);
  console.log(`\n  queue: ${depth} observation${depth === 1 ? "" : "s"} awaiting a model`);
  console.log(`  vectors: ${unembedded} observation${unembedded === 1 ? "" : "s"} without an embedding`);
  console.log(`  rollup: ${stale.length} owner${stale.length === 1 ? "" : "s"} with facts newer than their scores`);
  if (statusOnly) {
    await closePool().catch(() => {});
    process.exit(0);
  }

  // --reset-attempts puts rows a failed run gave up on back in the queue.
  // --reset-all additionally re-opens rows the model already answered, for use
  // after a prompt change. Neither ever touches a row a person corrected --
  // see resetAttempts().
  if (argv.includes("--reset-attempts") || resetAll) {
    const n = await resetAttempts({ includeModel: resetAll });
    console.log(
      `\n  ${n} observation(s) put back in the queue.\n` +
      `  Rows the model actually answered, and rows a person corrected, were left alone.\n`,
    );
    await closePool().catch(() => {});
    process.exit(0);
  }

  // ── PREFLIGHT: PROVE THE MODEL ANSWERS BEFORE CLAIMING A SINGLE ROW ────────
  //
  // Claiming a row burns one of its three attempts whether or not the model ever
  // replies, and a row that runs out settles for the lexicon's guess and never
  // asks again. So a wrong model name or a bad key does not just fail -- run it
  // three times and it quietly finalises a thousand facts with the wrong answer,
  // unrecoverably, with a log that says "classified 0" and nothing else.
  //
  // One call on two words, before anything is claimed. If it fails, nothing has
  // been touched.
  const pre = await preflightModel();
  if (!pre.ok) {
    console.error(
      `\n  ✗ The classifier is not answering, so NOTHING was claimed.\n\n` +
      `    ${pre.reason}\n\n` +
      `  No attempts were burned and no rows were changed. Fix the configuration\n` +
      `  and run this again — the queue is exactly as it was.\n`,
    );
    await closePool().catch(() => {});
    process.exit(1);
  }
  console.log(
    `  preflight: ${pre.model} answered ` +
    `[${pre.dimensions.join(", ") || "no dimensions"}] for a test fact about running\n`,
  );

  let totals = { claimed: 0, classified: 0, unclassified: 0, deferred: 0 };

  // AN IDLE --watch USED TO PRINT NOTHING AT ALL, and the "done" summary below
  // only runs when the loop EXITS, which in watch mode it never does. So a
  // completed drain looked identical to a hung process: the pass lines simply
  // stopped and the terminal sat there. That was reported as "stuck" three
  // separate times, which is a defect in this script and not in anyone's
  // patience. An idle worker now says it is idle, once, with the totals, and
  // then heartbeats so it is visibly alive without scrolling.
  let announcedIdle = false;
  let idleTicks = 0;
  const HEARTBEAT_EVERY = 5; // × IDLE_MS ≈ every 100s

  // DEFENSE IN DEPTH FOR THE ROLLUP, independent of the predicate fix in
  // retrieval.ownersNeedingRollup. A rollup that reports stale owners and then
  // recomputes zero rows has, by definition, made no progress -- so if it says
  // that repeatedly it will say it forever, and --watch becomes a hot loop that
  // looks like work. Three in a row and the rollup stands down for the rest of
  // the run, loudly, instead of pinning a CPU and filling the log with a line
  // that means nothing. Any pass that recomputes even one row resets it.
  const ROLLUP_STALL_LIMIT = 3;
  let rollupNoProgress = 0;
  let rollupStoodDown = false;

  do {
    const t0 = Date.now();
    // The classifier is injected rather than branched inside the queue, so the
    // two transports share every line of claim/apply/settle logic. classify()
    // has one contract on both: an array positionally matching the input, null
    // where the model did not answer for that row.
    const r = await runDimensionPass(
      batchMode ? { limit: LIMIT, classify: classifyViaBatchApi } : { limit: LIMIT },
    );
    for (const k of Object.keys(totals)) totals[k] += r[k];
    if (r.claimed > 0) {
      console.log(
        `  pass: claimed ${r.claimed}, classified ${r.classified}, ` +
          `retry-later ${r.deferred}, gave-up ${r.unclassified}  (${Date.now() - t0}ms)`,
      );
    }
    if (!noEmbed) {
      const emb = await runEmbeddingPass({ limit: 50 });
      if (emb.claimed > 0) {
        console.log(`  embed: claimed ${emb.claimed}, embedded ${emb.embedded}, failed ${emb.failed}`);
      }
    }
    if (!noRollup && !rollupStoodDown) {
      const roll = await runRollupPass({ limit: forceRollup ? 500 : 50, force: forceRollup });
      if (roll.owners > 0) {
        console.log(`  rollup: ${roll.owners} owner(s), ${roll.rows} dimension rows recomputed`);
      }
      if (roll.owners > 0 && roll.rows === 0) {
        rollupNoProgress += 1;
        if (rollupNoProgress >= ROLLUP_STALL_LIMIT) {
          rollupStoodDown = true;
          console.error(
            `  rollup: STOOD DOWN after ${ROLLUP_STALL_LIMIT} passes that found ` +
              `${roll.owners} stale owner(s) and recomputed 0 rows. That combination ` +
              `cannot make progress, so repeating it would spin forever. Those owners ` +
              `have facts newer than their scores that the refresh cannot act on -- ` +
              `check for observations with no contact_id, status='pending', or no ` +
              `unsuppressed observation_dimensions rows.`,
          );
        }
      } else if (roll.rows > 0) {
        rollupNoProgress = 0;
      }
    }
    if (!watch) break;
    if (stopping) break;

    if (r.claimed > 0) {
      // Work happened, so the next empty pass is news again.
      announcedIdle = false;
      idleTicks = 0;
    } else if (!announcedIdle) {
      announcedIdle = true;
      idleTicks = 0;
      if (totals.claimed > 0) {
        console.log(
          `\n  drained — claimed ${totals.claimed}, classified ${totals.classified}, ` +
            `retry-later ${totals.deferred}, gave-up ${totals.unclassified}`,
        );
      }
      console.log(
        "  idle: nothing left to classify. This is DONE, not stuck — press Ctrl-C.\n" +
          "        (--watch keeps waiting for new facts; omit it for a one-shot run.)",
      );
    } else {
      idleTicks += 1;
      if (idleTicks % HEARTBEAT_EVERY === 0) {
        console.log(`  idle: still watching, queue empty  (${new Date().toLocaleTimeString()})`);
      }
    }

    await new Promise((r2) => setTimeout(r2, r.claimed > 0 ? BUSY_MS : IDLE_MS));
  } while (!stopping);

  console.log(
    `\n  done — claimed ${totals.claimed}, classified ${totals.classified}, ` +
      `retry-later ${totals.deferred}, gave-up ${totals.unclassified}\n`,
  );
} catch (err) {
  console.error("\n  ✗ dimension worker failed:", err?.stack || err?.message || err, "\n");
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
