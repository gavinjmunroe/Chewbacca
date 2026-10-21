/**
 * memory_snapshot.js — `memory_snapshot` agent tool.
 *
 * Answers "what did you know about me as of last month?" / "show me what
 * you knew about me in March". Hits medha-id's POST /knowledge/snapshot-as
 * (service-key auth) which returns the chunks the caller's per-tenant
 * Pinecone namespace held at or before a cutoff date, biased toward the
 * consolidated daily-highlight digests so the answer reads as a summary
 * rather than a wall of raw chunks.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const SNAPSHOT_TIMEOUT_MS = 8000;
const DEFAULT_TOP_K = 25;
const MAX_TOP_K = 100;

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function callSnapshotAs(payload) {
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/snapshot-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function renderMatch(match, index) {
  const meta = match?.metadata || {};
  const when = meta.created_at || meta.ingested_at || "unknown date";
  const kind = meta.kind || "memory";
  const body = String(meta.text || "").slice(0, 500);
  return `${index + 1}. [${kind} · ${when}] ${body}`;
}

export async function executeMemorySnapshotTool(
  toolName,
  input = {},
  ctx = {},
) {
  if (toolName !== "memory_snapshot") {
    return { error: `Unknown memory tool: ${toolName}` };
  }

  const did = tenantDidOf(ctx.tenant || null);
  if (!did) {
    return {
      error:
        "memory_snapshot requires a resolved tenant (privyDid). Inbound " +
        "likely lacked a recognized loopSenderId.",
    };
  }

  const asOf = typeof input.as_of === "string" ? input.as_of.trim() : "";
  if (!asOf) {
    return {
      error:
        "`as_of` is required — pass the cutoff as an ISO date " +
        "(e.g. '2026-04-01T00:00:00.000Z').",
    };
  }

  if (!configured()) {
    return {
      error: "memory_snapshot unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  let topK = Number(input.top_k || input.topK || DEFAULT_TOP_K);
  if (!Number.isFinite(topK) || topK < 1) topK = DEFAULT_TOP_K;
  if (topK > MAX_TOP_K) topK = MAX_TOP_K;

  const payload = { target_did: did, as_of: asOf, topK };
  if (typeof input.topic === "string" && input.topic.trim()) {
    payload.text = input.topic.trim();
  }
  if (typeof input.kind === "string" && input.kind.trim()) {
    payload.kind = input.kind.trim();
  }

  let result;
  try {
    result = await callSnapshotAs(payload);
  } catch (err) {
    return {
      error: "memory_snapshot call failed",
      message: err?.message || String(err),
    };
  }

  if (!result.ok) {
    if (result.status === 404 || result.status === 412) {
      return {
        ok: true,
        as_of: asOf,
        matches: [],
        summary: "No knowledge base on file for this user yet.",
      };
    }
    return {
      error: `memory_snapshot returned ${result.status}`,
      message:
        typeof result.data?.error === "string"
          ? result.data.error
          : "unexpected response",
    };
  }

  const matches = Array.isArray(result.data?.matches)
    ? result.data.matches
    : [];

  if (matches.length === 0) {
    return {
      ok: true,
      as_of: asOf,
      count: 0,
      matches: [],
      summary: `Nothing was on file as of ${asOf}.`,
    };
  }

  return {
    ok: true,
    as_of: asOf,
    count: matches.length,
    matches: matches.map((m) => ({
      kind: m?.metadata?.kind || null,
      when: m?.metadata?.created_at || m?.metadata?.ingested_at || null,
      dimension: m?.metadata?.health_dimension || null,
      text: m?.metadata?.text || null,
    })),
    summary: matches.map((m, i) => renderMatch(m, i)).join("\n"),
  };
}

export const MEMORY_SNAPSHOT_TOOLS = [
  {
    name: "memory_snapshot",
    description:
      "Show what Medha knew about the user as of a past date. Call this " +
      "when the user asks 'what did you know about me as of <date>?', " +
      "'show me what you knew about me last month', 'what was on file in " +
      "March', or any point-in-time look back at their knowledge base. " +
      "Returns the memories indexed at or before the cutoff, with " +
      "consolidated daily highlights surfaced first. Summarize the result " +
      "as a short recap of that period, not a raw dump.",
    input_schema: {
      type: "object",
      properties: {
        as_of: {
          type: "string",
          description:
            "Required cutoff as an ISO date, e.g. " +
            "'2026-04-01T00:00:00.000Z'. Resolve relative phrases ('last " +
            "month', 'in March') to a concrete ISO date before calling.",
        },
        topic: {
          type: "string",
          description:
            "Optional topic to focus the snapshot on (e.g. 'my health', " +
            "'the Rytual retreat'). Omit for a general 'what did you know " +
            "about me' recap.",
        },
        kind: {
          type: "string",
          description:
            "Optional memory kind filter, e.g. 'daily_highlight', " +
            "'conversation', 'file_content'.",
        },
        top_k: {
          type: "integer",
          description: "How many memories to return. Default 25. Max 100.",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["as_of"],
    },
  },
];
