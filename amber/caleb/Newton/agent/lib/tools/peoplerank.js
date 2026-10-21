/**
 * Togari / Tiwari tools exposed to Amber.
 *
 * Three primitives, all gated by the same TOGARI_PEOPLERANK_URL env var
 * (if togari isn't reachable, these tools disappear from the Amber toolset
 * rather than failing noisily on every call):
 *
 *   peoplerank_list_build  →  rank+discover people from BMA graph + Caleb signals
 *   peoplerank_enrich      →  enrich a single entity (person/company) with profile data
 *   peoplerank_opportunity →  generate outreach sequences for a trigger (intro, follow-up, ask)
 *
 * All three call the local Tiwari ES modules in-process via lazy import so
 * amber-agent can start even if the togari submodule hasn't been fetched
 * (e.g. fresh clone without `git submodule update --init`).
 *
 * amber-id personalization is intentionally disabled on the agent path —
 * Amber authenticates with amber-id via service-auth (x-api-key), not via
 * the user's signed Privy JWT that tiwari-peoplerank's user-scoped boost
 * expects. You still get togari base + Newton boosts, which is the useful
 * part for conversational list-build queries.
 */

import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Peoplerank",
  "Rank and discover people across BMA contacts + Caleb's relationship signals",
);
registerCapability(
  "_tools_Enrich",
  "Enrich a single person or company with profile data from the Tiwari graph",
);
registerCapability(
  "_tools_Opportunity",
  "Generate outreach sequences (intro, follow-up, ask) for a relationship trigger",
);

function isPeoplerankConfigured() {
  return Boolean(
    process.env.TOGARI_PEOPLERANK_URL || process.env.PEOPLERANK_BASE_URL,
  );
}

// Caleb 2026-05-27: PeopleRank must be fully integrated — always exposed
// as a tool, not hidden when an env var is missing. The three primitives
// already use lazy import + per-call try/catch in executePeoplerankTool,
// so a missing URL surfaces as a single "Peoplerank not configured" error
// from the tool call instead of an invisible no-op. The previous env gate
// made the tools disappear entirely, which is what the LLM noticed as
// "I don't have a tool for that."
export const PEOPLERANK_TOOLS = [
  {
    name: "peoplerank_list_build",
    description:
      "Find and rank people matching a natural language query. Searches BMA's contact graph (togari-peoplerank) and re-ranks with Caleb's Newton signals (recent bidirectional communication, 6-dimension health affinity). Use for 'who should I talk to about X', 'find me founders in Y', 'who do I know at Z'. Returns ranked people with score breakdowns and reasons.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language intent, e.g. 'SF healthcare founders I've met' or 'engineers I know at Google'",
        },
        filters: {
          type: "object",
          description:
            "Optional structured filters: { city, tags, vertical, company, title }",
          properties: {
            city: { type: "string" },
            vertical: { type: "string" },
            company: { type: "string" },
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        topK: {
          type: "integer",
          description: "Max results to return (default 20)",
        },
        owner_did: {
          type: "string",
          description:
            "Optional Privy DID of the contact-pool owner. When supplied, the upstream scopes results to that user's pool (BMA team member or external customer). Defaults to the resolved tenant DID when omitted.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "peoplerank_enrich",
    description:
      "Enrich a single person or company with profile data (role, company, location, recent activity, signals). Use when Caleb asks 'who is X' or 'what's X up to these days'. Takes a name/email/phone/domain and returns a structured profile pulled from BMA's graph plus public signals.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "Name, email, phone, or domain to enrich. e.g. 'Sagar Tiwari', 'sagar@bma.vc', '+15550100003', 'bma.vc'",
        },
        kind: {
          type: "string",
          enum: ["person", "company", "auto"],
          description: "Force resolution as person or company (default auto)",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "peoplerank_opportunity",
    description:
      "Generate an outreach opportunity sequence (intro draft, follow-up cadence, concrete ask) given a trigger. Use when Caleb says 'draft an intro email to X', 'what should I say to Y about Z', or 'follow up with the person I met at <event>'. Returns a sequence of suggested touches with channel, draft body, and timing.",
    input_schema: {
      type: "object",
      properties: {
        trigger: {
          type: "string",
          description:
            "What sparked the outreach, in plain English. e.g. 'Met Dan at Lighthouse demo, interested in amber-id', 'Need to follow up with Sarah on the Series A intro'",
        },
        target: {
          type: "string",
          description:
            "Who the outreach is for — name, email, or recognizable handle",
        },
        channel: {
          type: "string",
          enum: ["email", "imessage", "sms", "linkedin", "auto"],
          description: "Preferred channel (default auto)",
        },
      },
      required: ["trigger", "target"],
    },
  },
];

export async function executePeoplerankTool(toolName, input, ctx = {}) {
  if (!isPeoplerankConfigured()) {
    return {
      error: "Peoplerank not configured. Set TOGARI_PEOPLERANK_URL in env.",
    };
  }

  const tenantDid =
    ctx?.tenant?.privyDid || ctx?.tenant?.id || ctx?.tenant?.amberId || null;
  const ownerDid = input?.owner_did || tenantDid || null;

  try {
    if (toolName === "peoplerank_list_build") {
      const { listBuild } =
        await import("../../../../Tiwari/tiwari-peoplerank/index.js");
      const result = await listBuild({
        query: input.query,
        filters: input.filters || {},
        ownerDid,
        options: {
          topK: Number(input.topK) || 20,
          includeNewton: true,
          includeAmberId: false,
        },
      });
      return {
        ok: result.ok,
        source: result.source,
        tookMs: result.tookMs,
        warnings: result.warnings,
        results: (result.results || [])
          .slice(0, Number(input.topK) || 20)
          .map((r) => ({
            name: r.name,
            score: r.score,
            source: r.source,
            reasons: r.reasons,
            meta: r.meta,
          })),
      };
    }

    if (toolName === "peoplerank_enrich") {
      const { enrich } =
        await import("../../../../Tiwari/tiwari-enrich/index.js");
      const result = await enrich({
        entity: input.entity,
        options: {
          kind: input.kind || "auto",
          includeNewton: true,
        },
      });
      // Slim the response so context doesn't balloon.
      return {
        ok: result.ok,
        source: result.source,
        tookMs: result.tookMs,
        entity: result.entity || null,
        profile: result.profile
          ? {
              name: result.profile.name,
              role: result.profile.role,
              company: result.profile.company,
              location: result.profile.location,
              tags: result.profile.tags,
              emails: result.profile.emails,
              phones: result.profile.phones,
              relationship: result.profile.relationship,
              signals: result.profile.signals,
            }
          : null,
        warnings: result.warnings,
      };
    }

    if (toolName === "peoplerank_opportunity") {
      const { sequence } =
        await import("../../../../Tiwari/tiwari-opportunity/index.js");
      const result = await sequence({
        trigger: {
          text: input.trigger,
          target: input.target,
          channel: input.channel || "auto",
        },
        options: { includeNewton: true },
      });
      return {
        ok: result.ok,
        source: result.source,
        tookMs: result.tookMs,
        sequence: (result.sequence || []).map((step) => ({
          channel: step.channel,
          timing: step.timing,
          subject: step.subject,
          body: step.body,
          rationale: step.rationale,
        })),
        warnings: result.warnings,
      };
    }

    return { error: `Unknown peoplerank tool: ${toolName}` };
  } catch (err) {
    return { error: `${toolName} failed: ${err.message}` };
  }
}
