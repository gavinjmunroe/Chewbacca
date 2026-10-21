/**
 * suppressions.js — global "do not DM" list (decision 14: STOP semantics).
 *
 * When someone replies STOP to a Medha DM, the universal-mute promise
 * (decision 14) says she stops DMing them across ALL groups, ALL events,
 * forever — until they explicitly opt back in. Per-group optInStatus
 * is the right place to record consent, but enforcing the cross-group
 * STOP needs an index keyed by handle.
 *
 * Storage:
 *   - Hot: in-memory Set (instant write-through cache).
 *   - Cold: medha-id /v1/suppressions (flaw #11). On boot we attempt
 *     to hydrate from the cold store; if the endpoint isn't live yet
 *     we keep behaving as in-memory-only and log a single warning.
 *     Every add / remove mirrors to medha-id best-effort; if the
 *     cold write fails we still honor the in-memory state so the
 *     STOP isn't ignored within the process.
 *
 * Lookup is by normalized handle (phone E.164 or email lowercased).
 */

import { canonicalHandle } from "./pdw/phone.js";

const suppressed = new Set();
let hydrated = false;
let warnedNoUrl = false;

function getMedhaIdBase() {
  return process.env.MEDHA_ID_URL || process.env.AMBER_ID_API_URL || null;
}

function getMedhaIdKey() {
  return process.env.MEDHA_ID_API_KEY || process.env.AMBER_ID_API_KEY || null;
}

/**
 * Best-effort POST to medha-id to persist a suppression event. flaw #11.
 * Never throws — caller has already updated the in-memory cache.
 */
async function writeThrough(handle, status) {
  const base = getMedhaIdBase();
  if (!base) return;
  const key = getMedhaIdKey();
  try {
    const url = `${base.replace(/\/$/, "")}/v1/suppressions`;
    const headers = { "content-type": "application/json" };
    if (key) headers["authorization"] = `Bearer ${key}`;
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ handle, status }),
    }).catch(() => null);
  } catch (err) {
    console.warn(
      `[suppressions] write-through failed for ${handle}: ${err?.message || err}`,
    );
  }
}

/**
 * Hydrate the in-memory set from medha-id on boot. Idempotent — only the
 * first call actually does the GET. flaw #11. Safe to skip if the
 * endpoint isn't implemented yet; we just log once.
 */
export async function hydrateSuppressions() {
  if (hydrated) return;
  hydrated = true;
  const base = getMedhaIdBase();
  if (!base) {
    if (!warnedNoUrl) {
      console.warn(
        "[suppressions] no MEDHA_ID_URL / AMBER_ID_API_URL — running in-memory only",
      );
      warnedNoUrl = true;
    }
    return;
  }
  const key = getMedhaIdKey();
  try {
    const url = `${base.replace(/\/$/, "")}/v1/suppressions`;
    const headers = {};
    if (key) headers["authorization"] = `Bearer ${key}`;
    const res = await fetch(url, { headers }).catch(() => null);
    if (!res || !res.ok) return; // endpoint not live; not fatal
    const body = await res.json().catch(() => null);
    const list = Array.isArray(body) ? body : body?.suppressions || [];
    for (const item of list) {
      const raw = typeof item === "string" ? item : item?.handle;
      const h = canonicalHandle(raw);
      if (h) suppressed.add(h);
    }
    console.log(
      `[suppressions] hydrated ${suppressed.size} entries from medha-id`,
    );
  } catch (err) {
    console.warn(`[suppressions] hydrate failed: ${err?.message || err}`);
  }
}

/**
 * Mark a handle as STOPped. Idempotent. Mirrors to medha-id best-effort.
 */
export function addSuppression(rawHandle) {
  const h = canonicalHandle(rawHandle);
  if (!h) return;
  suppressed.add(h);
  // Fire-and-forget cold write (flaw #11). Never await.
  writeThrough(h, "stopped");
}

/**
 * Lift a suppression — for when someone opts back in (e.g. types YES
 * after a STOP). Mirrors to medha-id best-effort.
 */
export function removeSuppression(rawHandle) {
  const h = canonicalHandle(rawHandle);
  if (!h) return;
  suppressed.delete(h);
  writeThrough(h, "opted_in");
}

/**
 * Is this handle currently STOPped? Returns boolean. Used by dm-each.js
 * before each per-recipient send.
 */
export function isSuppressed(rawHandle) {
  const h = canonicalHandle(rawHandle);
  if (!h) return false;
  return suppressed.has(h);
}

/**
 * Filter a list of handles, dropping any that are STOPped. Returns the
 * surviving handles. Convenience for fan-out callers.
 */
export function filterSuppressed(handles) {
  if (!Array.isArray(handles)) return [];
  return handles.filter((h) => !isSuppressed(h));
}

/**
 * Snapshot of the current suppression list — for /debug surfaces.
 */
export function listSuppressed() {
  return Array.from(suppressed);
}
