/**
 * Perplexity embeddings wrapper.
 *
 * Perplexity is the sole embedding brain across Amber. The live model is
 * `pplx-embed-v1-4b` which returns 2560-dimensional int8-quantized
 * vectors. We request them explicitly via `encoding_format: "base64_int8"`
 * and decode to a dense float array in the range ~[-1, 1] (each int8 /
 * 127). Pinecone indexes must be created with dimension=2560.
 *
 * No SDK dependency — hit the HTTP API directly with fetch.
 */

const API_URL = "https://api.perplexity.ai/v1/embeddings";
const MODEL = process.env.PERPLEXITY_EMBEDDING_MODEL || "pplx-embed-v1-4b";
const DIMS = Number(process.env.PERPLEXITY_EMBEDDING_DIMS || 2560);
const MAX_BATCH = 96;

function requireKey() {
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is not configured");
  }
  return process.env.PERPLEXITY_API_KEY;
}

async function callApi(inputs) {
  const key = requireKey();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: inputs,
      encoding_format: "base64_int8",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `perplexity embeddings ${res.status}: ${body.slice(0, 300)}`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Decode Perplexity's base64 int8 payload into a dense float[] normalized
 * to ~[-1, 1]. Each signed byte is divided by 127. Final length is clamped
 * to DIMS so Pinecone always sees a fixed-size vector.
 */
function decodeInt8Base64(v) {
  if (!v || typeof v !== "string") return new Array(DIMS).fill(0);
  const buf = Buffer.from(v, "base64");
  const raw = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    out[i] = i < raw.length ? raw[i] / 127 : 0;
  }
  return out;
}

/**
 * Embed a single string. Returns number[DIMS] in ~[-1, 1].
 */
export async function embed(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("embed() requires a non-empty string");
  }
  const [vec] = await embedMany([text]);
  return vec;
}

/**
 * Embed a batch of strings in one API call (chunked). Preserves input order.
 * Empty or whitespace-only entries are replaced with a single space so the
 * API doesn't reject the batch.
 */
export async function embedMany(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const normalized = texts.map((t) =>
    typeof t === "string" && t.trim() ? t : " ",
  );

  const results = new Array(normalized.length);
  for (let i = 0; i < normalized.length; i += MAX_BATCH) {
    const chunk = normalized.slice(i, i + MAX_BATCH);
    let resp;
    try {
      resp = await callApi(chunk);
    } catch (err) {
      if (err.status && err.status >= 500) {
        await new Promise((r) => setTimeout(r, 250));
        resp = await callApi(chunk);
      } else {
        throw err;
      }
    }
    const items = Array.isArray(resp?.data) ? resp.data : [];
    for (const item of items) {
      const idx = typeof item.index === "number" ? item.index : 0;
      results[i + idx] = decodeInt8Base64(item.embedding);
    }
  }
  return results;
}

export const EMBEDDING_DIMS = DIMS;
export const EMBEDDING_MODEL = MODEL;
