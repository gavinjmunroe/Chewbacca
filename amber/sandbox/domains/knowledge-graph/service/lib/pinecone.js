/**
 * Sandbox-owned Pinecone client for the Amber knowledge graph.
 *
 * Ported from `amber-id/src/knowledge/pinecone-client.js` at merge of
 * PR #187 (feat/namespace-visibility). The KG lives here now — amber-id
 * calls this service over HTTP; there is no direct Pinecone client left
 * in amber-id after the extraction.
 *
 * Namespace model (see `docs/references/pinecone-namespace-map.md`):
 *
 *   tenant-<did>  — private truth, only the owner reads it
 *   share-<did>   — cleared-to-share copies, readable by other DIDs the
 *                   owner has granted access to. Sensitive metadata
 *                   (stage_2_score, health assessments, phones, emails,
 *                   raw voice/message payloads) is stripped by
 *                   `clearVectors` before it lands here.
 *
 * Index:        `amber-people` (PINECONE_INDEX env override)
 * Dimension:    2560 (Perplexity pplx-embed-v1-4b — matches embed.js)
 * Metric:       cosine
 * Metadata:     { kind, source, created_at, did } required on every vec
 */

import { EMBEDDING_DIMS } from "./embed.js";
import { deriveId } from "./deriveId.js";

const INDEX_NAME =
  process.env.PINECONE_INDEX_DID ||
  process.env.PINECONE_INDEX ||
  "amber-people";

// Namespace prefix for non-prod deployments so a staging service doesn't
// bleed into the prod namespace. Empty in production.
const NAMESPACE_PREFIX = process.env.PINECONE_NAMESPACE_PREFIX || "";
const INSTANCE_ID = process.env.AMBER_INSTANCE_ID || "default";

// The six health dimensions — Amber's canonical ontology. Mirrored from
// amber-id's `src/lib/dimensions.js`. Never invent new dimensions; never
// rename. See ARCHITECTURE-SIX-DIMENSIONS.md.
export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);
export const CROSS_DIMENSION = "*";
const VALID_DIMENSION_SET = new Set([...DIMENSIONS, CROSS_DIMENSION]);

function isValidDimension(d) {
  return typeof d === "string" && VALID_DIMENSION_SET.has(d);
}

function assertDimension(d, { field = "health_dimension" } = {}) {
  if (!isValidDimension(d)) {
    const err = new Error(
      `${field} must be one of [${DIMENSIONS.join(", ")}, "*"] — got ${JSON.stringify(d)}`,
    );
    err.statusCode = 400;
    err.code = "invalid_dimension";
    throw err;
  }
  return d;
}

let clientPromise = null;
let indexCache = null;

async function getIndex() {
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY is not configured");
  }
  if (!clientPromise) {
    clientPromise = import("@pinecone-database/pinecone").then(
      ({ Pinecone }) => new Pinecone({ apiKey: process.env.PINECONE_API_KEY }),
    );
  }
  const client = await clientPromise;
  if (!indexCache) indexCache = client.index(INDEX_NAME);
  return indexCache;
}

function namespaceWithPrefix(ns) {
  return `${NAMESPACE_PREFIX}${ns}`;
}

/**
 * Convert a Privy DID into a Pinecone-namespace-safe string.
 *
 *   did:privy:abc123  ->  tenant-did-privy-abc123
 */
export function namespaceFor(privyDid) {
  if (!privyDid || typeof privyDid !== "string") {
    throw new Error("privyDid is required to scope Pinecone operations");
  }
  const slug = privyDid.toLowerCase().replace(/:/g, "-");
  return namespaceWithPrefix(`tenant-${slug}`);
}

/**
 * Cleared-to-share namespace: share-<did>.
 */
export function namespaceForShare(privyDid) {
  if (!privyDid || typeof privyDid !== "string") {
    throw new Error("privyDid is required to scope Pinecone operations");
  }
  const slug = privyDid.toLowerCase().replace(/:/g, "-");
  return namespaceWithPrefix(`share-${slug}`);
}

/**
 * Resolve the namespace for `ownerDid` given a caller `scope`:
 *
 *   'private' → tenant-<ownerDid>   (owner reading their own truth)
 *   'shared'  → share-<ownerDid>    (reader != owner)
 */
export function resolveNamespace(privyDid, scope = "private") {
  if (scope === "shared") return namespaceForShare(privyDid);
  if (scope === "private" || scope === undefined || scope === null) {
    return namespaceFor(privyDid);
  }
  const err = new Error(
    `scope must be 'private' or 'shared'; got ${JSON.stringify(scope)}`,
  );
  err.statusCode = 400;
  err.code = "invalid_scope";
  throw err;
}

/**
 * Upsert vectors into a tenant's namespace.
 *
 * See the amber-id historical docstring for the full validation contract.
 * Same two-phase check: vector length === EMBEDDING_DIMS and (unless
 * opts.requireDimension === false) `healthDimension` MUST be a recognized
 * dimension.
 */
export async function upsert(privyDid, items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return { upserted: 0 };
  const ns = namespaceFor(privyDid);
  const index = await getIndex();
  const now = new Date().toISOString();
  const callerClient = opts.clientId || null;
  const requireDimension = opts.requireDimension !== false;

  items.forEach((item, i) => {
    if (!Array.isArray(item.vector) || item.vector.length !== EMBEDDING_DIMS) {
      const err = new Error(
        `items[${i}]: vector must be number[${EMBEDDING_DIMS}], got ${
          Array.isArray(item.vector)
            ? `length ${item.vector.length}`
            : typeof item.vector
        }`,
      );
      err.statusCode = 400;
      err.code = "invalid_dimension";
      throw err;
    }
    if (!item.healthDimension) {
      if (requireDimension) {
        const err = new Error(
          `items[${i}]: healthDimension is required (one of ${DIMENSIONS.join(", ")} or "*")`,
        );
        err.statusCode = 400;
        err.code = "missing_dimension";
        throw err;
      }
    } else {
      assertDimension(item.healthDimension, {
        field: `items[${i}].healthDimension`,
      });
    }
    if (Array.isArray(item.secondaryDimensions)) {
      item.secondaryDimensions.forEach((d, j) =>
        assertDimension(d, { field: `items[${i}].secondaryDimensions[${j}]` }),
      );
    }
    if (item.dimensionScores && typeof item.dimensionScores === "object") {
      for (const key of Object.keys(item.dimensionScores)) {
        assertDimension(key, { field: `items[${i}].dimensionScores key` });
      }
    }
  });

  const records = items.map((item) => {
    const rawMeta = {
      did: privyDid,
      instance_id: INSTANCE_ID,
      client_id: callerClient || undefined,
      source: item.source || "manual",
      kind: item.kind || "observation",
      person_id: item.personId || undefined,
      person_name: item.personName || undefined,
      health_dimension: item.healthDimension || undefined,
      secondary_dimensions: Array.isArray(item.secondaryDimensions)
        ? item.secondaryDimensions
        : undefined,
      dimension_scores:
        item.dimensionScores && Object.keys(item.dimensionScores).length > 0
          ? JSON.stringify(item.dimensionScores)
          : undefined,
      visibility: item.visibility || "private",
      trust: typeof item.trust === "number" ? item.trust : 0.65,
      text: (item.text || "").slice(0, 4000),
      created_at: item.createdAt || now,
      ingested_at: now,
      dimension: EMBEDDING_DIMS,
      ...(item.extra || {}),
    };
    const metadata = {};
    for (const [k, v] of Object.entries(rawMeta)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        metadata[k] = JSON.stringify(v);
      } else {
        metadata[k] = v;
      }
    }
    return { id: deriveId(privyDid, item), values: item.vector, metadata };
  });

  for (let i = 0; i < records.length; i += 100) {
    await index.namespace(ns).upsert(records.slice(i, i + 100));
  }
  return { upserted: records.length, namespace: ns };
}

/**
 * Top-K semantic search within a tenant's namespace (scope-aware).
 */
export async function query(
  privyDid,
  vector,
  { topK = 24, filter, scope = "private" } = {},
) {
  const ns = resolveNamespace(privyDid, scope);
  const index = await getIndex();
  const result = await index.namespace(ns).query({
    vector,
    topK,
    includeValues: false,
    includeMetadata: true,
    filter,
  });
  return (result.matches || []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata || {},
  }));
}

/**
 * Dimension-weighted retrieval — same formula as amber-id.
 */
export async function queryWeighted(
  privyDid,
  vector,
  {
    topK = 24,
    filter,
    weights = null,
    trustExponent = 1.0,
    scope = "private",
  } = {},
) {
  const overfetch = Math.min(100, Math.max(topK * 3, topK + 16));
  const matches = await query(privyDid, vector, {
    topK: overfetch,
    filter,
    scope,
  });

  const dimW = (d) => {
    if (!weights) return 1.0;
    if (d === CROSS_DIMENSION) {
      const vals = Object.values(weights);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1.0;
    }
    return weights[d] ?? 0.5;
  };

  const rescored = matches.map((m) => {
    const md = m.metadata || {};
    const trust = typeof md.trust === "number" ? md.trust : 0.65;
    const dw = dimW(md.health_dimension);
    const rankScore = m.score * Math.pow(trust, trustExponent) * dw;
    return { ...m, rankScore, trust, dimensionWeight: dw };
  });

  rescored.sort((a, b) => b.rankScore - a.rankScore);
  return rescored.slice(0, topK);
}

export async function fetchRecords(privyDid, ids, { scope = "private" } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const ns = resolveNamespace(privyDid, scope);
  const index = await getIndex();
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await index.namespace(ns).fetch(batch);
    const recs = res?.records || res?.vectors || {};
    for (const rec of Object.values(recs)) {
      if (!rec || !rec.id) continue;
      out.push({
        id: rec.id,
        values: Array.isArray(rec.values) ? rec.values : [],
        metadata: rec.metadata || {},
      });
    }
  }
  return out;
}

export async function listVectorIds(privyDid, { limit = 1000, prefix } = {}) {
  const ns = namespaceFor(privyDid);
  const index = await getIndex();
  const ids = [];
  let paginationToken;
  do {
    const page = await index.namespace(ns).listPaginated({
      limit: Math.min(100, limit - ids.length),
      paginationToken,
      ...(prefix ? { prefix } : {}),
    });
    for (const v of page?.vectors || []) {
      if (v?.id) ids.push(v.id);
    }
    paginationToken = page?.pagination?.next;
  } while (paginationToken && ids.length < limit);
  return ids;
}

export const listIds = listVectorIds;

export async function updateMetadata(
  privyDid,
  id,
  metadata,
  { scope = "private" } = {},
) {
  if (!id || !metadata || typeof metadata !== "object") return { updated: 0 };
  const ns = resolveNamespace(privyDid, scope);
  const index = await getIndex();
  await index.namespace(ns).update({ id: String(id), metadata });
  return { updated: 1 };
}

/**
 * Delete some or all vectors. In private scope, ALSO deletes the shared
 * copy of each id so /forget can't leave dangling projections in
 * share-<did>.
 */
export async function forget(
  privyDid,
  { ids, all = false, scope = "private", alsoShared = true } = {},
) {
  const ns = resolveNamespace(privyDid, scope);
  const index = await getIndex();
  if (all) {
    await index.namespace(ns).deleteAll();
    if (scope === "private" && alsoShared) {
      try {
        await index.namespace(namespaceForShare(privyDid)).deleteAll();
      } catch {
        // share namespace may not exist — not an error.
      }
    }
    return { deleted: "all", namespace: ns };
  }
  if (Array.isArray(ids) && ids.length) {
    await index.namespace(ns).deleteMany(ids);
    let sharedDeleted = 0;
    if (scope === "private" && alsoShared) {
      try {
        await index.namespace(namespaceForShare(privyDid)).deleteMany(ids);
        sharedDeleted = ids.length;
      } catch {
        // fine — shared copy may not exist for every id.
      }
    }
    return {
      deleted: ids.length,
      namespace: ns,
      sharedDeleted: alsoShared ? sharedDeleted : 0,
    };
  }
  return { deleted: 0, namespace: ns };
}

export async function forgetByFilter(privyDid, filter = {}) {
  const ns = namespaceFor(privyDid);
  if (!filter || Object.keys(filter).length === 0) {
    const err = new Error(
      "forgetByFilter requires a non-empty filter; refusing to wipe the namespace",
    );
    err.statusCode = 400;
    err.code = "empty_filter";
    throw err;
  }
  const index = await getIndex();
  await index.namespace(ns).deleteMany({ filter });
  return { deleted: "by_filter", filter, namespace: ns };
}

export async function stats(privyDid) {
  const index = await getIndex();
  const s = await index.describeIndexStats();
  const ns = namespaceFor(privyDid);
  const nsStats = (s.namespaces || {})[ns] || { recordCount: 0 };
  return {
    namespace: ns,
    indexName: INDEX_NAME,
    recordCount: nsStats.recordCount || 0,
    indexDimension: s.dimension || null,
    totalRecordsInIndex: s.totalRecordCount || null,
  };
}

/**
 * Metadata keys that MUST NOT survive projection into `share-<did>`.
 * If a caller adds a new sensitive field, list it here so /clear enforces
 * the trust boundary at the surface, not by relying on every ingestion
 * path to remember to strip.
 */
export const SENSITIVE_METADATA_KEYS = Object.freeze([
  "stage_2_score",
  "health_dimension",
  "secondary_dimensions",
  "dimension_scores",
  "phone",
  "phones",
  "email",
  "emails",
  "contact_channels",
  "raw_message",
  "raw_body",
  "raw_payload",
  "voice_transcript",
  "health_assessment",
]);

function stripSensitive(metadata) {
  const cleaned = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (SENSITIVE_METADATA_KEYS.includes(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

/**
 * Clearance projection — copy vectors from tenant-<ownerDid> into
 * share-<ownerDid>, strip sensitive metadata, stamp provenance.
 * Idempotent under the same id (re-shares update in place).
 */
export async function clearVectors(ownerDid, ids, clearedScope) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { cleared: 0, namespace: namespaceForShare(ownerDid) };
  }
  if (!clearedScope || typeof clearedScope !== "string") {
    const err = new Error("clearVectors requires a non-empty cleared_scope");
    err.statusCode = 400;
    err.code = "missing_scope";
    throw err;
  }
  const privateNs = namespaceFor(ownerDid);
  const shareNs = namespaceForShare(ownerDid);
  const index = await getIndex();
  const clearedAt = new Date().toISOString();

  const records = await fetchRecords(ownerDid, ids);
  const projected = [];
  const missing = [];
  for (const id of ids) {
    const rec = records.find((r) => r.id === id);
    if (!rec || !Array.isArray(rec.values) || rec.values.length === 0) {
      missing.push(id);
      continue;
    }
    const metadata = stripSensitive(rec.metadata || {});
    metadata.origin_owner = ownerDid;
    metadata.owner_did = ownerDid;
    metadata.cleared_scope = clearedScope;
    metadata.cleared_at = clearedAt;
    metadata.origin_namespace = privateNs;
    projected.push({ id: rec.id, values: rec.values, metadata });
  }

  for (let i = 0; i < projected.length; i += 100) {
    await index.namespace(shareNs).upsert(projected.slice(i, i + 100));
  }

  return {
    cleared: projected.length,
    missing,
    namespace: shareNs,
    origin_namespace: privateNs,
    cleared_scope: clearedScope,
    cleared_at: clearedAt,
  };
}

export async function unshareVectors(ownerDid, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { unshared: 0, namespace: namespaceForShare(ownerDid) };
  }
  const shareNs = namespaceForShare(ownerDid);
  const index = await getIndex();
  await index.namespace(shareNs).deleteMany(ids);
  return { unshared: ids.length, namespace: shareNs };
}

export const INDEX = INDEX_NAME;
