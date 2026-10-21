/**
 * POST /query — top-K semantic search inside a tenant's namespace.
 *
 * Body: { did, queryText, topK?, filter?, scope?, weights?, kind? }
 *
 *   scope = 'private' (default) → reads tenant-<did>
 *   scope = 'shared'            → reads share-<did>
 *
 * The caller supplies the query TEXT, not a vector — the service embeds
 * it. Passing a pre-embedded vector is deliberately not supported so a
 * misconfigured client cannot smuggle bad vectors across the boundary.
 */

import { embed } from "../lib/embed.js";
import {
  query as pineconeQuery,
  queryWeighted,
} from "../lib/pinecone.js";

export async function queryRoute(app) {
  app.post("/query", async (req, reply) => {
    const {
      did,
      queryText,
      topK = 24,
      filter,
      scope = "private",
      weights = null,
      trustExponent = 1.0,
      kind,
    } = req.body || {};

    if (!did || typeof did !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "did is required" });
    }
    if (!queryText || typeof queryText !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "queryText is required" });
    }
    if (scope !== "private" && scope !== "shared") {
      return reply.code(400).send({
        error: "invalid_scope",
        message: "scope must be 'private' or 'shared'",
      });
    }

    const vector = await embed(queryText);

    // Fold kind into filter if the caller supplied one. Pinecone filters
    // are ANDs of the top-level keys, so this is a strict narrowing.
    const finalFilter =
      kind && !filter
        ? { kind: { $eq: kind } }
        : kind && filter
          ? { $and: [{ kind: { $eq: kind } }, filter] }
          : filter;

    const matches = weights
      ? await queryWeighted(did, vector, {
          topK,
          filter: finalFilter,
          scope,
          weights,
          trustExponent,
        })
      : await pineconeQuery(did, vector, { topK, filter: finalFilter, scope });

    return reply.send({ matches, scope, topK });
  });
}
