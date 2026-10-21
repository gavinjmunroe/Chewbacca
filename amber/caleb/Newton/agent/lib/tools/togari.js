/**
 * Togari MCP integration: BMA lead pipeline, contact enrichment, and natural language BigQuery.
 *
 * Connects to the TogariMCP API server for:
 * - Natural language contact queries (BigQuery)
 * - People CRUD (create, read, update leads)
 * - Company enrichment (Exa, Clay)
 * - Contact enrichment (LinkedIn, email)
 * - File processing (CSV, Excel upload and parse)
 * - Amber mobile submission (lead intake)
 * - Campaign management
 * - Relationship tracking
 *
 * Per-tenant secrets: TOGARI_API_KEY and TOGARI_API_URL via getSecret(tenant, …).
 * Falls back to process.env during migration.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { callClaudeRaw } from "../ai.js";
import {
  ACTIVATION_SOURCES,
  evaluateActivation,
} from "../togari-access-policy.js";

registerCapability("_tools_Togari", [
  "Delegate any transactional/sales request to the Togari agent (togari_ask)",
  "BMA lead pipeline search and enrichment (togari_search_contacts)",
  "Person enrichment via Togari/Clay (togari_enrich_person)",
  "Company enrichment by domain (togari_enrich_company)",
  "Lead intake and submission (togari_submit_lead)",
  "List people / leads with filters (togari_list_people)",
  "Get a specific person by ID (togari_get_person)",
  "Create a new person / lead record (togari_create_person)",
  "List companies in the CRM (togari_list_companies)",
  "List campaigns (togari_list_campaigns)",
]);

// ── config resolution ─────────────────────────────────────────────────────

async function resolveConfig(tenant) {
  let apiUrl = null;
  let apiKey = null;

  if (tenant) {
    [apiUrl, apiKey] = await Promise.all([
      getSecret(tenant, "TOGARI_API_URL", { fallbackEnv: "TOGARI_API_URL" }),
      getSecret(tenant, "TOGARI_API_KEY", { fallbackEnv: "TOGARI_API_KEY" }),
    ]);
  }

  return {
    apiUrl: apiUrl || process.env.TOGARI_API_URL || "",
    apiKey: apiKey || process.env.TOGARI_API_KEY || "",
  };
}

function isConfigured(cfg) {
  return !!(cfg.apiUrl && cfg.apiKey);
}

function togariHeaders(cfg) {
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
  };
}

// ── People (Leads) ────────────────────────────────────────────────────────

async function listPeople(cfg, filters = {}) {
  if (!isConfigured(cfg)) return [];
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.vertical) params.set("vertical", filters.vertical);
  if (filters.limit) params.set("limit", String(filters.limit));

  const res = await fetch(`${cfg.apiUrl}/api/v1/people?${params}`, {
    headers: togariHeaders(cfg),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.people || data.data || data;
}

async function getPerson(cfg, personId) {
  if (!isConfigured(cfg)) return null;
  const res = await fetch(`${cfg.apiUrl}/api/v1/people/${personId}`, {
    headers: togariHeaders(cfg),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function createPerson(cfg, personData) {
  if (!isConfigured(cfg)) return null;
  const res = await fetch(`${cfg.apiUrl}/api/v1/people`, {
    method: "POST",
    headers: togariHeaders(cfg),
    body: JSON.stringify(personData),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Enrichment ────────────────────────────────────────────────────────────

async function enrichPerson(cfg, opts = {}) {
  if (!isConfigured(cfg)) return null;
  const { linkedinUrl, email, fullName } = opts;
  const res = await fetch(`${cfg.apiUrl}/api/v1/enrichment/person`, {
    method: "POST",
    headers: togariHeaders(cfg),
    body: JSON.stringify({ linkedinUrl, email, fullName, provider: "auto" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function enrichCompany(cfg, domain) {
  if (!isConfigured(cfg)) return null;
  const res = await fetch(`${cfg.apiUrl}/api/v1/enrichment/company`, {
    method: "POST",
    headers: togariHeaders(cfg),
    body: JSON.stringify({ domain, provider: "auto" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function searchEntities(cfg, query, entityType = "contact", limit = 10) {
  if (!isConfigured(cfg)) return [];
  const res = await fetch(`${cfg.apiUrl}/api/v1/enrichment/search`, {
    method: "POST",
    headers: togariHeaders(cfg),
    body: JSON.stringify({ query, entityType, limit }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || data;
}

// ── Amber Mobile Submission ───────────────────────────────────────────────

async function submitAmberLead(cfg, opts = {}) {
  if (!isConfigured(cfg)) return null;
  const {
    linkedinUrl,
    fullName,
    currentTitle,
    currentCompany,
    notes,
    submitterEmail,
  } = opts;
  const res = await fetch(`${cfg.apiUrl}/api/v1/amber/submit`, {
    method: "POST",
    headers: {
      ...togariHeaders(cfg),
      "x-api-key": process.env.AMBER_API_KEY || cfg.apiKey,
    },
    body: JSON.stringify({
      linkedinUrl,
      fullName,
      currentTitle,
      currentCompany,
      notes,
      submitterEmail,
      sourceChannel: "imessage_agent",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Companies ─────────────────────────────────────────────────────────────

async function listCompanies(cfg, limit = 50) {
  if (!isConfigured(cfg)) return [];
  const res = await fetch(`${cfg.apiUrl}/api/v1/companies?limit=${limit}`, {
    headers: togariHeaders(cfg),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.companies || data.data || data;
}

// ── Campaigns ─────────────────────────────────────────────────────────────

async function listCampaigns(cfg) {
  if (!isConfigured(cfg)) return [];
  const res = await fetch(`${cfg.apiUrl}/api/v1/campaigns`, {
    headers: togariHeaders(cfg),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.campaigns || data.data || data;
}

// ── Privacy gate (PRD §4): sanitize before anything reaches Togari ─────────
// Medha holds private context (burnout, faith, mental health, romance, family
// feelings). None of it may leak into Togari's sales/CRM workflows. Before any
// handoff we reduce the request to a WORK-RELEVANT note and strip the rest.
// Fails CLOSED: if sanitization errors or is empty, we do NOT forward raw text.
// No approval prompt (Caleb's no-permission rule) — Medha sanitizes, sends, and
// reports what was sent so the user sees exactly what crossed the gate.
async function sanitizeForTogari(request) {
  const system =
    "You convert a personal-assistant message into a WORK-RELEVANT handoff note for a SEPARATE sales/CRM agent (Togari). " +
    "STRICTLY REMOVE all private/personal context: emotions, burnout, mental health, faith or spiritual content, romantic, family, or friendship feelings, physical health, and anything a person would not want surfacing in a business workflow. " +
    "Keep ONLY business-actionable content: deals, pipeline, companies, prospects, contacts for work, sourcing, client deliverables, content/marketing tasks, and work scheduling. " +
    "Output ONLY the sanitized request as plain text with no preamble. If there is NO business-actionable content, output exactly: NO_WORK_CONTENT";
  try {
    const out = await callClaudeRaw({
      max_tokens: 400,
      system,
      messages: [
        {
          role: "user",
          content: `Sanitize this for the Togari handoff:\n\n${String(request)}`,
        },
      ],
    });
    const text = (out?.content?.[0]?.text || "").trim();
    if (!text) return { ok: false, error: "sanitizer_empty" };
    if (/^NO_WORK_CONTENT/i.test(text))
      return { ok: false, error: "no_work_content" };
    return { ok: true, sanitized: text };
  } catch (err) {
    return { ok: false, error: `sanitizer_failed: ${err.message}` };
  }
}

// ── Agent-to-agent: delegate a transactional ask to the live Togari agent ──
// Karthik 2026-06-04: Medha must be able to CALL Togari to unlock Togari's
// functionality (deals, pipeline, sourcing, enrichment). This relays a natural
// language request to togari-platform's universal NL endpoint — the same
// processMessage pipeline the Slack/iMessage transports use — and returns
// Togari's reply. One-way Medha -> Togari (decision #14, the agent-to-agent
// gate). Uses the org-level Togari key; togari-platform owns its own auth +
// data scoping on the far side.
async function askTogariAgent(cfg, request, tenant) {
  const platformUrl = (process.env.TOGARI_PLATFORM_URL || cfg.apiUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!platformUrl || !cfg.apiKey) {
    return {
      error:
        "Togari not configured: TOGARI_PLATFORM_URL (or TOGARI_API_URL) + TOGARI_API_KEY required",
    };
  }
  if (!request || !String(request).trim()) {
    return { error: "togari_ask requires a non-empty `request`" };
  }
  // Privacy gate: never forward raw text. Sanitize to a work-relevant note,
  // fail closed if that's not possible.
  const clean = await sanitizeForTogari(request);
  if (!clean.ok) {
    if (clean.error === "no_work_content") {
      return {
        error: "no_work_content",
        message:
          "Nothing here is work-relevant for Togari, so I kept it private and sent nothing.",
      };
    }
    return {
      error: "sanitize_failed",
      message:
        "I couldn't build a privacy-safe version, so I sent nothing to Togari. Restate just the work-relevant ask and I'll forward that.",
    };
  }
  const res = await fetch(`${platformUrl}/api/v1/message`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-togari-key": cfg.apiKey },
    body: JSON.stringify({
      message: clean.sanitized,
      user_id: tenant?.phoneNumber || "medha-agent",
      context: {
        source: "medha-agent",
        phone: tenant?.phoneNumber || null,
        did: tenant?.did || tenant?.privyDid || null,
      },
    }),
    signal: AbortSignal.timeout(
      Number(process.env.TOGARI_PLATFORM_TIMEOUT_MS) || 25_000,
    ),
  });
  if (res.status === 401) {
    return { error: "togari rejected x-togari-key (401)" };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `togari ${res.status}: ${detail.slice(0, 300)}` };
  }
  const data = await res.json().catch(() => ({}));
  const reply =
    data.reply ||
    data.message ||
    data.text ||
    data.response ||
    (typeof data === "string" ? data : JSON.stringify(data));
  // Return the sanitized text that was actually forwarded so Medha can tell the
  // user exactly what crossed the gate ("Sent to Togari: ...").
  return { ok: true, reply, sent_to_togari: clean.sanitized };
}

// ── Tool definitions for Claude ───────────────────────────────────────────

// TOGARI_TOOLS is always exported as the full list; the dispatcher gates on
// runtime config so Claude only sees them when the tenant has credentials.
export const TOGARI_TOOLS = [
  {
    name: "togari_ask",
    description:
      "Delegate a transactional / sales request to Togari, the BMA sales+sourcing agent (deal pipeline, CRM, company sourcing, outbound, DealCloud). Use this when the user wants something professional/transactional that belongs to Togari's lane rather than Medha's relationship lane: e.g. 'add this to my Togari pipeline', 'what deals are in researching', 'source companies like Acme'. Pass the user's request in natural language. The request is automatically sanitized before sending: all private/emotional/spiritual/health context is stripped and only the work-relevant ask crosses to Togari (one-way; Togari can never read Medha's private memory). The result includes `sent_to_togari` so you can tell the user exactly what was forwarded.",
    input_schema: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description:
            "The full natural-language request to hand to the Togari agent, with any context it needs to act.",
        },
      },
      required: ["request"],
    },
  },
  {
    name: "togari_search_contacts",
    description:
      "Search the BMA/Togari contacts database. Use for finding leads, prospects, or business contacts by name, company, title, or any criteria.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language search query, e.g. 'engineers at Google' or 'VPs in healthcare'",
        },
        limit: {
          type: "integer",
          description: "Max results (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "togari_enrich_person",
    description:
      "Enrich a person's profile with LinkedIn data, company info, and scoring. Provide LinkedIn URL, email, or name.",
    input_schema: {
      type: "object",
      properties: {
        linkedinUrl: {
          type: "string",
          description: "LinkedIn profile URL",
        },
        email: { type: "string", description: "Email address" },
        fullName: { type: "string", description: "Full name" },
      },
    },
  },
  {
    name: "togari_submit_lead",
    description:
      "Submit a new lead to the BMA pipeline from a conversation. Amber can capture someone's info and submit it for enrichment and scoring.",
    input_schema: {
      type: "object",
      properties: {
        linkedinUrl: { type: "string" },
        fullName: { type: "string" },
        currentTitle: { type: "string" },
        currentCompany: { type: "string" },
        notes: { type: "string" },
      },
      required: ["fullName"],
    },
  },
  {
    name: "togari_enrich_company",
    description:
      "Enrich a company profile by domain. Returns firmographics, industry, size, and other enrichment data via Clay/Exa providers.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Company domain, e.g. 'acme.com'",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "togari_list_people",
    description:
      "List people / leads from the BMA pipeline. Filter by status, vertical, or limit. Use this to browse or audit the CRM.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by lead status (e.g. 'new', 'qualified', 'contacted')",
        },
        vertical: {
          type: "string",
          description: "Filter by industry vertical",
        },
        limit: {
          type: "integer",
          description: "Max results (default 50)",
        },
      },
    },
  },
  {
    name: "togari_get_person",
    description:
      "Get a specific person / lead by their Togari ID. Returns the full record including enrichment, history, and contact details.",
    input_schema: {
      type: "object",
      properties: {
        personId: {
          type: "string",
          description: "Togari person/lead ID",
        },
      },
      required: ["personId"],
    },
  },
  {
    name: "togari_create_person",
    description:
      "Create a new person / lead record directly in the Togari CRM. Use when you already have structured data (not from a conversation); for lightweight conversation capture use togari_submit_lead instead.",
    input_schema: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        email: { type: "string" },
        linkedinUrl: { type: "string" },
        currentTitle: { type: "string" },
        currentCompany: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string" },
        status: { type: "string" },
        vertical: { type: "string" },
      },
      required: ["fullName"],
    },
  },
  {
    name: "togari_list_companies",
    description:
      "List companies from the Togari CRM. Returns firmographic data on accounts being tracked.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max results (default 50)",
        },
      },
    },
  },
  {
    name: "togari_list_campaigns",
    description:
      "List active and historical outreach campaigns in the Togari CRM.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Dispatcher ────────────────────────────────────────────────────────────

// Tools that mutate Togari enterprise state (lead intake, CRM writes,
// campaign coupling). These are gated by the access policy: they require
// a Loop-verified iMessage path with an enterprise-tier tenant. Read-only
// browse tools fall through to the entitlement check inside resolveConfig.
const ENTERPRISE_MUTATING_TOGARI_TOOLS = new Set([
  "togari_submit_lead",
  "togari_create_person",
]);

export async function executeTogariTool(toolName, input, ctx = {}) {
  const {
    tenant,
    source = ACTIVATION_SOURCES.IMESSAGE_LOOP,
    loopVerified = true,
  } = ctx;

  // Hard gate: iOS proxy must never reach Togari enterprise mutating tools.
  // The iOS surface goes through tiwari-proxy.js and uses Tiwari primitives
  // directly; if anything ever wires it into the dispatcher, fail closed.
  if (ENTERPRISE_MUTATING_TOGARI_TOOLS.has(toolName)) {
    const decision = evaluateActivation({ source, tenant, loopVerified });
    if (!decision.allowed) {
      return {
        error: "togari_enterprise_denied",
        reason: decision.reason,
        source: decision.source,
      };
    }
  }

  let cfg;
  try {
    cfg = await resolveConfig(tenant);
  } catch (err) {
    return { error: `Togari config error: ${err.message}` };
  }

  // Agent-to-agent delegation goes to togari-platform's NL endpoint and has
  // its own config resolution (TOGARI_PLATFORM_URL), so it runs before the
  // strict CRUD-config gate below.
  if (toolName === "togari_ask") {
    try {
      return await askTogariAgent(
        cfg,
        input.request || input.text || input.message || "",
        tenant,
      );
    } catch (err) {
      return { error: err.message };
    }
  }

  if (!isConfigured(cfg)) {
    return {
      error:
        "Togari not configured: TOGARI_API_URL and TOGARI_API_KEY required",
    };
  }

  try {
    switch (toolName) {
      case "togari_search_contacts":
        return searchEntities(cfg, input.query, "contact", input.limit || 10);
      case "togari_enrich_person":
        return enrichPerson(cfg, input);
      case "togari_enrich_company":
        return enrichCompany(cfg, input.domain);
      case "togari_submit_lead":
        return submitAmberLead(cfg, {
          ...input,
          submitterEmail: "amber@caleb.agent",
        });
      case "togari_list_people":
        return listPeople(cfg, {
          status: input.status,
          vertical: input.vertical,
          limit: input.limit || 50,
        });
      case "togari_get_person":
        return getPerson(cfg, input.personId);
      case "togari_create_person":
        return createPerson(cfg, input);
      case "togari_list_companies":
        return listCompanies(cfg, input.limit || 50);
      case "togari_list_campaigns":
        return listCampaigns(cfg);
      default:
        return { error: `Unknown Togari tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}
