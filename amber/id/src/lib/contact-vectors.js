/**
 * Contact embedding index (INTERIM — see docs/PLAN-peoplerank-pgvector.md).
 *
 * Precomputes one vector per contact (name + facts) into the
 * `contact_embedding` pgvector table, and retrieves the top-K most relevant
 * contacts for a query with an indexed ANN lookup. This lets the ranker see a
 * small pre-filtered set instead of re-ranking the whole address book cold.
 *
 * THIS FILE WAS WRITING 2560-DIMENSION VECTORS INTO A halfvec(1536) COLUMN.
 * It embedded with Perplexity pplx-embed-v1-4b while contact_embedding has
 * always been 1536 wide (migration 017; see the note in 020). Postgres rejected
 * every INSERT, and because everything here is FAIL-OPEN the rejection was
 * swallowed: the table stayed empty, retrieveTopK always returned null, and
 * chat quietly re-ranked the whole address book on every turn. No error, no
 * log, no symptom except latency — the failure mode fail-open is supposed to
 * protect you from, doing the opposite.
 *
 * It also billed a Perplexity embedding call on EVERY chat turn (retrieveTopK)
 * and every note/contact write (reembedContactSoon), for rows that could never
 * land. Now it uses the same OpenAI model and width as the observations corpus,
 * imported from db/embedding-queue.js so the two can never drift apart again.
 *
 * EVERYTHING here is FAIL-OPEN: if the table is missing, the embedding API is
 * unconfigured, or any query errors, functions return null/empty/no-op so the
 * caller falls back to the existing full-set path. Nothing throws. The one
 * thing that is no longer allowed to fail quietly is a WIDTH mismatch — see
 * the guard in embedContacts.
 */

import crypto from "node:crypto";
import { query } from "../db/sql.js";
import {
  embedBatch,
  embedQuery,
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
} from "../db/embedding-queue.js";

// Recorded in contact_embedding.model so a future re-embed can tell which
// rows came from which model instead of guessing.
const MODEL = EMBEDDING_MODEL;

function factText(f) {
  if (!f) return "";
  return String(f.text || f.factText || f.fact_text || f.content || "").trim();
}

/** One composed document per contact: name plus everything you've noted. */
export function composeContactText(contact, facts) {
  const name = String(contact?.full_name || contact?.name || "").trim();
  const factLines = (Array.isArray(facts) ? facts : [])
    .map(factText)
    .filter(Boolean)
    .slice(0, 40);
  const parts = [];
  if (name) parts.push(name);
  if (factLines.length) parts.push("Facts: " + factLines.join("; "));
  return parts.join("\n").trim();
}

function hashText(t) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

/** pgvector accepts a '[0.1,0.2,...]' text literal, cast to ::halfvec. */
function toVectorLiteral(vec) {
  return "[" + vec.map((x) => (Number.isFinite(x) ? x.toFixed(6) : 0)).join(",") + "]";
}

/**
 * Embed + upsert a batch of contacts for one owner. `factsMap` is
 * { [contactId]: facts[] }. Skips contacts whose composed text is unchanged
 * (content_hash match), so re-runs are cheap. Fail-open; returns counts.
 */
export async function embedContacts(ownerId, contacts, factsMap = {}) {
  const result = { embedded: 0, skipped: 0, errored: 0 };
  if (!ownerId || !Array.isArray(contacts) || contacts.length === 0) return result;
  try {
    const composed = contacts
      .map((c) => {
        const text = composeContactText(c, factsMap[String(c.id)] || []);
        // NOT Number(c.id). contacts.id is a uuid, so Number() gave NaN and the
        // Number.isFinite filter below then dropped EVERY contact -- this whole
        // function embedded nothing, silently, for every owner.
        return { id: String(c.id), text, hash: text ? hashText(text) : null };
      })
      .filter((x) => x.text && x.id);
    if (composed.length === 0) return result;

    // Load existing hashes so unchanged contacts don't hit the embedding API.
    const existing = {};
    try {
      const { rows } = await query(
        `SELECT contact_id, content_hash FROM contact_embedding
         WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
        [ownerId, composed.map((x) => x.id)],
      );
      for (const r of rows) existing[String(r.contact_id)] = r.content_hash;
    } catch {
      /* table may not exist yet — treat everything as new */
    }

    const todo = composed.filter((x) => existing[String(x.id)] !== x.hash);
    result.skipped = composed.length - todo.length;
    if (todo.length === 0) return result;

    // embedBatch returns null when the whole request failed (no key, timeout,
    // non-2xx), and an array with null HOLES for individual inputs it could not
    // embed. Both have to be handled: indexing into null is what turned a
    // provider outage into a caught exception and an empty result.
    const vectors = await embedBatch(todo.map((x) => x.text));
    if (!Array.isArray(vectors)) {
      result.errored += todo.length;
      return result;
    }
    for (let i = 0; i < todo.length; i++) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || vec.length === 0) {
        result.errored++;
        continue;
      }
      // THE GUARD THIS FILE DID NOT HAVE. A width mismatch is a configuration
      // error, not a transient one, and it cannot be allowed to look like an
      // ordinary skipped row: at 2560-into-1536 that silence cost this feature
      // its entire working life.
      if (vec.length !== EMBEDDING_DIMS) {
        console.error(
          `[contact-vectors] REFUSING to write a ${vec.length}-dim vector into ` +
            `halfvec(${EMBEDDING_DIMS}). Model=${MODEL}. Fix the model or the column; ` +
            `contact pre-filtering is disabled until they agree.`,
        );
        result.errored++;
        continue;
      }
      try {
        await query(
          `INSERT INTO contact_embedding (owner_id, contact_id, embedding, content_hash, model, updated_at)
           VALUES ($1, $2, $3::halfvec, $4, $5, now())
           ON CONFLICT (owner_id, contact_id) DO UPDATE
             SET embedding = EXCLUDED.embedding,
                 content_hash = EXCLUDED.content_hash,
                 model = EXCLUDED.model,
                 updated_at = now()`,
          [ownerId, todo[i].id, toVectorLiteral(vec), todo[i].hash, MODEL],
        );
        result.embedded++;
      } catch {
        result.errored++;
      }
    }
  } catch {
    /* fail-open */
  }
  return result;
}

/**
 * Top-K contact ids most relevant to `queryText` for this owner, via the HNSW
 * index. Returns null on any error / not-configured / no rows, so the caller
 * uses the full contact set (never a regression).
 */
export async function retrieveTopK(ownerId, queryText, k = 40) {
  if (!ownerId || typeof queryText !== "string" || !queryText.trim()) return null;
  try {
    const vec = await embedQuery(queryText);
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) return null;
    const { rows } = await query(
      `SELECT contact_id FROM contact_embedding
       WHERE owner_id = $1
       ORDER BY embedding <=> $2::halfvec
       LIMIT $3`,
      [ownerId, toVectorLiteral(vec), Number(k) > 0 ? Number(k) : 40],
    );
    const ids = rows.map((r) => String(r.contact_id));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget single-contact re-embed after a write (fact/note captured).
 * Never blocks or throws. `loadFacts` is an async () => facts[] for the contact.
 */
export function reembedContactSoon(ownerId, contactId, loadFacts) {
  if (!ownerId || contactId == null) return;
  setImmediate(async () => {
    try {
      const facts = loadFacts ? await loadFacts().catch(() => []) : [];
      const { rows } = await query(
        `SELECT id, full_name FROM contacts WHERE id = $1 AND owner_id = $2`,
        // Number(contactId) on a uuid is NaN, which Postgres rejects outright.
        [String(contactId), ownerId],
      );
      const contact = rows && rows[0];
      if (!contact) return;
      await embedContacts(ownerId, [contact], { [String(contactId)]: facts });
    } catch {
      /* fail-open */
    }
  });
}
