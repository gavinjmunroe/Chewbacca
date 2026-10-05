// @ts-nocheck
// people health: check, stats, and the single next step an empty or
// half-filled store should suggest.

"use strict";

const fs = require("node:fs");
const { c, say, parseArgs } = require("./output");
const { DB_PATH, db } = require("./db");
const { dimByCode } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { inferDimensions } = require("./observations");

function cmdCheck(argv = []) {
  const { flags } = parseArgs(argv);
  const d = db();
  let bad = 0;
  const orphanDims = d
    .prepare(
      `SELECT count(*) AS n FROM observations o
        WHERE o.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM observation_dimensions od WHERE od.observation_id = o.id)`,
    )
    .get().n;
  // A LinkedIn connection record is provenance, not an observation of any
  // dimension of someone's life. Counting 2,124 of them as a defect buried the
  // 200 real observations that genuinely were unscored.
  const undimmed = d
    .prepare(
      `SELECT id, body FROM observations o
        WHERE o.deleted_at IS NULL AND o.body NOT LIKE 'connected on LinkedIn%'
          AND NOT EXISTS (SELECT 1 FROM observation_dimensions od WHERE od.observation_id = o.id)`,
    )
    .all();
  if (undimmed.length) {
    if (flags.fix) {
      const link = d.prepare(
        "INSERT INTO observation_dimensions (observation_id, dimension_id, weight) VALUES (?,?,?) ON CONFLICT DO NOTHING",
      );
      let tagged = 0;
      for (const o of undimmed) {
        const codes = inferDimensions(o.body);
        if (!codes.length) continue;
        for (const code of codes) link.run(o.id, dimByCode(code).id, 1.0);
        tagged++;
      }
      say(c.grn(`  dimensioned ${tagged} observations`) + c.dim(`  (${undimmed.length - tagged} had no signal to go on)`));
      if (tagged) recomputeScores();
    } else {
      say(c.yel(`  ${undimmed.length} observations have no dimension`) + c.dim("  they score nothing  people check --fix"));
      bad++;
    }
  }
  const provenance = orphanDims - undimmed.length;
  if (provenance > 0) say(c.dim(`  ${provenance} import records carry no dimension, which is correct`));
  const noCircleFact = d
    .prepare(
      "SELECT count(*) AS n FROM circles WHERE deleted_at IS NULL AND classified_fact IS NULL",
    )
    .get().n;
  if (noCircleFact) {
    say(c.dim(`  ${noCircleFact} circles are unclassified (no member facts written)`));
  }
  const stale = d
    .prepare(
      "SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL AND valid_until IS NOT NULL AND valid_until < datetime('now')",
    )
    .get().n;
  if (stale) say(c.dim(`  ${stale} observations are past their valid_until (down-weighted, not deleted)`));
  // Orphaned dimension links survive a merge, because deleting the losing
  // person's observations does not always run the cascade. They are pure
  // garbage, so `check --fix` clears them rather than only counting them.
  const orphans = d
    .prepare(
      "SELECT count(*) AS n FROM observation_dimensions od" +
        " WHERE NOT EXISTS (SELECT 1 FROM observations o WHERE o.id = od.observation_id)",
    )
    .get().n;
  if (orphans) {
    if (flags.fix) {
      d.prepare(
        "DELETE FROM observation_dimensions WHERE observation_id NOT IN (SELECT id FROM observations)",
      ).run();
      say(c.grn(`  cleared ${orphans} orphaned dimension links`));
    } else {
      say(c.yel(`  ${orphans} orphaned dimension links  people check --fix`));
      bad++;
    }
  }

  const fk = d.prepare("PRAGMA foreign_key_check").all();
  if (fk.length) {
    say(c.red(`  ${fk.length} foreign key violations`));
    bad++;
  }
  say(bad ? c.yel("\n  check finished with warnings") : c.grn("  everything checks out"));
}

// WHAT TO DO NEXT, said out loud, because an empty store looks like a working one.
//
// A new install answers "who do I know in SF" with "0 found" and "what needs me
// today" with "nothing needs you today". Both are true and both are useless:
// they read as an answer about the user's life rather than as a tool that has
// never been given anything. Somebody who installs this and sees that concludes
// it is broken, or worse, that it works and they have no friends.
//
// So the store reports its own emptiness, and names the single next step rather
// than a setup document. One step at a time, in the order that makes the next
// one worth doing: people first, then what they said, then who they are
// professionally, then where they are, then what it all means.
function nextStep(d) {
  const n = (q) => {
    try {
      return d.prepare(q).get().n;
    } catch {
      return 0;
    }
  };
  const people = n(`SELECT count(*) n FROM people WHERE deleted_at IS NULL`);
  const msgs = n(`SELECT count(*) n FROM messages`);
  const linked = n(`SELECT count(*) n FROM people WHERE linkedin IS NOT NULL AND linkedin<>''`);
  const located = n(`SELECT count(*) n FROM people WHERE location IS NOT NULL AND location<>''`);
  const facts = n(`SELECT count(*) n FROM quick_facts`);

  if (!people && !msgs)
    return {
      why: "This store is empty. Nothing has been imported yet.",
      run: "people texts sync",
      then: "reads your Messages history, which stays on this machine.",
    };
  if (!msgs)
    return {
      why: `${people} people, but no message history.`,
      run: "people texts sync",
      then: "is what makes every other question answerable.",
    };
  if (!linked)
    return {
      why: `${msgs.toLocaleString()} messages, but nothing professional about anyone.`,
      run: "people linkedin sync",
      then: "reads a LinkedIn export from ~/Downloads. Ask LinkedIn for one under Settings, Data Privacy.",
    };
  if (linked && located < linked * 0.25)
    return {
      why: `${linked} people from LinkedIn, ${located} with a location.`,
      run: "people linkedin locate",
      then:
        "fills in where they live and what they have done. Needs a Clay API key at " +
        "~/.chewbacca/clay-key, and costs no credits: it searches, it does not enrich.",
    };
  if (facts < people * 0.1)
    return {
      why: `${msgs.toLocaleString()} messages read, ${facts} facts kept from them.`,
      run: "people distill",
      then: "turns conversations into what you actually know about people.",
    };
  return null;
}

// Printed under a thin or empty answer, never over a good one.
function sayNextStep(d, { force = false } = {}) {
  const step = nextStep(d);
  if (!step) return false;
  say();
  say(`  ${c.yel(step.why)}`);
  say(`  ${c.b(step.run)}  ${c.dim(step.then)}`);
  say();
  void force;
  return true;
}

function cmdStats() {
  const d = db();
  const q = (s) => d.prepare(s).get().n;
  say("");
  say(`  people        ${q("SELECT count(*) AS n FROM people WHERE deleted_at IS NULL")}`);
  say(`  circles       ${q("SELECT count(*) AS n FROM circles WHERE deleted_at IS NULL")}`);
  say(`  observations  ${q("SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL")}`);
  say(`  interactions  ${q("SELECT count(*) AS n FROM interactions")}`);
  say(c.dim(`\n  ${DB_PATH}`));
  try {
    say(c.dim(`  ${(fs.statSync(DB_PATH).size / 1024).toFixed(0)} KB`));
  } catch {}
  say("");
}

module.exports = {
  cmdCheck, sayNextStep, cmdStats,
};
