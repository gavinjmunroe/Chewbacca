/**
 * Crust enrichment tool module.
 *
 * "Crust" is the amber-agent alias for Clay (api.clay.run).
 * Exposes two Claude tool schemas:
 *   crust_enrich_person   — enrich a person by LinkedIn URL / email / name
 *   crust_enrich_company  — enrich a company by domain / name
 *
 * Uses per-tenant CRUST_API_KEY via getSecret(tenant, "CRUST_API_KEY").
 * Falls back to process.env.CRUST_API_KEY during migration.
 *
 * Clay direct-API reference:
 *   POST https://api.clay.run/v1/sources/person/find
 *   POST https://api.clay.run/v1/sources/company/find
 *   Authorization: Bearer <key>
 *
 * All handlers return { error: "…" } on failure; never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Crust", [
  "Person enrichment via Clay/Crust (LinkedIn, email, name) — crust_enrich_person",
  "Company enrichment via Clay/Crust (domain, name) — crust_enrich_company",
]);

const CRUST_BASE = "https://api.clay.run";
const DEFAULT_TIMEOUT_MS = 25_000;

// ── helpers ───────────────────────────────────────────────────────────────

async function resolveApiKey(tenant) {
  if (tenant) {
    const key = await getSecret(tenant, "CRUST_API_KEY", {
      fallbackEnv: "CRUST_API_KEY",
    });
    if (key) return key;
  }
  return process.env.CRUST_API_KEY || null;
}

async function crustPost(path, body, apiKey) {
  const res = await fetch(`${CRUST_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Crust ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data;
}

// ── tool implementations ──────────────────────────────────────────────────

async function crustEnrichPerson(input, tenant) {
  const apiKey = await resolveApiKey(tenant);
  if (!apiKey) {
    return { error: "CRUST_API_KEY not configured for this tenant" };
  }

  const { linkedinUrl, email, fullName, company, title } = input;

  if (!linkedinUrl && !email && !fullName) {
    return {
      error: "At least one of linkedinUrl, email, or fullName is required",
    };
  }

  const body = {
    ...(linkedinUrl && { linkedin_url: linkedinUrl }),
    ...(email && { email }),
    ...(fullName && { name: fullName }),
    ...(company && { company }),
    ...(title && { title }),
  };

  try {
    return await crustPost("/v1/sources/person/find", body, apiKey);
  } catch (err) {
    return { error: err.message };
  }
}

async function crustEnrichCompany(input, tenant) {
  const apiKey = await resolveApiKey(tenant);
  if (!apiKey) {
    return { error: "CRUST_API_KEY not configured for this tenant" };
  }

  const { domain, name } = input;

  if (!domain && !name) {
    return { error: "At least one of domain or name is required" };
  }

  const body = {
    ...(domain && { domain }),
    ...(name && { company_name: name }),
  };

  try {
    return await crustPost("/v1/sources/company/find", body, apiKey);
  } catch (err) {
    return { error: err.message };
  }
}

// ── tool schemas ──────────────────────────────────────────────────────────

export const CRUST_TOOLS = [
  {
    name: "crust_enrich_person",
    description:
      "Enrich a person's profile using Clay (Crust). Returns verified email, LinkedIn data, job history, company info, and social signals. Provide as many identifiers as available for best match accuracy.",
    input_schema: {
      type: "object",
      properties: {
        linkedinUrl: {
          type: "string",
          description: "LinkedIn profile URL (strongest identifier)",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        fullName: {
          type: "string",
          description: "Full name",
        },
        company: {
          type: "string",
          description: "Current or recent company name to disambiguate",
        },
        title: {
          type: "string",
          description: "Job title to disambiguate",
        },
      },
    },
  },
  {
    name: "crust_enrich_company",
    description:
      "Enrich a company profile using Clay (Crust). Returns funding, headcount, tech stack, social profiles, and key people. Provide domain for best results.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Company website domain (e.g. 'stripe.com')",
        },
        name: {
          type: "string",
          description: "Company name (used when domain is unknown)",
        },
      },
    },
  },
];

// ── dispatcher ────────────────────────────────────────────────────────────

export async function executeCrustTool(toolName, input, ctx = {}) {
  const { tenant } = ctx;
  switch (toolName) {
    case "crust_enrich_person":
      return crustEnrichPerson(input, tenant);
    case "crust_enrich_company":
      return crustEnrichCompany(input, tenant);
    default:
      return { error: `Unknown Crust tool: ${toolName}` };
  }
}
