// @ts-nocheck
// people scoring: observation weights, the per-person score recompute, and
// the commands that run or tune it (score, dims, tune).

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, params, nowISO, daysBetween } = require("./db");
const { dimByCode } = require("./lookup");

// ---------------------------------------------------------------- scoring
//
// weight = source trust * modality * temporal shape * dimension decay
// dimension score = 1 - exp(-k * sum of weights)
//
// Saturation rather than an average, because the tenth piece of evidence that
// someone is struggling financially should move the number less than the first.

function temporalFactor(obs, P, asOf) {
  if (obs.temporal === "permanent") return 1;
  if (obs.temporal === "window") {
    const from = obs.valid_from ? new Date(obs.valid_from) : null;
    const until = obs.valid_until ? new Date(obs.valid_until) : null;
    const t = new Date(asOf);
    const afterStart = !from || t >= from;
    const beforeEnd = !until || t <= until;
    if (afterStart && beforeEnd) return 1;
    return P.window_residual;
  }
  return null; // decaying: caller applies the dimension half-life
}

function expiryFactor(obs, P, asOf) {
  if (!obs.valid_until) return 1;
  const overdue = daysBetween(obs.valid_until, asOf);
  if (overdue <= 0) return 1;
  return overdue > P.stale_long_gone_days ? P.stale_long_gone : P.stale_expired;
}

function observationWeight(obs, dim, P, asOf) {
  const src = P[`source_${obs.source}`] ?? 0.5;
  const mod = P[`modality_${obs.modality}`] ?? 0.5;
  let temporal = temporalFactor(obs, P, asOf);
  if (temporal === null) {
    const age = Math.max(0, daysBetween(obs.observed_at, asOf));
    temporal = Math.pow(2, -age / dim.half_life_days);
  }
  return src * mod * temporal * expiryFactor(obs, P, asOf);
}

function recomputeScores() {
  const d = db();
  const P = params();
  const asOf = nowISO();
  const dims = d.prepare("SELECT * FROM dimensions ORDER BY sort_order").all();
  const weights = Object.fromEntries(
    d.prepare("SELECT dimension_id, weight FROM dimension_weights").all().map((r) => [r.dimension_id, r.weight]),
  );
  const people = d.prepare("SELECT * FROM people WHERE deleted_at IS NULL").all();

  const obsFor = d.prepare(
    `SELECT o.*, od.dimension_id, od.weight AS dim_weight
       FROM observations o
       JOIN observation_dimensions od ON od.observation_id = o.id
      WHERE o.person_id = ? AND o.deleted_at IS NULL`,
  );
  const countFor = d.prepare(
    "SELECT count(*) AS n FROM observations WHERE person_id = ? AND deleted_at IS NULL",
  );
  // A BROADCAST IS NOT A CONVERSATION, and it reached the scorer through
  // interactions rather than messages. One day holds 758 interaction rows
  // across 750 people, and it became the last contact for 701 of them, so all
  // of them read as recently spoken to and fell out of the reconnect list on
  // the strength of a message sent to everybody and meant for nobody.
  //
  // A day where one person logs outbound contact with more than thirty others
  // is a blast. Inbound is untouched: if they replied, that is real.
  // A BLAST IS ONE-DIRECTIONAL. THAT IS WHAT MAKES IT A BLAST.
  //
  // The first version of this dropped every outbound message on any day he
  // messaged more than thirty people. Ninety-five days qualified, including
  // Christmas 2024, Thanksgiving 2024, and ordinary weeks this month, and 881
  // people lost their real contact date or had it pushed back a month. A busy
  // social day is not a broadcast, and the difference is not the count.
  //
  // The difference is whether anybody answered. A blast goes out and comes
  // back empty; a heavy day of real conversation has replies in it. So the day
  // is only discounted FOR A PERSON WHO DID NOT REPLY THAT DAY. One threshold
  // cannot tell Christmas from a mailing list, and this does not need to.
  d.exec(`CREATE TEMP TABLE IF NOT EXISTS broadcast_days AS
          SELECT date(sent_at) AS d FROM messages
           WHERE from_me = 1
           GROUP BY date(sent_at)
          HAVING count(DISTINCT person_id) > 30`);
  d.exec(`CREATE TEMP TABLE IF NOT EXISTS replied_on AS
          SELECT DISTINCT person_id, date(sent_at) AS d FROM messages
           WHERE from_me = 0 AND person_id IS NOT NULL`);
  // ONE DEFINITION OF LAST CONTACT, NOT TWO.
  //
  // This used to read `interactions` alone while the history path (`intFor`)
  // read interactions UNION messages, so the same person had two different
  // last-contact dates depending on which command you ran, and the one that
  // got written into person_scores was the wrong one.
  //
  // `interactions` is sparse: Cole Garner had 46 messages and 2 interaction
  // rows. His newer row fell on a 113-recipient broadcast day he did not
  // answer, so it was correctly discounted, and the fallback was the only
  // other row, four months stale. The entire two-way conversation in between,
  // where he replied six times, was in `messages` and invisible here.
  const lastInt = d.prepare(
    `SELECT max(t) AS t FROM (
       SELECT max(happened_at) AS t FROM interactions
        WHERE person_id = ?1
          AND (date(happened_at) NOT IN (SELECT d FROM broadcast_days)
               OR EXISTS (SELECT 1 FROM replied_on r
                           WHERE r.person_id = ?1 AND r.d = date(happened_at)))
       UNION ALL
       -- Inbound is never a broadcast, so only from_me = 1 is testable here.
       SELECT max(sent_at) AS t FROM messages
        WHERE person_id = ?1
          AND NOT (from_me = 1
                   AND date(sent_at) IN (SELECT d FROM broadcast_days)
                   AND NOT EXISTS (SELECT 1 FROM replied_on r
                                    WHERE r.person_id = ?1
                                      AND r.d = date(messages.sent_at)))
     )`,
  );

  const upDim = d.prepare(
    `INSERT INTO person_dimension_state (person_id, dimension_id, score, evidence, computed_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(person_id, dimension_id)
     DO UPDATE SET score = excluded.score, evidence = excluded.evidence, computed_at = excluded.computed_at`,
  );
  const upScore = d.prepare(
    `INSERT INTO person_scores (person_id, base_score, warmth, last_interaction_at, observation_count, completeness, computed_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(person_id)
     DO UPDATE SET base_score = excluded.base_score, warmth = excluded.warmth,
                   last_interaction_at = excluded.last_interaction_at,
                   observation_count = excluded.observation_count,
                   completeness = excluded.completeness, computed_at = excluded.computed_at`,
  );

  let n = 0;
  for (const p of people) {
    const rows = obsFor.all(p.id);
    const sums = {};
    const evid = {};
    for (const r of rows) {
      const dim = dims.find((x) => x.id === r.dimension_id);
      if (!dim) continue;
      const w = observationWeight(r, dim, P, asOf) * (r.dim_weight ?? 1);
      sums[dim.id] = (sums[dim.id] || 0) + w;
      evid[dim.id] = (evid[dim.id] || 0) + 1;
    }

    let weighted = 0;
    let wsum = 0;
    for (const dim of dims) {
      const s = sums[dim.id] || 0;
      const score = 1 - Math.exp(-P.saturation_k * s);
      upDim.run(p.id, dim.id, score, evid[dim.id] || 0, asOf);
      const w = dim.base_weight * (weights[dim.id] ?? 1);
      weighted += score * w;
      wsum += w;
    }
    const base = wsum ? weighted / wsum : 0;

    const last = lastInt.get(p.id).t;
    const warmth = last
      ? Math.pow(2, -Math.max(0, daysBetween(last, asOf)) / P.warmth_half_life_days)
      : 0;
    const count = countFor.get(p.id).n;
    const completeness = Math.min(1, count / P.completeness_target);

    upScore.run(p.id, base, warmth, last || null, count, completeness, asOf);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- knobs

function cmdDims(argv) {
  const { flags, rest } = parseArgs(argv);
  const d = db();
  if (rest[0] === "set") {
    const dim = dimByCode(rest[1]);
    if (flags["half-life"])
      d.prepare("UPDATE dimensions SET half_life_days=? WHERE id=?").run(
        Number(flags["half-life"]),
        dim.id,
      );
    if (flags.weight)
      d.prepare(
        "INSERT INTO dimension_weights (dimension_id, weight) VALUES (?,?) ON CONFLICT(dimension_id) DO UPDATE SET weight=excluded.weight",
      ).run(dim.id, Number(flags.weight));
    say(`${c.grn("updated")} ${dim.label}`);
    recomputeScores();
    return;
  }
  const rows = d
    .prepare(
      `SELECT dm.*, COALESCE(w.weight,1.0) AS uw,
              (SELECT count(*) FROM observation_dimensions od WHERE od.dimension_id = dm.id) AS n
         FROM dimensions dm LEFT JOIN dimension_weights w ON w.dimension_id = dm.id
        ORDER BY dm.sort_order`,
    )
    .all();
  say("");
  for (const r of rows)
    say(
      `  ${r.label.padEnd(14)} ${c.dim("half-life")} ${String(r.half_life_days + "d").padEnd(6)} ${c.dim("weight")} ${r.uw.toFixed(2)}  ${c.dim(r.n + " observations")}`,
    );
  say(c.dim("\n  people dims set financial --half-life 90 --weight 1.5"));
  say("");
}

function cmdTune(argv) {
  const { rest } = parseArgs(argv);
  const d = db();
  if (!rest.length) {
    const rows = d.prepare("SELECT * FROM scoring_params ORDER BY key").all();
    say("");
    for (const r of rows) say(`  ${r.key.padEnd(24)} ${String(r.value).padEnd(8)} ${c.dim(r.note || "")}`);
    say(c.dim("\n  people tune saturation_k 0.5"));
    say("");
    return;
  }
  const [key, value] = rest;
  if (value === undefined) die(`people tune ${key} <value>`);
  const exists = d.prepare("SELECT 1 FROM scoring_params WHERE key=?").get(key);
  if (!exists) die(`No such knob: ${key}. Run "people tune" to list them.`);
  d.prepare("UPDATE scoring_params SET value=?, updated_at=? WHERE key=?").run(
    Number(value),
    nowISO(),
    key,
  );
  say(`${c.grn("set")} ${key} = ${value}`);
  recomputeScores();
}

function cmdScore() {
  const n = recomputeScores();
  say(`${c.grn("scored")} ${n} people`);
}

module.exports = {
  observationWeight, recomputeScores, cmdDims, cmdTune, cmdScore,
};
