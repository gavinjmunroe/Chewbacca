/**
 * SMOKE TEST — what decays, what does not, and how fast.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/temporal-smoke.mjs
 *
 *     node scripts/temporal-smoke.mjs --table    just print the curves
 *
 * amber_temporal_multiplier decides how much every fact in the system is worth
 * at a given moment, and until this file it had no direct test at all. It also
 * had a real bug: 'decay' -- the shape used for divorces, redundancies and deaths
 * -- floored at ZERO, while 'window_then_decay' floored at a residual. So the
 * shape carrying the heaviest facts was the one that decayed to nothing.
 *
 * THE CLAIM THIS FILE EXISTS TO MAKE READABLE: nothing decays because of what
 * kind of fact it is. 'permanent' is the default and returns 1.0 forever. A fact
 * fades only when whoever recorded it said it fades, and even then it fades
 * toward a residual rather than out of existence, because a thing that happened
 * never stops having happened.
 *
 * The function takes `at` as an argument instead of calling now(), which is what
 * makes "what is this worth in ten years" a query rather than a wait.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import { deriveTemporal, DEFAULT_DECAY_HALF_LIFE_DAYS } from "../src/db/observations-store.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const RESIDUAL = 0.15;
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

/** The multiplier for one fact, evaluated `days` from now. */
async function mult(shape, { observed = 0, from = null, until = null, hl = null }, atDays = 0) {
  const { rows } = await query(
    `SELECT amber_temporal_multiplier($1,$2,$3,$4,$5,$6,$7)::float8 AS m`,
    [shape, ago(observed), from === null ? null : ago(from),
     until === null ? null : ago(until), hl, ahead(atDays), RESIDUAL]);
  return rows[0].m;
}

// ── the default: nothing fades ────────────────────────────────────────────────
console.log("\n── 'permanent' is the default, and it never fades ──");
ok(await mult("permanent", { observed: 0 }) === 1,
   "a fact recorded today is worth 1.0");
ok(await mult("permanent", { observed: 3650 }) === 1,
   "and so is the same fact ten years later — 'has two kids' does not expire");
ok(await mult("permanent", { observed: 3650 }, 7300) === 1,
   "nor thirty years out");
const derived = deriveTemporal({});
ok(derived.shape === "permanent" && derived.hl === null,
   "a caller who says nothing about time gets 'permanent', not a decay",
   JSON.stringify(derived));

// ── the bug this file was written for ─────────────────────────────────────────
console.log("\n── 'decay' fades toward a residual, not toward nothing ──");
const hl = DEFAULT_DECAY_HALF_LIFE_DAYS;
ok(Math.abs(await mult("decay", { observed: 0, hl }) - 1) < 0.001,
   "the day it happens it is worth full weight");
ok(Math.abs(await mult("decay", { observed: hl, hl }) - 0.5) < 0.01,
   `and half that after the half-life (${hl} days)`);
const tenYears = await mult("decay", { observed: 3650, hl });
ok(tenYears >= RESIDUAL - 0.001,
   "a divorce ten years on is worth at least the residual, not zero",
   String(tenYears));
const fiftyYears = await mult("decay", { observed: 18250, hl });
ok(Math.abs(fiftyYears - RESIDUAL) < 0.001,
   "and fifty years on it is still exactly the residual — it still happened",
   String(fiftyYears));
ok(tenYears > await mult("decay", { observed: 36500, hl }) - 0.001,
   "it is monotonic: later is never worth more than earlier");

// THE OLD BEHAVIOR, spelled out so a regression is obvious. With the 120-day
// half-life this used to carry, a divorce was worth 1.6% after two years.
const oldWay = await mult("decay", { observed: 730, hl: 120 });
const newWay = await mult("decay", { observed: 730, hl });
ok(oldWay <= RESIDUAL + 0.001,
   "a 120-day half-life put a two-year-old life event at the floor",
   String(oldWay));
ok(newWay > 0.6,
   "five years puts it above 0.6, which is where a life event belongs",
   String(newWay));

// ── windows: for facts that genuinely stop ────────────────────────────────────
console.log("\n── 'window' is for the facts that really do stop ──");
ok(await mult("window", { from: -30, until: -60 }) === 0,
   "before it starts it is worth nothing — she is not in SF yet");
ok(await mult("window", { from: 10, until: -20 }) === 1,
   "inside the window, full weight — she is in SF now");
ok(Math.abs(await mult("window", { from: 60, until: 30 }) - RESIDUAL) < 0.001,
   "after it closes, the residual — 'she was in SF last spring' is real knowledge");

console.log("\n── 'window_then_decay': full pressure, then it fades ──");
ok(await mult("window_then_decay", { from: 30, until: -30, hl: 730 }) === 1,
   "during the term, full weight — the loan is outstanding");
const afterTerm = await mult("window_then_decay", { from: 400, until: 300, hl: 730 });
ok(afterTerm > RESIDUAL && afterTerm < 1,
   "after the term it is fading, not gone", String(afterTerm));
ok(Math.abs(await mult("window_then_decay", { from: 20000, until: 19000, hl: 730 }) - RESIDUAL) < 0.001,
   "and it bottoms out at the same residual as everything else");

// ── the two floors are the same number ────────────────────────────────────────
console.log("\n── one residual, not two ──");
const dFloor = await mult("decay", { observed: 40000, hl });
const wFloor = await mult("window", { from: 40000, until: 39000 });
const wdFloor = await mult("window_then_decay", { from: 40000, until: 39000, hl: 730 });
ok(Math.abs(dFloor - wFloor) < 0.001 && Math.abs(wFloor - wdFloor) < 0.001,
   "'decay', 'window' and 'window_then_decay' all fade to the same floor",
   JSON.stringify([dFloor, wFloor, wdFloor]));

// ── the guards ───────────────────────────────────────────────────────────────
console.log("\n── a bad half-life must not poison the score ──");
ok((await mult("decay", { observed: 100, hl: 0 })) === null ||
   Number.isFinite(await mult("decay", { observed: 100, hl: 0 })),
   "a half-life of 0 divides by NULL rather than raising",
   String(await mult("decay", { observed: 100, hl: 0 })));
ok(await mult("nonsense_shape", { observed: 100 }) === 1,
   "an unknown shape falls back to 1.0 — a fact is never silently erased");

const d1 = deriveTemporal({ temporalShape: "decay" });
ok(d1.hl === DEFAULT_DECAY_HALF_LIFE_DAYS,
   "'decay' with no half-life gets the five-year default, not four months",
   String(d1.hl));
const d2 = deriveTemporal({ temporalShape: "decay", decayHalfLifeDays: 30 });
ok(d2.hl === 30, "and a caller who knows better overrides it");
const d3 = deriveTemporal({ temporalShape: "window" });
ok(d3.shape === "permanent",
   "a window with no end date becomes permanent rather than failing the CHECK");

// ── THE DEFAULT PATH, WHICH THIS SUITE NEVER TESTED ──────────────────────────
//
// 23 assertions passed here while every observation in the system was decaying by
// half every day. The suite only ever called deriveTemporal with a shape or a
// real half-life -- never the way insertObservation actually calls it, which is
// with explicit nulls from its own parameter defaults. Number(null) is 0, 0 is
// finite, so the half-life became Math.max(1, 0) and "a half-life implies decay"
// did the rest.
console.log("\n── absent means absent: the call insertObservation actually makes ──");
const dNull = deriveTemporal({
  temporalShape: null, validFrom: null, validUntil: null, decayHalfLifeDays: null,
});
ok(dNull.shape === "permanent",
   "EXPLICIT NULLS GIVE 'permanent'. This returned 'decay' with a ONE DAY "
   + "half-life, for every observation the app has ever written",
   JSON.stringify(dNull));
ok(dNull.hl === null, "and no half-life at all", String(dNull.hl));
ok(deriveTemporal({}).shape === "permanent", "so does passing nothing");
ok(deriveTemporal({ decayHalfLifeDays: undefined }).shape === "permanent",
   "and so does an undefined half-life");
ok(deriveTemporal({ decayHalfLifeDays: "" }).shape === "permanent",
   "an empty string is not a half-life either");
ok(deriveTemporal({ decayHalfLifeDays: 0 }).shape === "decay"
   && deriveTemporal({ decayHalfLifeDays: 0 }).hl === 1,
   "but a deliberate 0 still clamps to 1 day — a caller who passes a number "
   + "means a number", JSON.stringify(deriveTemporal({ decayHalfLifeDays: 0 })));
ok(deriveTemporal({ decayHalfLifeDays: 90 }).hl === 90, "and a real one is kept");

// ── AND THE UNDERFLOW THAT KILLED A WHOLE OWNER'S ROLLUP ─────────────────────
//
// GREATEST(real, numeric) resolves to REAL, so the numeric POWER() result was
// coerced to float4 BEFORE the floor could apply -- and numeric -> real raises
// 22003 rather than flushing to zero. One observation ~250 half-lives old meant
// refreshContactDimensionState threw for that user and they got no dimension
// state at all. Migration 026 keeps the whole expression in float8.
console.log("\n── an old observation must floor, not raise 22003 ──");
for (const [days, halfLife, label] of [
  [500, 2, "500 days at a 2-day half-life"],
  [18250, 1, "fifty years at a 1-day half-life"],
  [3650, 5, "ten years at a 5-day half-life"],
]) {
  let v = null, threw = null;
  try { v = await mult("decay", { observed: days, hl: halfLife }); }
  catch (e) { threw = e; }
  ok(threw === null && Math.abs(v - RESIDUAL) < 0.0001,
     `${label} returns the floor`,
     threw ? `${threw.code} ${threw.message}`.slice(0, 90) : String(v));
}
let wtdThrew = null;
try {
  await mult("window_then_decay",
             { observed: 600, until: 500, hl: 2 });
} catch (e) { wtdThrew = e; }
ok(wtdThrew === null, "and so does a long-closed window_then_decay",
   wtdThrew ? `${wtdThrew.code} ${wtdThrew.message}`.slice(0, 90) : "");

// ── the curve, printed ───────────────────────────────────────────────────────
if (process.argv.includes("--table") || !process.env.CI) {
  console.log("\n  'decay' at the five-year default, so the shape is readable:\n");
  console.log(`  ${"since".padStart(10)}${"weight".padStart(10)}`);
  for (const days of [0, 30, 90, 365, 730, 1825, 3650, 7300, 18250]) {
    const m = await mult("decay", { observed: days, hl });
    const label = days === 0 ? "today" : days < 365 ? `${days}d` : `${(days / 365).toFixed(0)}y`;
    console.log(`  ${label.padStart(10)}${m.toFixed(3).padStart(10)}` +
                (m <= RESIDUAL + 0.0001 ? "   floor" : ""));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
