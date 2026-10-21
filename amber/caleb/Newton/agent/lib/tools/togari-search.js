/**
 * togari-search.js — bridge to amber-organization/togari-search (Python
 * FastAPI service) for community-event group matching (UC3).
 *
 * Distinct from tools/togari.js (which talks to the Togari TypeScript
 * Fastify API for contact CRUD, enrichment, search) and tools/peoplerank.js
 * (which calls in-process Tiwari ranking modules). This module is the
 * narrow bridge to the Python service that handles the heavier semantic-
 * embedding + readiness/harmony scoring work.
 *
 * Configured via TOGARI_SEARCH_URL (e.g. https://togari-search-production.up.railway.app).
 * If unset the tool still appears in the LLM's surface — the call returns
 * a structured 'not configured' error so the user gets the right nudge
 * instead of a silently-missing capability.
 *
 * Tool exposed:
 *   togari_match_community_event  →  group matching across community attendees
 *
 * Why this tool: Rytual / BMA frequently asks "who at this event should I
 * connect with" or "form small groups across these N attendees for a UC3
 * activation." The Python service runs embedding similarity + 6-dimension
 * harmony scoring + readiness banding to answer that without round-tripping
 * the data through the agent's prompt window.
 */

import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_TogariSearch",
  "Match a community-event audience into ranked pairs or groups via togari-search (semantic + readiness + harmony)",
);

const DEFAULT_TIMEOUT_MS = 20_000;

function baseUrl() {
  const u = (process.env.TOGARI_SEARCH_URL || "").trim().replace(/\/+$/, "");
  return u || null;
}

function notConfigured() {
  return {
    error: "togari_search_not_configured",
    message:
      "togari-search is not reachable from this deployment. Set TOGARI_SEARCH_URL on amber-agent to the Python service's https URL (typically https://togari-search-production.up.railway.app).",
  };
}

export const TOGARI_SEARCH_TOOLS = [
  {
    name: "togari_match_community_event",
    description:
      "Match a community-event audience into ranked pairs or small groups via togari-search. Use for 'who at this Rytual event should connect with whom', 'form 3-person dinner groups from these RSVPs', or 'rank attendees by mutual fit for a 1:1 meeting'. The service runs semantic embedding + 6-dimension harmony scoring and returns groups or pairs with confidence bands and rationale lines.",
    input_schema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description:
            "Stable identifier for the event (e.g. 'rytual-vipassana-2026-06', 'lib-edc-night-1'). Used for caching + grouping.",
        },
        attendees: {
          type: "array",
          description:
            "List of attendee objects. Each item should carry whatever profile fields togari-search can score on (id, name, bio, skills, intents, dimension_scores, etc.). Pass through the same shape returned by your contact source.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              bio: { type: "string" },
              dimension_scores: { type: "object" },
            },
          },
        },
        mode: {
          type: "string",
          enum: ["pairs", "groups", "auto"],
          description:
            "Pair people 1:1, form small groups, or let the service decide based on attendee count (default auto).",
        },
        group_size: {
          type: "integer",
          description:
            "Target group size when mode='groups'. Defaults to 3 server-side.",
        },
      },
      required: ["event_id", "attendees"],
    },
  },
];

export const TOGARI_SEARCH_TOOL_NAMES = new Set(
  TOGARI_SEARCH_TOOLS.map((t) => t.name),
);

export async function executeTogariSearchTool(toolName, input) {
  const url = baseUrl();
  if (!url) return notConfigured();

  if (toolName !== "togari_match_community_event") {
    return { error: `Unknown togari-search tool: ${toolName}` };
  }

  const body = {
    event_id: input.event_id,
    attendees: Array.isArray(input.attendees) ? input.attendees : [],
    mode: input.mode || "auto",
    group_size: Number.isFinite(input.group_size)
      ? input.group_size
      : undefined,
  };

  let res;
  try {
    res = await fetch(`${url}/v1/match/community-event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      error: "togari_search_unreachable",
      message: `togari-search at ${url} did not respond: ${err?.message || err}`,
    };
  }

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    return {
      error: "togari_search_error",
      status: res.status,
      message: data?.detail || data?.error || text.slice(0, 400),
    };
  }
  return data || {};
}
