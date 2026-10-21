/**
 * A COLUMN THE MIGRATION HAS NOT REACHED YET MUST NOT TAKE DOWN A PAGE.
 *
 * This exists because of a real outage, and the shape of it is worth writing
 * down because it will happen again otherwise.
 *
 * A feature added `circles.kind_tag` in a migration and, in the same commit,
 * started SELECTing it. The code deployed before the migration ran -- which is
 * the normal order of events, since one is a push and the other is a command
 * somebody has to type -- and every circles read then failed with
 *
 *   LIST_CIRCLES_ERR error: column ci.kind_tag does not exist
 *
 * The catch around it returned [], so the app did not error: it showed "0
 * circles" and an empty list. The user's circles had not gone anywhere, and
 * there was no way to tell that from the screen. Creating one failed too,
 * because the INSERT named the same column. An optional, nullable, additive
 * column took out the whole feature.
 *
 * WHAT THIS DOES. Run the query as written; if Postgres answers 42703
 * (undefined_column), run it again with the column left out, remember that for
 * the life of the process, and log once, loudly, that a migration is pending.
 * The feature then works exactly as it did before the column existed -- which
 * for an ADDITIVE column is by definition a coherent state -- and starts
 * carrying the new field the moment the migration lands.
 *
 * ONE SQL STRING, NOT TWO. The builder takes a boolean and returns the query,
 * so the two variants cannot drift apart: there is one text with a hole in it,
 * not a copy to keep in step.
 *
 * WHAT THIS IS NOT. It is not a license to skip migrations, and it deliberately
 * does not paper over anything else: only 42703, only once per key, and the log
 * line names the column so the pending migration is obvious in the deploy logs
 * rather than being silently tolerated forever.
 */

import { query } from "./sql.js";

const UNDEFINED_COLUMN = "42703";

/**
 * THE VARIANT WITHOUT THE COLUMN USUALLY NEEDS ONE FEWER PARAMETER, AND
 * FORGETTING THAT BREAKS THE WRITE COMPLETELY.
 *
 * This cost a feature for a day. createCircle's fallback correctly dropped
 * `kind_tag` from the INSERT -- and was still handed five parameters for a
 * statement that now used four. Postgres rejects the bind outright ("bind
 * message supplies 5 parameters, but prepared statement requires 4"), the
 * store's catch returned null, the route answered 500, and creating a circle
 * simply did not work. The degradation layer written to keep a pending
 * migration from breaking a feature had broken one itself.
 *
 * So the helper checks the arithmetic instead of trusting whoever wrote the
 * pair. If the variant it is about to run references a contiguous PREFIX of the
 * parameters ($1..$k) and k is less than what was supplied, the extras are
 * trailing and dropping them is exactly right -- the omitted column's value is
 * the last one by construction, because it is the field being left out.
 *
 * A variant that skips an index in the middle ($1, $3) is a different animal:
 * the positions no longer line up with anything and no slice can fix it. That
 * is an authoring mistake and it throws, loudly, naming the key -- silently
 * running the wrong statement would write a value into the wrong column.
 */
function paramIndexesIn(sql) {
  const found = new Set();
  const re = /\$(\d+)/g;
  let m;
  while ((m = re.exec(sql)) !== null) found.add(Number(m[1]));
  return found;
}

/** The parameters this SQL actually needs, or a thrown error if they are not a prefix. */
export function fitParams(key, sql, params) {
  const list = Array.isArray(params) ? params : [];
  const used = paramIndexesIn(sql);
  const max = used.size === 0 ? 0 : Math.max(...used);
  if (max >= list.length) return list;
  for (let i = 1; i <= max; i += 1) {
    if (!used.has(i)) {
      throw new Error(
        `optional-column ${key}: the variant references $${max} but not $${i}, so its ` +
          `parameters are not a prefix and cannot be trimmed safely. Renumber the ` +
          `placeholders so the omitted value is last.`,
      );
    }
  }
  return list.slice(0, max);
}

/**
 * key -> the ms timestamp at which this process proved the column absent.
 *
 * A TIMESTAMP RATHER THAN A BOOLEAN, AND THAT DISTINCTION COST ME AN HOUR OF
 * SOMEBODY ELSE'S TIME.
 *
 * It was `true`, remembered for the life of the process. So when the migration
 * actually ran, every server already running kept serving without the column
 * until it happened to restart -- and the logs kept saying MIGRATION_PENDING
 * from a process that had started before the migration, which is exactly what I
 * then read as "the migrations have not run". They had. He said so, and he was
 * right.
 *
 * Two bugs in one: an app that needs a redeploy to notice a migration it was
 * written to survive, and a log line that outlives the condition it describes.
 * A timestamp fixes both -- after RECHECK_MS the real query is tried again, so
 * the column comes back into use on its own, and the warning is repeated only
 * if it is still true.
 */
const _missing = new Map();

/**
 * How long to serve without the column before probing for it again.
 *
 * A minute: long enough that a pending migration costs one extra failed query
 * per minute per process rather than one per request, and short enough that
 * running the migration takes effect while somebody is still looking at the app.
 */
const RECHECK_MS = 60_000;

const isMissingNow = (key, now = Date.now()) => {
  const at = _missing.get(key);
  if (at === undefined) return false;
  if (now - at < RECHECK_MS) return true;
  // The cooldown is up: forget it and let the next call try the real query. If
  // the column is still absent that call re-marks it, which costs one error.
  _missing.delete(key);
  return false;
};
// So the warning is one line per key per process, not one per request.
const _warned = new Set();

/** Is this process currently serving without the column? */
export function columnIsMissing(key) {
  return isMissingNow(key);
}

/**
 * Mark a column absent and say so once, without running a fallback query.
 *
 * For a query whose whole POINT is the optional column -- writing a pin,
 * listing the pins -- there is no variant to fall back to: the honest answer is
 * "no pins" / "could not pin". The caller already returns that; what it lacks
 * is a log line that names the pending migration instead of a bare SQL error
 * that reads like a bug in the feature.
 */
export function noteMissingColumn(key) {
  // A TIMESTAMP, like every other entry in this map -- see the note on _missing.
  // A `true` here would make this one key permanently missing for the process,
  // which is the exact bug the timestamps removed.
  _missing.set(key, Date.now());
  if (_warned.has(key)) return;
  _warned.add(key);
  console.error(
    `MIGRATION_PENDING ${key} does not exist yet — the feature that needs it ` +
      `is inert until you run the migrations. Re-checked periodically; no ` +
      `redeploy needed once they have.`,
  );
}

/** Tests only. */
export function _resetOptionalColumns() {
  _missing.clear();
  _warned.clear();
}

/**
 * Run a query that mentions an optional column.
 *
 * @param {string}   key       stable name for the column, e.g. "circles.kind_tag"
 * @param {(has:boolean)=>string} buildSql  the SQL, with and without it
 * @param {any[]}    params
 * @param {object}   [deps]    { queryImpl } for tests
 */
export async function queryWithOptionalColumn(key, buildSql, params = [], deps = {}) {
  const run = deps.queryImpl || query;
  if (isMissingNow(key)) {
    const sql = buildSql(false);
    return run(sql, fitParams(key, sql, params));
  }
  try {
    const sql = buildSql(true);
    const res = await run(sql, fitParams(key, sql, params));
    // IT CAME BACK. Either it was always there, or the migration has since run
    // and this is the probe that found it. Say so once, so the log tells the
    // whole story rather than only its unhappy half, and re-arm the warning.
    if (_warned.delete(key)) {
      console.error(`MIGRATION_LANDED ${key} exists now — serving it again.`);
    }
    return res;
  } catch (err) {
    if (err?.code !== UNDEFINED_COLUMN) throw err;
    _missing.set(key, Date.now());
    if (!_warned.has(key)) {
      _warned.add(key);
      // Loud, once per cooldown. A pending migration is an operational fact
      // somebody has to act on -- but a line that keeps appearing from a process
      // that started before the migration is worse than none, because it reads
      // as still-pending when the truth is already-fixed. It is re-armed on
      // every successful re-probe (below), so it says PENDING only while the
      // column is genuinely absent.
      console.error(
        `MIGRATION_PENDING ${key} does not exist yet — serving without it. ` +
          `Run the migrations; it is re-checked every ${Math.round(RECHECK_MS / 1000)}s ` +
          `and picked up without a redeploy.`,
      );
    }
    const fallbackSql = buildSql(false);
    return run(fallbackSql, fitParams(key, fallbackSql, params));
  }
}
