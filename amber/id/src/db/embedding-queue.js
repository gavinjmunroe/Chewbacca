/**
 * THE EMBEDDING QUEUE. Fills observations.embedding.
 *
 * The column and its HNSW index shipped in migration 007 and nothing ever wrote
 * to them, so semantic search over facts has been inert since the schema was
 * designed. This is the job that changes that.
 *
 * WHY A QUEUE AND NOT AN INSERT-TIME CALL. Same argument as the dimension
 * classifier, and the same shape so there is one pattern to understand rather
 * than two: embedding is an HTTP round trip to OpenAI, and putting one inside
 * the transaction that saves a voice note holds a Cloud SQL connection open
 * across a third party's latency. One slow afternoon at their end and the pool
 * is gone.
 *
 * THE PENDING STATE IS `embedding IS NULL`. No status column, deliberately --
 * with one, the column and the status can disagree, and then you have a row that
 * claims to be embedded and is not. The absence of the vector is the truth.
 *
 * BATCHED, because the embeddings endpoint takes many inputs per request and
 * charges per token rather than per call. Fifty facts in one request instead of
 * fifty requests is the difference between a job that keeps up and one that does
 * not.
 */

import { query, withTransaction } from "./sql.js";

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 50;
const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const DIMS = 1536;

/**
 * Claim a batch. Bumping the attempt counter IS the claim, so a worker that dies
 * mid-batch costs those rows one attempt rather than blocking the queue forever.
 */
export async function claimUnembedded(limit = DEFAULT_BATCH) {
  const n = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 200);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT observation_id, body
         FROM observations
        WHERE embedding IS NULL
          AND deleted_at IS NULL
          AND embedding_attempts < $2
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [n, MAX_ATTEMPTS],
    );
    if (rows.length === 0) return [];
    await client.query(
      `UPDATE observations
          SET embedding_attempts = embedding_attempts + 1
        WHERE observation_id = ANY($1::uuid[])`,
      [rows.map((r) => r.observation_id)],
    );
    return rows;
  });
}

/**
 * Many texts, one request. Returns an array positionally aligned with the input,
 * with null where a vector could not be produced -- OpenAI returns results with
 * an `index`, and trusting the response ORDER rather than that index is a
 * silent mis-assignment: every fact embedded as its neighbor, no error
 * anywhere, and search that is confidently wrong.
 */
export async function embedBatch(texts, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetchImpl(EMBED_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        dimensions: DIMS,
        input: texts.map((t) => String(t ?? "").slice(0, 8000)),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data?.data)) return null;
    const out = new Array(texts.length).fill(null);
    for (const item of data.data) {
      const i = Number(item?.index);
      if (!Number.isInteger(i) || i < 0 || i >= texts.length) continue;
      const v = item?.embedding;
      if (Array.isArray(v) && v.length === DIMS) out[i] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** pgvector takes a '[0.1,0.2,...]' literal, cast to ::halfvec. */
const toLiteral = (v) => `[${v.join(",")}]`;

/**
 * Write the vectors back.
 *
 * One statement for the batch, not one per row: fifty round trips to Cloud SQL
 * to save the result of a single round trip to OpenAI is the wrong ratio.
 *
 * `embedding IS NULL` in the WHERE, so a row somebody re-embedded by hand while
 * the batch was in flight is not overwritten by the older vector.
 */
export async function saveEmbeddings(pairs) {
  const live = pairs.filter((p) => p && Array.isArray(p.vector) && p.vector.length === DIMS);
  if (live.length === 0) return 0;
  const { rowCount } = await query(
    `UPDATE observations o
        SET embedding = v.embedding::halfvec(${DIMS})
       FROM unnest($1::uuid[], $2::text[]) AS v(observation_id, embedding)
      WHERE o.observation_id = v.observation_id
        AND o.embedding IS NULL`,
    [live.map((p) => p.observationId), live.map((p) => toLiteral(p.vector))],
  );
  return rowCount ?? 0;
}

/**
 * One pass. `embed` is injectable so the pass is testable without an API key --
 * the whole reason the network call sits behind a function.
 */
export async function runEmbeddingPass({ limit = DEFAULT_BATCH, embed = embedBatch } = {}) {
  const claimed = await claimUnembedded(limit);
  const out = { claimed: claimed.length, embedded: 0, failed: 0 };
  if (claimed.length === 0) return out;

  const vectors = await embed(claimed.map((r) => r.body));
  if (!vectors) {
    // The whole batch failed. Every row keeps its incremented attempt and comes
    // back next run; nothing is written, so a partial batch cannot leave half
    // the corpus embedded by one model and half by another.
    out.failed = claimed.length;
    return out;
  }
  out.embedded = await saveEmbeddings(
    claimed.map((r, i) => ({ observationId: r.observation_id, vector: vectors[i] })),
  );
  out.failed = claimed.length - out.embedded;
  return out;
}

/** Queue depth, for a health check that can say it is backing up. */
export async function unembeddedCount() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM observations
      WHERE embedding IS NULL AND deleted_at IS NULL AND embedding_attempts < $1`,
    [MAX_ATTEMPTS],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Embed a QUESTION, for the read side. Same model and dimensions as the corpus,
 * because a vector from a different model is not comparable to these and would
 * return confident nonsense rather than an error.
 */
export async function embedQuery(text, opts = {}) {
  const got = await embedBatch([text], opts);
  return got?.[0] ?? null;
}

/**
 * The corpus model and its width, exported so nothing else has to hardcode
 * them. contact-vectors.js used to declare its own ("pplx-embed-v1-4b", 2560)
 * and wrote into a halfvec(1536) column, which the database rejected on every
 * single row -- silently, because that module is fail-open. A vector width is
 * exactly the kind of constant that must have ONE definition.
 */
export const EMBEDDING_MODEL = MODEL;
export const EMBEDDING_DIMS = DIMS;
