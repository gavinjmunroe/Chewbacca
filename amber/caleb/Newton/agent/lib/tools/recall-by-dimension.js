/**
 * recall-by-dimension.js — `recall_by_dimension` agent tool.
 *
 * Semantic recall over the user's own Pinecone memory, filtered by one or
 * more of the six health dimensions (spiritual, emotional, physical,
 * intellectual, social, financial) and/or content kind (conversation,
 * file_content, generated_image, content_seed, daily_highlight, ...).
 *
 * Hits amber-id's `/knowledge/query-as` with a server-side metadata filter,
 * so the dimension/kind narrowing happens inside Pinecone instead of being
 * post-filtered here. This is the tool to reach for when the user scopes a
 * recall to a part of their life: "what's been on my mind spiritually this
 * month", "show me my financial conversations from Sagar", "what files did
 * I share about the retreat".
 *
 * Everything returned is the user's own data, not the public web.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const DEFAULT_TOP_K = 12;
const MAX_TOP_K = 50;
const QUERY_TIMEOUT_MS = 8000;

// Mirror of amber-id's canonical six-dimension ontology (lib/dimensions.js).
// "*" is the cross-dimension wildcard. Never invent or rename dimensions.
const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);
const VALID_DIMENSIONS = new Set([...DIMENSIONS, "*"]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

/**
 * Coerce a scalar-or-array argument into a clean string array.
 */
function toArray(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function queryAmberIdByDimension({
  targetDid,
  text,
  topK,
  healthDimension,
  kind,
}) {
  // Synthetic expert tenants have no amber-id user row to query.
  if (typeof targetDid === "string" && targetDid.startsWith("did:expert:")) {
    return [];
  }
  const body = { target_did: targetDid, text, topK };
  if (healthDimension.length > 0) body.healthDimension = healthDimension;
  if (kind.length > 0) body.kind = kind;

  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/query-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    const errBody = await res.text().catch(() => "");
    console.warn(
      `[recall_by_dimension] query-as ${res.status}: ${errBody.slice(0, 200)}`,
    );
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.matches) ? data.matches : [];
}

function renderMatch(match, index) {
  const meta = match?.metadata || {};
  const dim = meta.health_dimension || "?";
  const kind = meta.kind || "memory";
  const score =
    typeof match?.score === "number"
      ? ` (score ${match.score.toFixed(2)})`
      : "";
  const when = meta.created_at
    ? ` · ${String(meta.created_at).slice(0, 10)}`
    : "";
  const body = String(meta.text || "").slice(0, 600);
  return `${index + 1}. [${dim}/${kind}]${when}${score}\n   ${body}`;
}

export async function executeRecallByDimensionTool(
  toolName,
  input = {},
  ctx = {},
) {
  if (toolName !== "recall_by_dimension") {
    return { error: `Unknown recall tool: ${toolName}` };
  }

  const tenant = ctx.tenant || null;
  const did = tenantDidOf(tenant);
  if (!did) {
    return {
      error:
        "recall_by_dimension requires a resolved tenant (privyDid). " +
        "Inbound likely lacked a recognized loopSenderId.",
    };
  }

  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { error: "query is required" };
  }

  // Validate dimensions before the network call so the agent gets a precise
  // error instead of a silent empty result on a typo'd dimension.
  const healthDimension = toArray(input.healthDimension ?? input.dimension);
  const bad = healthDimension.filter((d) => !VALID_DIMENSIONS.has(d));
  if (bad.length > 0) {
    return {
      error:
        `invalid healthDimension: ${bad.join(", ")}. ` +
        `Must be one of ${DIMENSIONS.join(", ")} (or "*").`,
    };
  }
  const kind = toArray(input.kind);

  if (!configured()) {
    return {
      error:
        "recall_by_dimension unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  let topK = Number(input.topK || input.top_k || DEFAULT_TOP_K);
  if (!Number.isFinite(topK) || topK < 1) topK = DEFAULT_TOP_K;
  if (topK > MAX_TOP_K) topK = MAX_TOP_K;

  let matches;
  try {
    matches = await queryAmberIdByDimension({
      targetDid: did,
      text: query,
      topK,
      healthDimension,
      kind,
    });
  } catch (err) {
    return {
      error: "recall_by_dimension call failed",
      message: err?.message || String(err),
    };
  }

  if (matches.length === 0) {
    return {
      ok: true,
      query,
      topK,
      healthDimension,
      kind,
      matches: [],
      summary:
        "No matching memories for that dimension/kind. The namespace may " +
        "have nothing tagged that way yet, or the query was too narrow.",
    };
  }

  const lines = matches.map((m, i) => renderMatch(m, i));
  return {
    ok: true,
    query,
    topK,
    healthDimension,
    kind,
    count: matches.length,
    matches: matches.map((m) => ({
      score: m?.score ?? null,
      healthDimension: m?.metadata?.health_dimension || null,
      kind: m?.metadata?.kind || null,
      source: m?.metadata?.source || null,
      createdAt: m?.metadata?.created_at || null,
      text: m?.metadata?.text || null,
    })),
    summary: lines.join("\n"),
  };
}

export const RECALL_BY_DIMENSION_TOOLS = [
  {
    name: "recall_by_dimension",
    description:
      "Semantic search over the user's OWN private memory (conversations, " +
      "files, generated images, content seeds, journal entries, daily " +
      "highlights), filtered by one or more of the six health dimensions " +
      "and/or content kind. Reach for this whenever the user scopes a " +
      "recall to a slice of their life: 'what's been on my mind " +
      "spiritually this month', 'show me my financial conversations', " +
      "'what did I read about intellectually last week', 'find the files I " +
      "shared about the retreat'. The six dimensions are spiritual, " +
      "emotional, physical, intellectual, social, financial. Authoritative " +
      "— this is the user's own data, not the public web. When you have a " +
      "general 'who do I know' people lookup, use search_contacts instead.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of what to recall. Keep the " +
            "semantic intent here; put the dimension/kind narrowing in the " +
            "dedicated fields, not in the query text.",
        },
        healthDimension: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "spiritual",
              "emotional",
              "physical",
              "intellectual",
              "social",
              "financial",
            ],
          },
          description:
            "One or more of the six health dimensions to filter to. Omit to " +
            "search across every dimension. E.g. ['spiritual'] for 'what's " +
            "been on my mind spiritually', ['financial','social'] to span " +
            "two.",
        },
        kind: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional content-kind filter. Common kinds: 'conversation', " +
            "'file_content', 'generated_image', 'image_content', " +
            "'content_seed', 'daily_highlight', 'voice_memo'. Omit to " +
            "search across all kinds.",
        },
        topK: {
          type: "integer",
          description: "How many matches to return. Default 12. Max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["query"],
    },
  },
];
