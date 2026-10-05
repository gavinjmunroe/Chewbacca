// @ts-nocheck
// people history: scores recomputed as of a past date, and the commands
// that chart them (history, trend, snapshot).

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, params, nowISO, daysBetween } = require("./db");
const { findPerson } = require("./lookup");
const { observationWeight } = require("./scoring");

// ------------------------------------------------- relationship over time
//
// The one rule that makes a retroactive score honest: at a past date you may
// only see what had been observed by that date. Without the two filters below
// an observation from last week leaks into last year's number, and worse, its
// age goes negative and 2^(-age/halflife) AMPLIFIES it. The curve would then
// show every relationship improving, always, which is a lie people like.

function scoreAsOf(ctx, personId, asOf) {
  const { P, dims, weights, obsFor, intFor, cntFor } = ctx;
  const rows = obsFor.all(personId, asOf);
  const sums = {};
  for (const r of rows) {
    const dim = dims.find((x) => x.id === r.dimension_id);
    if (!dim) continue;
    sums[dim.id] = (sums[dim.id] || 0) + observationWeight(r, dim, P, asOf) * (r.dim_weight ?? 1);
  }
  let weighted = 0, wsum = 0;
  const out = {};
  for (const dim of dims) {
    const score = 1 - Math.exp(-P.saturation_k * (sums[dim.id] || 0));
    out[dim.code] = score;
    const w = dim.base_weight * (weights[dim.id] ?? 1);
    weighted += score * w;
    wsum += w;
  }
  const last = intFor.get(personId, asOf).t;
  const warmth = last
    ? Math.pow(2, -Math.max(0, daysBetween(last, asOf)) / P.warmth_half_life_days)
    : 0;
  return {
    as_of: asOf,
    base: wsum ? weighted / wsum : 0,
    warmth,
    dims: out,
    observations: cntFor.get(personId, asOf).n,
    last_interaction_at: last || null,
  };
}

function historyCtx() {
  const d = db();
  return {
    d,
    P: params(),
    dims: d.prepare("SELECT * FROM dimensions ORDER BY sort_order").all(),
    weights: Object.fromEntries(
      d.prepare("SELECT dimension_id, weight FROM dimension_weights").all().map((r) => [r.dimension_id, r.weight]),
    ),
    obsFor: d.prepare(
      `SELECT o.*, od.dimension_id, od.weight AS dim_weight
         FROM observations o
         JOIN observation_dimensions od ON od.observation_id = o.id
        WHERE o.person_id = ? AND o.deleted_at IS NULL AND o.observed_at <= ?`,
    ),
    // Last contact as of a date. The interactions table only ever holds ONE row
    // per person (their most recent), so on its own it cannot answer "were you
    // in touch in 2023" and every warmth curve would read as a single step from
    // 0 to 1. The messages table has every timestamp, so ask both and take the
    // later. Falls back cleanly for anyone who has only hand-logged contact.
    // Materialised once per process. A day where one person messages more
    // than thirty others is a blast, not thirty conversations.
    broadcastDays: (() => {
      d.exec(`CREATE TEMP TABLE IF NOT EXISTS replied_on AS
              SELECT DISTINCT person_id, date(sent_at) AS d FROM messages
               WHERE from_me = 0 AND person_id IS NOT NULL`);
      d.exec(`CREATE TEMP TABLE IF NOT EXISTS broadcast_days AS
              SELECT date(sent_at) AS d FROM messages
               WHERE from_me = 1
               GROUP BY date(sent_at)
              HAVING count(DISTINCT person_id) > 30`);
      return true;
    })(),
    intFor: d.prepare(
      `SELECT max(t) AS t FROM (
         SELECT max(happened_at) AS t FROM interactions
          WHERE person_id = ?1 AND happened_at <= ?2
         UNION ALL
         -- A BROADCAST IS NOT A CONVERSATION.
         --
         -- One day in this archive holds 1,226 outbound messages to 965
         -- different people and became the "last contact" for 701 of them.
         -- Each of those reads as recently spoken to and drops out of the
         -- reconnect list for months, on the strength of a message sent to
         -- everybody and meant for nobody.
         --
         -- The broadcast days are computed once into broadcast_days rather
         -- than re-derived per person: as a correlated subquery this rescan
         -- took longer than ten minutes for three thousand people.
         SELECT max(sent_at) AS t FROM messages
          WHERE person_id = ?1 AND sent_at <= ?2
            AND NOT (from_me = 1
                     AND date(sent_at) IN (SELECT d FROM broadcast_days)
                     AND NOT EXISTS (SELECT 1 FROM replied_on r
                                      WHERE r.person_id = ?1
                                        AND r.d = date(messages.sent_at)))
       )`,
    ),
    cntFor: d.prepare(
      "SELECT count(*) AS n FROM observations WHERE person_id = ? AND deleted_at IS NULL AND observed_at <= ?",
    ),
  };
}

// Sample points, oldest first. Anchored to today so the last point is always
// "now" rather than a bucket boundary that happens to be four days stale.
function samplePoints(days, steps) {
  const now = Date.now();
  const span = days * 86400000;
  const out = [];
  for (let i = steps - 1; i >= 0; i--) {
    out.push(new Date(now - (span * i) / (steps - 1)).toISOString().slice(0, 19).replace("T", " "));
  }
  return out;
}

const SPARK = "▁▂▃▄▅▆▇█";
function sparkline(vals) {
  if (!vals.length) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo;
  // A flat series is either flat-at-something or flat-at-nothing, and drawing
  // both at mid-height makes "no evidence" look like "steady".
  if (span < 1e-9) return SPARK[hi < 1e-9 ? 0 : 3].repeat(vals.length);
  return vals.map((v) => SPARK[Math.min(7, Math.floor(((v - lo) / span) * 7.999))]).join("");
}

function arrow(delta) {
  if (delta > 0.02) return c.grn("↑");
  if (delta < -0.02) return c.red("↓");
  return c.dim("→");
}

function cmdHistory(argv) {
  const { flags, rest } = parseArgs(argv);
  if (!rest.length) die("usage: people history <person> [--days 365] [--steps 12] [--json]");
  const person = findPerson(rest.join(" "));
  const days = Number(flags.days || 365);
  const steps = Math.max(2, Math.min(60, Number(flags.steps || 12)));
  const ctx = historyCtx();

  const stored = ctx.d
    .prepare("SELECT * FROM score_history WHERE person_id=? AND kind='snapshot' ORDER BY as_of")
    .all(person.id);
  const series = samplePoints(days, steps).map((t) => {
    const snap = stored.find((r) => r.as_of.slice(0, 10) === t.slice(0, 10));
    if (snap) return { as_of: t, base: snap.base_score, warmth: snap.warmth, dims: JSON.parse(snap.dims), observations: snap.observation_count, frozen: true };
    return scoreAsOf(ctx, person.id, t);
  });

  if (flags.json) return say(JSON.stringify({ person: person.name, series }, null, 2));

  const first = series[0], last = series[series.length - 1];
  say("\n" + c.b(person.name) + c.dim(`   last ${days}d, ${steps} points`));
  if (stored.length) say(c.dim(`  ${stored.length} frozen snapshot(s) in range are used as-is`));

  say("\n  " + c.dim("standing") + "  " + sparkline(series.map((p) => p.base)) +
      `  ${first.base.toFixed(2)} → ${last.base.toFixed(2)} ${arrow(last.base - first.base)}`);
  say("  " + c.dim("warmth  ") + "  " + sparkline(series.map((p) => p.warmth)) +
      `  ${first.warmth.toFixed(2)} → ${last.warmth.toFixed(2)} ${arrow(last.warmth - first.warmth)}`);

  say("");
  for (const dim of ctx.dims) {
    const vals = series.map((p) => p.dims[dim.code] ?? 0);
    const d0 = vals[0], d1 = vals[vals.length - 1];
    if (d0 < 0.005 && d1 < 0.005) continue;
    say(`  ${dim.label.padEnd(12)} ${sparkline(vals)}  ${d0.toFixed(2)} → ${d1.toFixed(2)} ${arrow(d1 - d0)}`);
  }

  const grew = last.observations - first.observations;
  say("\n" + c.dim(`  ${last.observations} observations, ${grew >= 0 ? "+" : ""}${grew} over the window`));
  if (last.last_interaction_at) {
    say(c.dim(`  last interaction ${last.last_interaction_at.slice(0, 10)}`));
  }
  say("");
}

const P_TREND_WARMTH = 1;

function cmdTrend(argv) {
  const { flags } = parseArgs(argv);
  const days = Number(flags.days || 90);
  const limit = Number(flags.limit || 15);
  const ctx = historyCtx();
  const then = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const now = nowISO();
  const people = ctx.d.prepare("SELECT * FROM people WHERE deleted_at IS NULL").all();

  const rows = people
    .map((p) => {
      const a = scoreAsOf(ctx, p.id, then);
      const b = scoreAsOf(ctx, p.id, now);
      return { name: p.name, from: a.base, to: b.base, d: b.base - a.base, w: b.warmth - a.warmth };
    })
    .filter((r) => Math.abs(r.d) > 0.005 || Math.abs(r.w) > 0.005);

  if (!rows.length) {
    return say(c.dim(`\n  nothing has moved measurably in ${days} days.\n`));
  }
  // Split on standing AND warmth together. Standing moves only when something
  // gets written down, warmth moves every time you talk, so ranking on standing
  // alone hides everyone you have simply stopped talking to, which is the whole
  // question this command exists to answer.
  const move = (r) => r.d + r.w * (P_TREND_WARMTH ?? 1);
  const up = rows.filter((r) => move(r) > 0).sort((a, b) => move(b) - move(a)).slice(0, limit);
  const down = rows.filter((r) => move(r) < 0).sort((a, b) => move(a) - move(b)).slice(0, limit);

  if (flags.json) return say(JSON.stringify({ days, warming: up, cooling: down }, null, 2));

  const block = (title, list) => {
    if (!list.length) return;
    say("\n" + c.b(title));
    for (const r of list) {
      const w = (r.w >= 0 ? "+" : "") + r.w.toFixed(2);
      say(
        `  ${r.name.slice(0, 24).padEnd(25)} ${c.dim("standing")} ${r.from.toFixed(2)} → ${r.to.toFixed(2)} ${arrow(r.d)}   ${c.dim("warmth")} ${w} ${arrow(r.w)}`,
      );
    }
  };
  say(c.dim(`\n  movement over the last ${days} days`));
  block("warming", up);
  block("cooling", down);
  say("");
}

function cmdSnapshot(argv) {
  const { flags } = parseArgs(argv);
  const ctx = historyCtx();
  const asOf = nowISO();
  const people = ctx.d.prepare("SELECT * FROM people WHERE deleted_at IS NULL").all();
  const ins = ctx.d.prepare(
    `INSERT INTO score_history (person_id, as_of, base_score, warmth, dims, observation_count, kind)
     VALUES (?,?,?,?,?,?,'snapshot')
     ON CONFLICT(person_id, as_of, kind) DO UPDATE SET
       base_score=excluded.base_score, warmth=excluded.warmth,
       dims=excluded.dims, observation_count=excluded.observation_count`,
  );
  let n = 0;
  for (const p of people) {
    const s = scoreAsOf(ctx, p.id, asOf);
    ins.run(p.id, asOf, s.base, s.warmth, JSON.stringify(s.dims), s.observations);
    n++;
  }
  if (flags.json) return say(JSON.stringify({ frozen: n, as_of: asOf }));
  say(c.dim(`\n  froze ${n} people at ${asOf.slice(0, 16)}.`));
  say(c.dim("  these points stay put even if you edit the observations behind them.\n"));
}

module.exports = {
  cmdHistory, cmdTrend, cmdSnapshot,
};
