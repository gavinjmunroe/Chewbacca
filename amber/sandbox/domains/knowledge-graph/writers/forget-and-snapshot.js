/**
 * Forget-on-demand + memory snapshots.
 *
 * Two capabilities sit on top of the per-tenant Pinecone namespace:
 *
 *   forgetMemory  — "Medha, forget the Carlo conversation" deletes the
 *                   matching vectors. Selection is by explicit ids, by a
 *                   semantic `text` match (the portable default), or by an
 *                   exact metadata filter.
 *   snapshotMemory — "What did you know about me as of last month" returns
 *                   the chunks indexed at or before a cutoff date, biased
 *                   toward consolidated daily highlights when present.
 *
 * Both operate on the single authoritative per-tenant namespace,
 * `tenant-<did>`, via knowledge/pinecone-client.js. The dual-write
 * migration is finished: the legacy cNFT-keyed namespace has been folded
 * into the DID namespace and deleted, so there is exactly one place to
 * read from and delete in. Callers no longer pass a cnftMint, and the
 * result no longer carries a `legacy` block.
 *
 * `created_at` / `ingested_at` are stored as UTC ISO strings
 * (`new Date().toISOString()`), which sort lexically in chronological
 * order. Date cutoffs are therefore applied as string comparisons in JS
 * rather than Pinecone metadata range filters (those only work on numeric
 * fields).
 */

import { embedMany } from "../service/lib/embed.js";
import * as didPinecone from "../service/lib/pinecone.js";

const DEFAULT_FORGET_MATCHES = 50;
const MAX_FORGET_MATCHES = 200;
const DEFAULT_SNAPSHOT_TOPK = 50;
const MAX_SNAPSHOT_TOPK = 200;
const HIGHLIGHT_KIND = "daily_highlight";

/**
 * Build a Pinecone exact-match metadata filter from the caller-facing
 * forget/snapshot params. Range cutoffs (before_date / as_of) are NOT
 * encoded here — `created_at` is a string field, so date filtering happens
 * client-side via timestampOf(). Returns `{}` when nothing was provided.
 */
export function buildMemoryFilter({ dimension, kind, source_id_match } = {}) {
  const filter = {};
  if (dimension) {
    filter.health_dimension = Array.isArray(dimension)
      ? { $in: dimension }
      : dimension;
  }
  if (kind) {
    filter.kind = Array.isArray(kind) ? { $in: kind } : kind;
  }
  if (source_id_match) {
    filter.source = source_id_match;
  }
  return filter;
}

/** Best-available ISO timestamp for a match, preferring authored time. */
export function timestampOf(match) {
  const meta = match?.metadata || {};
  return meta.created_at || meta.ingested_at || null;
}

/** True when the match was authored strictly before `cutoff` (ISO string). */
export function isBefore(match, cutoff) {
  if (!cutoff) return true;
  const ts = timestampOf(match);
  return !!ts && String(ts) < cutoff;
}

/** True when the match was authored at or before `cutoff` (ISO string). */
export function isAtOrBefore(match, cutoff) {
  if (!cutoff) return true;
  const ts = timestampOf(match);
  return !!ts && String(ts) <= cutoff;
}

function clamp(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Resolve the ids to delete inside one namespace by semantic match.
 * Over-fetches so the client-side before_date cut still leaves headroom,
 * then trims to maxMatches.
 */
async function resolveIdsByText(
  queryFn,
  key,
  vector,
  { filter, beforeDate, maxMatches },
) {
  const overfetch = Math.min(100, Math.max(maxMatches * 2, maxMatches + 20));
  const matches = await queryFn(key, vector, { topK: overfetch, filter });
  return matches
    .filter((m) => isBefore(m, beforeDate))
    .slice(0, maxMatches)
    .map((m) => m.id);
}

/**
 * Delete vectors from a tenant's knowledge base.
 *
 * Selection precedence:
 *   1. explicit `ids`            -> deletes those ids (the same ids
 *      /knowledge/query returns).
 *   2. semantic `text`           -> queries the namespace for matching ids
 *      (optionally narrowed by filter + before_date) and deletes them.
 *      This is the portable default and the path the forget_memory agent
 *      tool uses.
 *   3. exact metadata `filter`   -> native metadata-filtered delete
 *      (pod-index only; surfaces an error for serverless).
 *
 * Returns a summary describing what was removed. The `legacy` field that
 * described the retired cNFT namespace is gone; `didNamespace` carries the
 * one namespace-level result.
 */
export async function forgetMemory({
  privyDid,
  ids,
  text,
  dimension,
  kind,
  sourceIdMatch,
  beforeDate,
  maxMatches,
  log,
} = {}) {
  if (!privyDid) {
    throw new Error("forgetMemory requires a privyDid");
  }
  const cap = clamp(maxMatches, DEFAULT_FORGET_MATCHES, MAX_FORGET_MATCHES);
  const filter = buildMemoryFilter({
    dimension,
    kind,
    source_id_match: sourceIdMatch,
  });
  const cleanText = typeof text === "string" ? text.trim() : "";

  // 1. Explicit ids — caller already resolved them against this namespace.
  if (Array.isArray(ids) && ids.length) {
    const didNamespace = await didPinecone.forget(privyDid, { ids });
    return {
      mode: "ids",
      deleted: ids.length,
      ids,
      didNamespace,
    };
  }

  // 2. Semantic text match — resolve, then delete.
  if (cleanText) {
    const [vector] = await embedMany([cleanText]);

    const matchedIds = await resolveIdsByText(
      didPinecone.query,
      privyDid,
      vector,
      {
        filter,
        beforeDate,
        maxMatches: cap,
      },
    );

    // A forget that resolves matches but fails to delete must not look like
    // a success, so unlike the old best-effort second namespace this error
    // is surfaced rather than logged and swallowed.
    let didNamespace;
    try {
      didNamespace = matchedIds.length
        ? await didPinecone.forget(privyDid, { ids: matchedIds })
        : { deleted: 0 };
    } catch (err) {
      if (log?.warn) {
        log.warn(
          { err: err?.message, privyDid },
          "forget delete failed after resolving matches",
        );
      }
      throw err;
    }

    return {
      mode: "semantic",
      query: cleanText,
      deleted: matchedIds.length,
      matchedIds,
      didNamespace,
    };
  }

  // 3. Pure metadata filter — native filtered delete.
  if (Object.keys(filter).length === 0) {
    return {
      mode: "none",
      deleted: 0,
      reason: "no_selector",
      message:
        "Provide ids, a text phrase to match, or at least one of " +
        "dimension / kind / source_id_match.",
    };
  }

  let didNamespace;
  try {
    didNamespace = await didPinecone.forgetByFilter(privyDid, filter);
  } catch (err) {
    didNamespace = { error: err?.message || String(err) };
  }
  return {
    mode: "filter",
    deleted: "by_filter",
    filter,
    didNamespace,
  };
}

/**
 * Return the chunks the tenant's knowledge base held at or before `asOf`.
 *
 * Reads the tenant's `tenant-<did>` namespace, now the only copy.
 * `text` anchors the semantic query; when omitted a broad summary anchor
 * is used so the snapshot reflects "what was known" rather than a topic.
 * Daily-highlight consolidations are surfaced first when
 * `preferHighlights` is set, since they are the human-readable digest.
 */
export async function snapshotMemory({
  privyDid,
  asOf,
  text,
  topK,
  kind,
  preferHighlights = true,
} = {}) {
  if (!privyDid) {
    throw new Error("snapshotMemory requires a privyDid");
  }
  const limit = clamp(topK, DEFAULT_SNAPSHOT_TOPK, MAX_SNAPSHOT_TOPK);
  const anchor =
    typeof text === "string" && text.trim()
      ? text.trim()
      : "a summary of everything known about me";
  const filter = kind
    ? { kind: Array.isArray(kind) ? { $in: kind } : kind }
    : undefined;

  const [vector] = await embedMany([anchor]);
  // Over-fetch so the date cut and highlight re-rank have headroom.
  const overfetch = Math.min(300, Math.max(limit * 4, limit + 50));
  let matches = await didPinecone.query(privyDid, vector, {
    topK: overfetch,
    filter,
  });

  matches = matches.filter((m) => isAtOrBefore(m, asOf));

  if (preferHighlights) {
    const isHighlight = (m) => (m.metadata?.kind || "") === HIGHLIGHT_KIND;
    const highlights = matches.filter(isHighlight);
    const rest = matches.filter((m) => !isHighlight(m));
    matches = [...highlights, ...rest];
  }

  const trimmed = matches.slice(0, limit);
  return {
    as_of: asOf || null,
    count: trimmed.length,
    matches: trimmed,
  };
}
