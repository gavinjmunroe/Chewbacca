/**
 * Pipeline tools: investor, event (Rytual 3-events), multi-thread relationship.
 *
 * These tools wrap the /v1/pipelines/* endpoints in amber-id. Sagar's prompts
 * that this unblocks:
 *
 *   "partnerships in my head until I can split them into customer and investor
 *    pipelines respectively"
 *   "while we have a separate pipeline for a sales contract with clay/bma, we
 *    need to think about an investor relationship that creatively unlocks this
 *    nuance [re Carlo / IRA / BBB tax credits]"
 *   "please track that we are building an enterprise partnership with
 *    Perplexity, and the main contact is Alex Tsai"
 *
 * Tools exposed to Claude:
 *   track_investor      — create/update investor record
 *   list_investors      — list, optionally filter by stage
 *   track_event         — create/update an event (vipassana, lightning-in-a-bottle, ...)
 *   track_relationship  — create/update a multi-thread relationship
 *   find_relationship   — look up a person across all their threads
 *
 * Auth: service x-api-key + x-amber-phone (no Privy JWT needed in the
 * agent backend). Tenant phone is sourced from ctx.tenant.phoneNumber.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Pipelines", [
  "Track investor relationships (track_investor, list_investors)",
  "Track Rytual events: vipassana, everything-night, lightning-in-a-bottle (track_event)",
  "Model multi-thread relationships — one person, multiple pipelines (track_relationship, find_relationship)",
]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantPhone(tenant) {
  return tenant?.phoneNumber || tenant?.phone || null;
}

function notConfiguredError() {
  return {
    error: "amber_id_not_configured",
    message:
      "amber-id is not configured for this environment (AMBER_ID_API_URL / AMBER_ID_API_KEY missing). Cannot persist pipeline objects.",
  };
}

function noPhoneError() {
  return {
    error: "tenant_phone_missing",
    message:
      "Tenant phoneNumber is required to call amber-id /v1/pipelines/* but was not present on the resolved tenant.",
  };
}

async function callAmberId(method, path, { phone, body, query } = {}) {
  const url = new URL(`${AMBER_ID_API_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const headers = {
    "x-api-key": AMBER_ID_API_KEY,
    "x-amber-phone": phone,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response: pass back raw text in the error
  }
  if (!res.ok) {
    return {
      error: json?.error || "amber_id_error",
      message: json?.message || text.slice(0, 400),
      status: res.status,
    };
  }
  return json;
}

export const PIPELINE_TOOLS = [
  {
    name: "track_investor",
    description:
      "Record or update an investor relationship in Sagar's investor pipeline. Use whenever the user names a person or fund they are talking to about funding, partnership stakes, or strategic capital. Stage tracks where the conversation is in the funnel.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Investor name — person OR firm (e.g. 'Jared Jamin', 'Sequoia').",
        },
        stage: {
          type: "string",
          enum: [
            "lead",
            "intro",
            "in_discussion",
            "term_sheet",
            "closed",
            "passed",
          ],
          description: "Where this investor sits in the funnel right now.",
        },
        contact_email: { type: "string" },
        contact_phone: { type: "string" },
        thesis_fit_note: {
          type: "string",
          description:
            "Short note on why this investor fits the thesis (e.g. 'Rytual seed, health + community angle').",
        },
        last_touch_at: {
          type: "string",
          description: "ISO 8601 timestamp of the last meaningful interaction.",
        },
      },
      required: ["name", "stage"],
    },
  },
  {
    name: "list_investors",
    description:
      "List investor records from Sagar's pipeline. Optionally filter by stage.",
    input_schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: [
            "lead",
            "intro",
            "in_discussion",
            "term_sheet",
            "closed",
            "passed",
          ],
        },
        limit: { type: "integer", description: "Max results (default 100)" },
      },
    },
  },
  {
    name: "track_event",
    description:
      "Record or update an event in the Rytual 3-events framework. Use for vipassana retreats, lightning-in-a-bottle, everything-night, raves, or custom community events. Tag the dimension (social/spiritual/emotional/physical/financial/intellectual) so the event lands on the right six-dimension surface.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "vipassana",
            "everything-night",
            "lightning-in-a-bottle",
            "rave",
            "custom",
          ],
        },
        date_start: {
          type: "string",
          description: "ISO 8601 date or datetime.",
        },
        date_end: { type: "string" },
        location: { type: "string" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Contact names or IDs.",
        },
        dimension: {
          type: "string",
          enum: [
            "social",
            "spiritual",
            "emotional",
            "physical",
            "financial",
            "intellectual",
          ],
        },
        notes: { type: "string" },
      },
      required: ["name", "type", "dimension"],
    },
  },
  {
    name: "track_relationship",
    description:
      "Create or update a multi-thread relationship — one person, multiple pipelines. The canonical case: Carlo is both a partner (Clay sales contract) AND an investor (IRA/BBB tax-credit unlock). Use this when one human appears in two pipelines so we don't end up with disconnected records.",
    input_schema: {
      type: "object",
      properties: {
        person_name: { type: "string" },
        contact_email: { type: "string" },
        threads: {
          type: "array",
          description:
            "List of pipeline threads this person sits in. Each thread = one pipeline plus context.",
          items: {
            type: "object",
            properties: {
              pipeline: {
                type: "string",
                enum: [
                  "investor",
                  "customer",
                  "partner",
                  "friend",
                  "mentor",
                  "advisor",
                ],
              },
              context: { type: "string" },
              status: { type: "string" },
              last_event_at: { type: "string" },
            },
            required: ["pipeline"],
          },
        },
      },
      required: ["person_name"],
    },
  },
  {
    name: "find_relationship",
    description:
      "Look up a person across all their pipeline threads. Returns the relationship record including every thread they appear in (investor, partner, customer, etc.). Use when the user asks 'all the ways I know X' or 'what's my history with X'.",
    input_schema: {
      type: "object",
      properties: {
        person_name: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["person_name"],
    },
  },
];

export const PIPELINE_TOOL_NAMES = new Set(PIPELINE_TOOLS.map((t) => t.name));

export async function executePipelineTool(toolName, input, ctx = {}) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();

  switch (toolName) {
    case "track_investor": {
      return callAmberId("POST", "/v1/pipelines/investor", {
        phone,
        body: {
          name: input.name,
          stage: input.stage,
          contact_email: input.contact_email,
          contact_phone: input.contact_phone,
          thesis_fit_note: input.thesis_fit_note,
          last_touch_at: input.last_touch_at,
        },
      });
    }
    case "list_investors": {
      return callAmberId("GET", "/v1/pipelines/investor", {
        phone,
        query: { stage: input.stage, limit: input.limit },
      });
    }
    case "track_event": {
      return callAmberId("POST", "/v1/pipelines/event", {
        phone,
        body: {
          name: input.name,
          type: input.type,
          date_start: input.date_start,
          date_end: input.date_end,
          location: input.location,
          attendees: input.attendees || [],
          dimension: input.dimension,
          notes: input.notes,
        },
      });
    }
    case "track_relationship": {
      return callAmberId("POST", "/v1/pipelines/relationship", {
        phone,
        body: {
          person_name: input.person_name,
          contact_email: input.contact_email,
          threads: input.threads || [],
        },
      });
    }
    case "find_relationship": {
      return callAmberId("GET", "/v1/pipelines/relationship", {
        phone,
        query: { person_name: input.person_name, limit: input.limit },
      });
    }
    default:
      return {
        error: "unknown_pipeline_tool",
        message: `Tool "${toolName}" is not handled by tools/pipelines.js`,
      };
  }
}
