/**
 * A SOURCE WITH NO TRUST WEIGHT IS NOT AN ERROR. IT IS QUIETLY AVERAGE, FOREVER.
 *
 * contact_dimension_state scores every observation with
 *
 *     COALESCE((SELECT value FROM scoring_params WHERE key = 'source_' || o.source), 0.5)
 *
 * so a writer that invents a new `source` string does not fail, does not warn,
 * and does not get the weight somebody would have chosen for it. It gets 0.5.
 * Migration 027 found six such strings and 243 rows that had been scoring 0.5
 * since the day they were written; 038 found two more added in a single week.
 * Nothing in between noticed, because there was nothing to notice with.
 *
 * This is that something. The first time a process writes an observation with a
 * source that has no scoring_params row, it says so, once, by name -- so the
 * missing weight is a line in the deploy logs rather than an archaeology
 * exercise months later.
 *
 * WHY NOT A TEST. A static scan of the code for `source: "..."` cannot tell an
 * observation source from a contact import provider or an embedding backend --
 * they share the word. The set of strings that actually reach an observation is
 * only known at the moment one is written, so that is where the check belongs.
 *
 * WHY NOT FAIL THE WRITE. Because the observation is the valuable thing and the
 * weight is a tuning parameter. Refusing to record what somebody said, because
 * a row in a scoring table is absent, would trade a real loss for a cosmetic
 * one. It warns, it writes, and the default stands until somebody sets a weight.
 *
 * ONE QUERY PER UNSEEN SOURCE PER PROCESS. Sources are a handful of literals in
 * the code, so this settles into zero queries almost immediately -- and it is
 * fire-and-forget, so it can never slow down or break a write.
 */

import { query } from "./sql.js";

// Sources this process has already resolved: name -> true when a weight exists.
const _checked = new Map();
// So the warning is one line per source per process.
const _warned = new Set();

/**
 * Note that an observation was written from this source, and warn if it has no
 * trust weight. Never throws, never awaited by the caller.
 */
export function noteObservationSource(source, deps = {}) {
  const key = typeof source === "string" ? source.trim() : "";
  if (!key || _checked.has(key)) return;
  // Marked before the query so a burst of writes fires one check, not fifty.
  _checked.set(key, true);
  const run = deps.queryImpl || query;
  Promise.resolve()
    .then(() => run(`SELECT 1 FROM scoring_params WHERE key = $1 LIMIT 1`, [`source_${key}`]))
    .then((res) => {
      if (res?.rowCount > 0 || (res?.rows?.length ?? 0) > 0) return;
      if (_warned.has(key)) return;
      _warned.add(key);
      console.error(
        `SOURCE_TRUST_MISSING source='${key}' has no scoring_params row ` +
          `('source_${key}'), so every observation from it scores 0.5 by default. ` +
          `Add it in a migration with the weight it should actually have.`,
      );
    })
    .catch(() => {
      // A failed check must never surface: the observation was written, and this
      // is a diagnostic. Forget the result so a later write can try again.
      _checked.delete(key);
    });
}

/** Tests only. */
export function _resetSourceTrust() {
  _checked.clear();
  _warned.clear();
}
