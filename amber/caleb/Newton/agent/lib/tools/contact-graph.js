/**
 * contact-graph.js — `contact_graph` agent tool (Tab 33).
 *
 * Reads the contact-edge graph amber-id's daily discovery job builds
 * (jobs/contact-edges.js): undirected edges between the user's OWN contacts,
 * derived from co-mentions, shared calendar events, and shared companies.
 * Answers RELATIONAL questions a single-person lookup can't:
 *
 *   - "who do Sagar and Carlo both know?"            (mutual)
 *   - "intro path from me to a Stripe engineer"      (intro_path)
 *   - "show me Carlo's neighborhood in my graph"     (neighborhood)
 *
 * Hits amber-id's /knowledge/graph-as with the tenant's DID. Everything
 * returned is the user's own first-party graph, not the public web.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const DEFAULT_LIMIT = 20;
const DEFAULT_HOPS = 3;
const QUERY_TIMEOUT_MS = 9000;

const VALID_INTENTS = new Set(["mutual", "intro_path", "neighborhood"]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function callAmberId(body) {
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/graph-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 404) return { ok: true, empty: true };
    const errBody = await res.text().catch(() => "");
    console.warn(`[contact_graph] ${res.status}: ${errBody.slice(0, 200)}`);
    return { ok: false, status: res.status };
  }
  return (await res.json().catch(() => null)) || { ok: false };
}

function fmt(n, places = 2) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}

function summarizeNeighborhood(data, label) {
  const neighbors = Array.isArray(data?.neighbors) ? data.neighbors : [];
  if (!neighbors.length) {
    return (
      `No graph connections recorded yet for ${label}. Edges accrue daily as ` +
      `people co-occur in your conversations, calendar, and notes.`
    );
  }
  const lines = neighbors.map(
    (n, i) =>
      `${i + 1}. ${n.name || n.id} (${n.edge_type || "linked"}, strength ${fmt(n.edge_strength)}, ${n.evidence_count ?? 0} touchpoints)`,
  );
  return `${label}'s closest connections:\n${lines.join("\n")}`;
}

function summarizeMutual(data, labelA, labelB) {
  const mutuals = Array.isArray(data?.mutuals) ? data.mutuals : [];
  if (!mutuals.length) {
    return `No mutual connections found between ${labelA} and ${labelB} yet.`;
  }
  const lines = mutuals.map(
    (m, i) =>
      `${i + 1}. ${m.name || m.id} (combined strength ${fmt(m.combined_strength)})`,
  );
  return `Mutual connections between ${labelA} and ${labelB}:\n${lines.join("\n")}`;
}

function summarizeIntroPath(data, labelA, labelB) {
  if (!data?.found || !Array.isArray(data?.path) || data.path.length === 0) {
    return (
      `No introduction path found from ${labelA} to ${labelB} within the ` +
      `graph yet. As more edges accrue a path may open up.`
    );
  }
  const chain = data.path.map((p) => p.name || p.id).join(" -> ");
  return `Intro path (${data.hops} hop${data.hops === 1 ? "" : "s"}) from ${labelA} to ${labelB}:\n${chain}`;
}

export async function executeContactGraphTool(toolName, input = {}, ctx = {}) {
  if (toolName !== "contact_graph") {
    return { error: `Unknown contact-graph tool: ${toolName}` };
  }

  const did = tenantDidOf(ctx.tenant || null);
  if (!did) {
    return {
      error:
        "contact_graph requires a resolved tenant (privyDid). Inbound likely " +
        "lacked a recognized loopSenderId.",
    };
  }
  if (typeof did === "string" && did.startsWith("did:expert:")) {
    return {
      ok: true,
      intent: input.intent,
      summary: "No relationship graph for synthetic expert tenants.",
    };
  }

  const intent = typeof input.intent === "string" ? input.intent : "";
  if (!VALID_INTENTS.has(intent)) {
    return { error: `intent must be one of ${[...VALID_INTENTS].join(", ")}` };
  }
  if (!input.contact_a) {
    return { error: "contact_graph needs contact_a (a contact name)" };
  }
  if ((intent === "mutual" || intent === "intro_path") && !input.contact_b) {
    return { error: `intent=${intent} needs contact_b as well` };
  }
  if (!configured()) {
    return {
      error: "contact_graph unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  // amber-id's /knowledge/graph-as uses `query` for the operation and resolves
  // contact NAMES to ids server-side via the edge endpoints.
  const params = {
    contact_name: String(input.contact_a),
    limit: DEFAULT_LIMIT,
  };
  if (input.contact_b) params.contact_name_b = String(input.contact_b);
  if (intent === "intro_path") {
    params.hops =
      Number(input.hops) > 0 ? Math.min(Number(input.hops), 5) : DEFAULT_HOPS;
  }

  let result;
  try {
    result = await callAmberId({ target_did: did, query: intent, params });
  } catch (err) {
    return {
      error: "contact_graph call failed",
      message: err?.message || String(err),
    };
  }

  const labelA = String(input.contact_a);
  const labelB = input.contact_b ? String(input.contact_b) : "";
  let summary;
  if (intent === "neighborhood")
    summary = summarizeNeighborhood(result, labelA);
  else if (intent === "mutual")
    summary = summarizeMutual(result, labelA, labelB);
  else summary = summarizeIntroPath(result, labelA, labelB);

  return { ok: true, intent, result, summary };
}

export const CONTACT_GRAPH_TOOLS = [
  {
    name: "contact_graph",
    description:
      "Walk the user's OWN contact graph: the edges BETWEEN the people they " +
      "know, built daily from co-mentions, shared calendar events, and shared " +
      "companies. Reach for it for RELATIONAL questions across two or more " +
      "people, not a single-person lookup: 'who do Sagar and Carlo both know', " +
      "'mutual connections between X and Y', 'intro path from me to someone at " +
      "Stripe', 'who in my network has worked with both X and Y', 'show me " +
      "Carlo's neighborhood / who Carlo is connected to'. For a plain 'who do I " +
      "know' lookup use search_contacts; for whether ONE relationship is warming " +
      "or cooling use relationship_trajectory. Everything returned is the user's " +
      "first-party graph, not the public web.",
    input_schema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["mutual", "intro_path", "neighborhood"],
          description:
            "mutual = people connected to BOTH contact_a and contact_b. " +
            "intro_path = a chain of warm intros from contact_a to contact_b. " +
            "neighborhood = the contacts directly connected to contact_a.",
        },
        contact_a: {
          type: "string",
          description:
            "Display name of the first / anchor contact. For an intro path " +
            "from the user, use the user's own name as contact_a.",
        },
        contact_b: {
          type: "string",
          description:
            "Display name of the second contact. Required for mutual and " +
            "intro_path; ignored for neighborhood.",
        },
        hops: {
          type: "integer",
          description:
            "Max hops to search for an intro path. Default 3, max 5.",
          minimum: 1,
          maximum: 5,
        },
      },
      required: ["intent", "contact_a"],
    },
  },
];
