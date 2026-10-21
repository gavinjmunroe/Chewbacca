/**
 * partnerships.js — agent-side wrappers for amber-id's /v1/partnerships/*
 * routes plus the /internal contact-context surface.
 *
 * Companion to T17 (medha-id partnerships routes shipped in this same
 * branch). Where pipelines.js handles funnel-shaped data (investor stage,
 * relationship threads) and personal-life.js handles brand decisions and
 * teammate pursuits, this module handles LONG-FORM evolving partnerships
 * that accumulate history over time.
 *
 * Sagar's canonical prompts this unblocks:
 *
 *   "please track that we are building an enterprise partnership with
 *    Perplexity, and the main contact is Alex Tsai"
 *   "what do you know about our Perplexity partnership?"
 *   "tell me what Carlo proposed"
 *   "today I learned that Shirley is shipping the new BMA landing page,
 *    update her file"
 *
 * Tools exposed to Claude:
 *   track_partnership          — create or upsert a partnership record
 *   append_partnership_note    — add a timestamped history note
 *   recall_partnership         — fetch the full partnership by name
 *   list_partnerships          — list, optionally filter by kind / status
 *   update_contact_context     — append or replace a contact's longform
 *                                context (what Medha knows about them)
 *
 * Auth: service x-api-key + x-amber-phone (per the same pattern as
 * pipelines.js and personal-life.js). For update_contact_context the
 * route is /internal/users/:did/contacts/:id/context, which uses the
 * tenant's privy DID; we resolve that via the existing tenant context
 * passed in ctx.tenant.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Partnerships", [
  "Track long-form partnerships with append-only history (track_partnership, append_partnership_note)",
  "Recall a named partnership and its full timeline (recall_partnership, list_partnerships)",
  "Update what Medha knows about a contact (update_contact_context)",
]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantPhone(tenant) {
  return tenant?.phoneNumber || tenant?.phone || null;
}

function tenantDid(tenant) {
  return (
    tenant?.privyUserId || tenant?.privyDid || tenant?.did || tenant?.id || null
  );
}

function notConfiguredError() {
  return {
    error: "amber_id_not_configured",
    message:
      "amber-id is not configured for this environment (AMBER_ID_API_URL / AMBER_ID_API_KEY missing). Cannot persist partnerships.",
  };
}

function noPhoneError() {
  return {
    error: "tenant_phone_missing",
    message:
      "Tenant phoneNumber is required to call amber-id /v1/partnerships/* but was not present on the resolved tenant.",
  };
}

function noDidError() {
  return {
    error: "tenant_did_missing",
    message:
      "Tenant DID is required to call /internal/users/:did/contacts/* but was not present on the resolved tenant.",
  };
}

async function callAmberId(method, path, { phone, body, query, useDid } = {}) {
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
  };
  // /internal/* routes don't require x-amber-phone (they take the DID
  // in the path). /v1/* routes do.
  if (!useDid && phone) {
    headers["x-amber-phone"] = phone;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      error: "amber_id_network_error",
      message: err?.message || String(err),
    };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON: surface the raw text in the error message
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

export const PARTNERSHIP_TOOLS = [
  {
    name: "track_partnership",
    description:
      "Create or update a long-form partnership record. Use whenever the user tells Medha to track or note a relationship that EVOLVES OVER TIME with rich context: an enterprise partnership (Perplexity, Anthropic), a federal-tax-credit thread (Carlo / Cory), an advisor (Karthik), a vendor (Loop). Different from track_investor (funnel) and track_relationship (multi-thread) — partnerships hold a long-form pitch, a list of primary contacts with their roles, and a list of next-actions that survive across weeks.",
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description:
            "Partnership name — short and stable. e.g. 'Perplexity', 'Cory Reeder / Carlo — federal tax credits', 'Loop'. The same name is the lookup key for recall_partnership and append_partnership_note.",
        },
        kind: {
          type: "string",
          enum: ["investor", "advisor", "partner", "vendor", "other"],
          description: "Category. Default 'partner' when omitted.",
        },
        status: {
          type: "string",
          enum: ["exploring", "active", "paused", "closed"],
          description: "Current state. Default 'exploring' when omitted.",
        },
        org_name: {
          type: "string",
          description: "Organization name when distinct from `name`.",
        },
        pitch: {
          type: "string",
          description:
            "Long-form pitch / context. What is this partnership about? What's the substance? Capture the WHY in the user's own words when possible.",
        },
        primary_contacts: {
          type: "array",
          description:
            "People to talk to. Each entry: { name, role?, email? }.",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              email: { type: "string" },
            },
          },
        },
        next_actions: {
          type: "array",
          description:
            "Open actions to take on this partnership. Each entry: { description, due_date? }.",
          items: {
            type: "object",
            required: ["description"],
            properties: {
              description: { type: "string" },
              due_date: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "append_partnership_note",
    description:
      "Append a single timestamped note to a partnership's history. Use when the user shares an update about an existing partnership ('Alex Tsai responded today', 'Carlo sent the term sheet'). The note is also embedded into Pinecone as a standalone vector so 'what did Carlo propose at the IRA meeting?' can resolve to the specific note. Looks up the partnership by name.",
    input_schema: {
      type: "object",
      required: ["name", "note"],
      properties: {
        name: {
          type: "string",
          description: "Partnership name — must match an existing record.",
        },
        note: {
          type: "string",
          description: "The note content. Up to 8000 chars.",
        },
        source: {
          type: "string",
          description:
            "Optional provenance, e.g. 'slack-thread-2026-05-26' or 'in-person 5/27'.",
        },
      },
    },
  },
  {
    name: "recall_partnership",
    description:
      "Fetch a partnership by name. Returns the full record: pitch, status, primary contacts, full history of notes, and open next-actions. Use FIRST whenever the user asks about a named partnership ('what do you know about Perplexity?', 'tell me what Carlo proposed', 'where are we with Karthik').",
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Partnership name to look up (case-insensitive).",
        },
      },
    },
  },
  {
    name: "list_partnerships",
    description:
      "List all partnerships, newest-updated first. Optionally filter by kind or status. Use when the user asks broad questions ('what partnerships am I tracking?', 'show me my active advisor relationships').",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["investor", "advisor", "partner", "vendor", "other"],
        },
        status: {
          type: "string",
          enum: ["exploring", "active", "paused", "closed"],
        },
        limit: { type: "integer", description: "Max results (default 100)." },
      },
    },
  },
  {
    name: "update_contact_context",
    description:
      "Append or replace the longform `context` field on a single contact in the user's address book. Use when the user volunteers a fact about a specific person ('Shirley shipped the new landing page', 'Alinna is writing a lot of poetry right now', 'Emily moved to Brooklyn'). The context is embedded into the contact's Pinecone vector so semantic search picks them up by the new facts. Looks up the contact by name (first name OR full name, case-insensitive).",
    input_schema: {
      type: "object",
      required: ["contact_name", "text"],
      properties: {
        contact_name: {
          type: "string",
          description:
            "Contact name to look up — first name ('Shirley') or full name ('Shirley Park').",
        },
        text: {
          type: "string",
          description:
            "The context to add or replace. Plain prose, up to 32000 chars.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description:
            "append (default) stamps an ISO timestamp and appends to existing context. replace overwrites.",
        },
      },
    },
  },
  {
    name: "set_relationship",
    description:
      "Record STRUCTURED relationship facts about a person in the user's relationship graph (PRD §6): emotional tone, trust, closeness, whether they energize or drain, current tension, boundaries, what the user appreciates/avoids, the next relational move, and privacy. Use when the user reveals how they FEEL about someone or the dynamic between them ('my sister keeps making me feel guilty' → tension + energyType:draining; 'Ava is so steady for me' → energyType:safe, closeness high). Reflect the user's own words back; do not invent. Send only the fields you learned. Looks up the contact by name.",
    input_schema: {
      type: "object",
      required: ["contact_name"],
      properties: {
        contact_name: {
          type: "string",
          description: "Contact name (first or full).",
        },
        category: {
          type: "string",
          description:
            "family | friend | romantic | work | community | acquaintance",
        },
        emotionalTone: {
          type: "string",
          description:
            "Short tone in the user's words: warm, tense, complicated.",
        },
        trustLevel: {
          type: "number",
          description: "0 to 1, how much the user trusts them.",
        },
        closeness: {
          type: "number",
          description: "0 to 1, how close the user feels.",
        },
        energyType: {
          type: "string",
          description:
            "energizing | draining | complicated | safe | unstable | aspirational | distant",
        },
        tension: {
          type: "string",
          description: "Current unresolved tension, if any.",
        },
        boundaries: {
          type: "string",
          description: "Known boundaries with this person.",
        },
        appreciates: {
          type: "string",
          description: "What the user values about them.",
        },
        avoids: {
          type: "string",
          description: "What the user fears or avoids with them.",
        },
        nextAction: {
          type: "string",
          description:
            "Next recommended relational move (check in, set a boundary, repair).",
        },
        privacyLevel: {
          type: "string",
          enum: ["normal", "private", "sensitive"],
          description: "How private this relationship context is.",
        },
        shareableWithTogari: {
          type: "boolean",
          description:
            "Whether this person's context may ever cross to Togari. Default false for anything personal.",
        },
      },
    },
  },
  {
    name: "recall_contact",
    description:
      "Return everything Medha knows about ONE person from the relationship graph: their structured relationship fields (tone, trust, closeness, energy, tension, boundaries, next action) plus the longform context notes. Use to answer 'what do you know about my relationship with X?'. Looks up by name.",
    input_schema: {
      type: "object",
      required: ["contact_name"],
      properties: {
        contact_name: {
          type: "string",
          description: "Contact name (first or full).",
        },
      },
    },
  },
];

export const PARTNERSHIP_TOOL_NAMES = new Set(
  PARTNERSHIP_TOOLS.map((t) => t.name),
);

export async function executePartnershipTool(toolName, input, ctx = {}) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  switch (toolName) {
    case "track_partnership": {
      if (!phone) return noPhoneError();
      return callAmberId("POST", "/v1/partnerships", {
        phone,
        body: {
          name: input.name,
          kind: input.kind,
          status: input.status,
          org_name: input.org_name,
          pitch: input.pitch,
          primary_contacts: input.primary_contacts || [],
          next_actions: input.next_actions || [],
        },
      });
    }
    case "append_partnership_note": {
      if (!phone) return noPhoneError();
      const found = await callAmberId("GET", "/v1/partnerships/by-name", {
        phone,
        query: { name: input.name },
      });
      if (found?.error) return found;
      const id = found?.partnership?.id;
      if (!id) {
        return {
          error: "partnership_not_found",
          message: `No partnership named "${input.name}". Call track_partnership first to create it.`,
        };
      }
      return callAmberId(
        "POST",
        `/v1/partnerships/${encodeURIComponent(id)}/notes`,
        {
          phone,
          body: { note: input.note, source: input.source },
        },
      );
    }
    case "recall_partnership": {
      if (!phone) return noPhoneError();
      return callAmberId("GET", "/v1/partnerships/by-name", {
        phone,
        query: { name: input.name },
      });
    }
    case "list_partnerships": {
      if (!phone) return noPhoneError();
      return callAmberId("GET", "/v1/partnerships", {
        phone,
        query: {
          kind: input.kind,
          status: input.status,
          limit: input.limit,
        },
      });
    }
    case "update_contact_context": {
      const did = tenantDid(ctx.tenant);
      if (!did) return noDidError();
      const lookup = await callAmberId(
        "GET",
        `/internal/users/${encodeURIComponent(did)}/contacts/by-name`,
        { phone, query: { name: input.contact_name }, useDid: true },
      );
      if (lookup?.error) return lookup;
      const contactId = lookup?.contact?.id;
      if (!contactId) {
        return {
          error: "contact_not_found",
          message: `No contact named "${input.contact_name}" in the address book. Add the contact first.`,
          matches: lookup?.matches || [],
        };
      }
      const written = await callAmberId(
        "PATCH",
        `/internal/users/${encodeURIComponent(did)}/contacts/${encodeURIComponent(contactId)}/context`,
        {
          phone,
          body: { text: input.text, mode: input.mode || "append" },
          useDid: true,
        },
      );
      if (written?.error) return written;
      return { ok: true, contact: written.contact };
    }
    case "set_relationship": {
      const did = tenantDid(ctx.tenant);
      if (!did) return noDidError();
      const lookup = await callAmberId(
        "GET",
        `/internal/users/${encodeURIComponent(did)}/contacts/by-name`,
        { phone, query: { name: input.contact_name }, useDid: true },
      );
      if (lookup?.error) return lookup;
      const contactId = lookup?.contact?.id;
      if (!contactId) {
        return {
          error: "contact_not_found",
          message: `No contact named "${input.contact_name}" in the address book. Add the contact first.`,
          matches: lookup?.matches || [],
        };
      }
      // Forward only the structured relationship fields (drop contact_name).
      const fields = {};
      for (const k of [
        "category",
        "emotionalTone",
        "trustLevel",
        "closeness",
        "energyType",
        "tension",
        "boundaries",
        "appreciates",
        "avoids",
        "nextAction",
        "privacyLevel",
        "shareableWithTogari",
      ]) {
        if (input[k] !== undefined) fields[k] = input[k];
      }
      const written = await callAmberId(
        "PATCH",
        `/internal/users/${encodeURIComponent(did)}/contacts/${encodeURIComponent(contactId)}/relationship`,
        { phone, body: fields, useDid: true },
      );
      if (written?.error) return written;
      return { ok: true, contact: written.contact };
    }
    case "recall_contact": {
      const did = tenantDid(ctx.tenant);
      if (!did) return noDidError();
      const lookup = await callAmberId(
        "GET",
        `/internal/users/${encodeURIComponent(did)}/contacts/by-name`,
        { phone, query: { name: input.contact_name }, useDid: true },
      );
      if (lookup?.error) return lookup;
      if (!lookup?.contact?.id) {
        return {
          error: "contact_not_found",
          message: `No contact named "${input.contact_name}" on file.`,
          matches: lookup?.matches || [],
        };
      }
      const c = lookup.contact;
      return {
        ok: true,
        person: {
          name: c.name,
          company: c.company ?? null,
          title: c.title ?? null,
          context: c.context ?? null,
          relationship: c.relationship ?? null,
        },
      };
    }
    default:
      return {
        error: "unknown_partnership_tool",
        message: `Tool "${toolName}" is not handled by tools/partnerships.js`,
      };
  }
}
