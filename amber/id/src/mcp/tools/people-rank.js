import { z } from "zod";

import { rankDidViaTogari } from "../../enrichment/togari-search-rank.js";

export const name = "people_rank";

// Defaults the `did` arg to the API-key-bound owner DID when omitted (see
// createMcpServer). A key-holder can call this without knowing their DID.
export const requiresOwnerDid = true;

export const config = {
  title: "Rank people",
  description:
    "Search and rank a person's contacts by relationship strength + relevance to a free-text query, using the live togari-search PeopleRank engine over their own address book. Great for 'who should I reconnect with to invite to my LA housewarming?'. Returns ranked people with scores, components (warmth/centrality/recency/relevance), and a short reason. `did` defaults to your own account when your API key is bound to a DID. Engine-only: if the engine is unavailable it errors rather than returning weaker local results.",
  inputSchema: {
    did: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The medha-id DID whose network to rank. Optional — defaults to the DID bound to your API key.",
      ),
    query: z
      .string()
      .optional()
      .describe(
        "Free-text intent to rank by, e.g. 'who should I reconnect with to invite to my LA housewarming'. Omit for a general warmth/recency ranking.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max contacts to return (default 15)."),
  },
};

export async function handler({ did, query, limit }) {
  if (!did) return missingDid();
  const r = await rankDidViaTogari(did, { query, limit });
  if (!r.ok) {
    if (r.error === "no_contacts") {
      return ok({
        did,
        query: query || null,
        engine: "togari-search",
        count: 0,
        people: [],
      });
    }
    return errorResult(
      r.error,
      "PeopleRank engine unavailable; not returning local fallback results.",
    );
  }
  const res = r.result || {};
  return ok({
    did,
    engine: "togari-search",
    query: res.query ?? query ?? null,
    count: res.count ?? (res.people || []).length,
    people: res.people || [],
    answer: res.answer ?? null,
  });
}

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(code, message) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
  };
}

function missingDid() {
  return errorResult(
    "missing_did",
    "No `did` was provided and your API key is not bound to an owner DID. Pass `did`, or map a DID to your key (named-key `did` field or DEFAULT_OWNER_DID).",
  );
}
