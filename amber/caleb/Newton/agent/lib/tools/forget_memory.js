/**
 * forget_memory.js — `forget_memory` agent tool.
 *
 * Lets the user delete things Medha remembers: "forget the Carlo
 * conversation", "wipe what you know about my old job", "don't remember
 * what I said about the budget". Hits medha-id's POST /knowledge/forget-as
 * (service-key auth) which semantically matches the topic inside the
 * caller's per-tenant Pinecone namespace and deletes the matching vectors
 * from both the legacy and DID namespaces.
 *
 * Never asks the user to confirm — it deletes and reports what was removed
 * in one short line. Narrow the blast radius with the dimension / kind /
 * before_date filters when the user is specific.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const FORGET_TIMEOUT_MS = 8000;
const DEFAULT_MAX_MATCHES = 25;

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function callForgetAs(payload) {
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/forget-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FORGET_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export async function executeForgetMemoryTool(toolName, input = {}, ctx = {}) {
  if (toolName !== "forget_memory") {
    return { error: `Unknown memory tool: ${toolName}` };
  }

  const did = tenantDidOf(ctx.tenant || null);
  if (!did) {
    return {
      error:
        "forget_memory requires a resolved tenant (privyDid). Inbound " +
        "likely lacked a recognized loopSenderId.",
    };
  }

  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  const ids = Array.isArray(input.ids) ? input.ids : undefined;
  if (!topic && !ids?.length) {
    return {
      error:
        "Provide `topic` (a phrase describing what to forget) or explicit `ids`.",
    };
  }

  if (!configured()) {
    return {
      error: "forget_memory unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  const payload = {
    target_did: did,
    max_matches: DEFAULT_MAX_MATCHES,
  };
  if (topic) payload.text = topic;
  if (ids?.length) payload.ids = ids;
  if (input.dimension) payload.dimension = input.dimension;
  if (input.kind) payload.kind = input.kind;
  if (input.before_date) payload.before_date = input.before_date;

  let result;
  try {
    result = await callForgetAs(payload);
  } catch (err) {
    return {
      error: "forget_memory call failed",
      message: err?.message || String(err),
    };
  }

  if (!result.ok) {
    // 412 = no cNFT / namespace yet; 404 = unknown target. Treat as
    // "nothing to forget" rather than a hard error the agent must surface.
    if (result.status === 404 || result.status === 412) {
      return {
        ok: true,
        deleted: 0,
        summary: "Nothing on file to forget for this topic yet.",
      };
    }
    return {
      error: `forget_memory returned ${result.status}`,
      message:
        typeof result.data?.error === "string"
          ? result.data.error
          : "unexpected response",
    };
  }

  const data = result.data || {};
  const deleted =
    typeof data.deleted === "number" ? data.deleted : (data.deleted ?? 0);

  let summary;
  if (data.mode === "filter") {
    summary = `Deleted matching memories by filter (${JSON.stringify(data.filter || {})}).`;
  } else if (typeof deleted === "number" && deleted > 0) {
    const scope = topic ? ` about "${topic}"` : "";
    summary = `Forgot ${deleted} ${deleted === 1 ? "memory" : "memories"}${scope}.`;
  } else {
    summary = topic
      ? `Nothing matching "${topic}" was on file, so there was nothing to forget.`
      : "Nothing matched, so there was nothing to forget.";
  }

  return {
    ok: true,
    deleted,
    mode: data.mode || null,
    summary,
  };
}

export const FORGET_MEMORY_TOOLS = [
  {
    name: "forget_memory",
    description:
      "Delete things Medha remembers about the user from their private " +
      "knowledge base. Call this whenever the user says 'forget X', " +
      "'don't remember Y', 'wipe what you know about Z', 'delete that', or " +
      "asks you to erase a topic, conversation, or fact. It semantically " +
      "matches the topic in the user's own Pinecone namespace and removes " +
      "the matching vectors. Do NOT ask the user to confirm first — just " +
      "delete and report what was removed in one short line. Use the " +
      "dimension / kind / before_date filters to narrow the deletion when " +
      "the user is specific (e.g. 'forget my financial notes from before March').",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Natural-language description of what to forget. E.g. 'the " +
            "Carlo conversation', 'my old apartment address', 'what I said " +
            "about the Q3 budget'. Be as specific as the user was so the " +
            "semantic match stays narrow.",
        },
        dimension: {
          type: "string",
          description:
            "Optional health dimension to limit the deletion to one of: " +
            "spiritual, emotional, physical, financial, intellectual, social.",
        },
        kind: {
          type: "string",
          description:
            "Optional memory kind filter, e.g. 'conversation', " +
            "'file_content', 'generated_image', 'daily_highlight'.",
        },
        before_date: {
          type: "string",
          description:
            "Optional ISO date (e.g. '2026-03-01T00:00:00.000Z'). Only " +
            "forget matching memories authored before this instant.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional explicit vector ids to delete. Usually omit — pass " +
            "`topic` and let the semantic match find them.",
        },
      },
    },
  },
];
