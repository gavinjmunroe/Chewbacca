/**
 * ZoomInfo MCP tools.
 *
 * Surfaces five ZoomInfo endpoints to MCP clients. Credentials are PER-TENANT
 * — most PE / advisory clients already own ZoomInfo seats and we reuse their
 * PKI triple (`username`, `client_id`, `private_key`). Lookup is gated on
 * `isZoomInfoConfiguredForTenant` so the handlers can return a friendly
 * "not configured" message instead of throwing.
 *
 * Tools registered:
 *   - togari_zoominfo_company_search
 *   - togari_zoominfo_company_enrich
 *   - togari_zoominfo_person_search
 *   - togari_zoominfo_person_enrich
 *   - togari_zoominfo_similar_companies
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import {
  isZoomInfoConfiguredForTenant,
  zoomInfoCompanyEnrich,
  zoomInfoCompanySearch,
  zoomInfoPersonEnrich,
  zoomInfoPersonSearch,
  zoomInfoSimilarCompanies,
} from "../../integrations/zoominfo/client";
import type {
  ZoomInfoCompanyDetail,
  ZoomInfoCompanySummary,
  ZoomInfoPersonDetail,
  ZoomInfoPersonSummary,
} from "../../integrations/zoominfo/types";

function textResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return { content: [{ type: "text", text }] };
}

function notConfigured(tenantId: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: `ZoomInfo is not configured for tenant '${tenantId}'. An admin must set ZOOMINFO_USERNAME, ZOOMINFO_CLIENT_ID, and ZOOMINFO_PRIVATE_KEY (per-tenant via tenant_secrets, or platform-wide via env).`,
      },
    ],
    isError: true,
  };
}

function formatCompanySummary(c: ZoomInfoCompanySummary, idx: number): string {
  const lines: string[] = [`${idx}. ${c.companyName} (id: ${c.companyId})`];
  if (c.website) lines.push(`   Website: ${c.website}`);
  if (c.industry) lines.push(`   Industry: ${c.industry}`);
  if (c.revenueRange) lines.push(`   Revenue: ${c.revenueRange}`);
  if (c.employeeRange) lines.push(`   Employees: ${c.employeeRange}`);
  const loc = [c.city, c.state, c.country].filter(Boolean).join(", ");
  if (loc) lines.push(`   Location: ${loc}`);
  return lines.join("\n");
}

function formatCompanyDetail(c: ZoomInfoCompanyDetail): string {
  const lines: string[] = [`Company: ${c.companyName} (id: ${c.companyId})`];
  if (c.website) lines.push(`Website: ${c.website}`);
  const industry = c.primaryIndustry ?? c.industry;
  if (industry) lines.push(`Industry: ${industry}`);
  if (c.subIndustry) lines.push(`Sub-industry: ${c.subIndustry}`);
  if (c.revenueRange) lines.push(`Revenue: ${c.revenueRange}`);
  if (c.employeeRange) lines.push(`Employees: ${c.employeeRange}`);
  if (c.yearFounded) lines.push(`Founded: ${c.yearFounded}`);
  if (c.type) lines.push(`Company type: ${c.type}`);
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  const addr = [c.street, c.city, c.state, c.zipCode, c.country]
    .filter(Boolean)
    .join(", ");
  if (addr) lines.push(`Address: ${addr}`);
  if (typeof c.numberOfContactsInZoomInfo === "number") {
    lines.push(`Contacts in ZoomInfo: ${c.numberOfContactsInZoomInfo}`);
  }
  return lines.join("\n");
}

function formatPersonSummary(p: ZoomInfoPersonSummary, idx: number): string {
  const lines: string[] = [`${idx}. ${p.fullName} (id: ${p.personId})`];
  if (p.jobTitle) lines.push(`   Title: ${p.jobTitle}`);
  if (p.companyName) {
    const cid = p.companyId ? ` (id: ${p.companyId})` : "";
    lines.push(`   Company: ${p.companyName}${cid}`);
  }
  if (p.companyWebsite) lines.push(`   Company website: ${p.companyWebsite}`);
  const channels = [
    p.hasEmail ? "email" : null,
    p.hasDirectPhone ? "direct phone" : null,
    p.hasMobilePhone ? "mobile" : null,
  ].filter(Boolean);
  if (channels.length) {
    lines.push(`   Has: ${channels.join(", ")}`);
  }
  if (typeof p.contactAccuracyScore === "number") {
    lines.push(`   Accuracy score: ${p.contactAccuracyScore}`);
  }
  return lines.join("\n");
}

function formatPersonDetail(p: ZoomInfoPersonDetail): string {
  const lines: string[] = [`Contact: ${p.fullName} (id: ${p.personId})`];
  if (p.jobTitle) lines.push(`Title: ${p.jobTitle}`);
  if (p.companyName) {
    const cid = p.companyId ? ` (id: ${p.companyId})` : "";
    lines.push(`Company: ${p.companyName}${cid}`);
  }
  if (p.companyWebsite) lines.push(`Company website: ${p.companyWebsite}`);
  if (p.email) lines.push(`Email: ${p.email}`);
  if (p.phone) lines.push(`Direct phone: ${p.phone}`);
  if (p.mobilePhone) lines.push(`Mobile phone: ${p.mobilePhone}`);
  if (p.linkedinUrl) lines.push(`LinkedIn: ${p.linkedinUrl}`);
  const addr = [p.street, p.city, p.state, p.zipCode, p.country]
    .filter(Boolean)
    .join(", ");
  if (addr) lines.push(`Address: ${addr}`);
  if (typeof p.contactAccuracyScore === "number") {
    lines.push(`Accuracy score: ${p.contactAccuracyScore}`);
  }
  return lines.join("\n");
}

// ─── togari_zoominfo_company_search ──────────────────────────────────────────

const companySearchInput = {
  companyName: z.string().min(1).describe("Company name to search for."),
  companyWebsite: z
    .string()
    .optional()
    .describe(
      "Optional website / domain — when provided, pins the search to the exact company by domain.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max results (default 5, hard cap 25)."),
};

export const companySearchTool: ToolModule = {
  name: "togari_zoominfo_company_search",
  description:
    "Search ZoomInfo for companies by name (and optional website). Returns up to 25 lightweight summary rows. Free — no credits consumed.",
  inputSchema: companySearchInput,
  handler: async (args, ctx) => {
    if (!(await isZoomInfoConfiguredForTenant(ctx.tenantId))) {
      return notConfigured(ctx.tenantId);
    }
    const parsed = z.object(companySearchInput).parse(args ?? {});
    const results = await zoomInfoCompanySearch(parsed);
    if (results.length === 0) {
      return textResult(
        `No ZoomInfo company matches for: ${parsed.companyName}`,
      );
    }
    const header = `ZoomInfo company_search · ${results.length} matches for "${parsed.companyName}"`;
    return textResult(
      `${header}\n\n${results.map((c, i) => formatCompanySummary(c, i + 1)).join("\n\n")}`,
    );
  },
};

// ─── togari_zoominfo_company_enrich ──────────────────────────────────────────

const companyEnrichInput = {
  companyId: z
    .string()
    .optional()
    .describe(
      "ZoomInfo internal company id from a prior search/enrich. Takes precedence.",
    ),
  companyWebsite: z
    .string()
    .optional()
    .describe("Company domain (e.g. 'acme.com') when companyId is unknown."),
  companyName: z
    .string()
    .optional()
    .describe(
      "Informational only — used as the fallback display name when ZoomInfo doesn't echo a name back.",
    ),
};

export const companyEnrichTool: ToolModule = {
  name: "togari_zoominfo_company_enrich",
  description:
    "Enrich a single company by ZoomInfo id or website. Returns full firmographics: revenue, employees, industry, year founded, address, contact count. Consumes 1 ZoomInfo credit per call.",
  inputSchema: companyEnrichInput,
  handler: async (args, ctx) => {
    if (!(await isZoomInfoConfiguredForTenant(ctx.tenantId))) {
      return notConfigured(ctx.tenantId);
    }
    const parsed = z.object(companyEnrichInput).parse(args ?? {});
    if (!parsed.companyId && !parsed.companyWebsite) {
      return {
        content: [
          {
            type: "text",
            text: "company_enrich requires either companyId or companyWebsite.",
          },
        ],
        isError: true,
      };
    }
    const detail = await zoomInfoCompanyEnrich(parsed);
    if (!detail) {
      return textResult(
        `No ZoomInfo company found for ${parsed.companyId ? `id ${parsed.companyId}` : `website ${parsed.companyWebsite}`}.`,
      );
    }
    return textResult(formatCompanyDetail(detail));
  },
};

// ─── togari_zoominfo_person_search ───────────────────────────────────────────

const personSearchInput = {
  companyName: z.string().optional(),
  companyWebsite: z.string().optional(),
  zoominfoCompanyId: z
    .string()
    .optional()
    .describe(
      "ZoomInfo company id from a prior company_enrich. Pins matches to the exact company.",
    ),
  personName: z.string().optional().describe("Full name or partial."),
  titleKeywords: z
    .array(z.string())
    .optional()
    .describe(
      "Job-title keywords. Joined with OR (e.g. ['CEO', 'Founder', 'President']).",
    ),
  minimumConfidence: z
    .number()
    .int()
    .min(70)
    .max(99)
    .optional()
    .describe(
      "ZoomInfo accuracy score floor (70-99). Values outside the range are ignored.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max results (default 10, hard cap 25)."),
};

export const personSearchTool: ToolModule = {
  name: "togari_zoominfo_person_search",
  description:
    "Search ZoomInfo for people at a company by name, website, ZoomInfo company id, or title keywords. Returns up to 25 summary rows (no PII, just channel flags). Free — no credits consumed.",
  inputSchema: personSearchInput,
  handler: async (args, ctx) => {
    if (!(await isZoomInfoConfiguredForTenant(ctx.tenantId))) {
      return notConfigured(ctx.tenantId);
    }
    const parsed = z.object(personSearchInput).parse(args ?? {});
    if (
      !parsed.companyName &&
      !parsed.companyWebsite &&
      !parsed.zoominfoCompanyId &&
      !parsed.personName
    ) {
      return {
        content: [
          {
            type: "text",
            text: "person_search needs at least one of: companyName, companyWebsite, zoominfoCompanyId, personName.",
          },
        ],
        isError: true,
      };
    }
    const results = await zoomInfoPersonSearch(parsed);
    if (results.length === 0) {
      return textResult("No ZoomInfo person matches.");
    }
    const anchor =
      parsed.personName ??
      parsed.zoominfoCompanyId ??
      parsed.companyWebsite ??
      parsed.companyName ??
      "";
    const header = `ZoomInfo person_search · ${results.length} matches${anchor ? ` for "${anchor}"` : ""}`;
    return textResult(
      `${header}\n\n${results.map((p, i) => formatPersonSummary(p, i + 1)).join("\n\n")}`,
    );
  },
};

// ─── togari_zoominfo_person_enrich ───────────────────────────────────────────

const personEnrichInput = {
  personId: z
    .string()
    .min(1)
    .describe("ZoomInfo personId from a prior person_search."),
};

export const personEnrichTool: ToolModule = {
  name: "togari_zoominfo_person_enrich",
  description:
    "Enrich a single person by ZoomInfo personId. Returns full PII: email, direct + mobile phone, LinkedIn, address. Consumes 1 ZoomInfo credit per call.",
  inputSchema: personEnrichInput,
  handler: async (args, ctx) => {
    if (!(await isZoomInfoConfiguredForTenant(ctx.tenantId))) {
      return notConfigured(ctx.tenantId);
    }
    const parsed = z.object(personEnrichInput).parse(args ?? {});
    const detail = await zoomInfoPersonEnrich(parsed);
    if (!detail) {
      return textResult(`No ZoomInfo person found for id ${parsed.personId}.`);
    }
    return textResult(formatPersonDetail(detail));
  },
};

// ─── togari_zoominfo_similar_companies ───────────────────────────────────────

const similarCompaniesInput = {
  companyId: z
    .string()
    .optional()
    .describe(
      "ZoomInfo company id of the seed. Takes precedence when provided.",
    ),
  companyWebsite: z
    .string()
    .optional()
    .describe(
      "Seed company's website / domain. Used when companyId is unknown.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max similar companies to return (default 10)."),
};

export const similarCompaniesTool: ToolModule = {
  name: "togari_zoominfo_similar_companies",
  description:
    "Find companies similar to a seed by primary industry and revenue band. Requires a 1-credit seed enrich; the lookalike search itself is free. Useful for buy-side thesis expansion.",
  inputSchema: similarCompaniesInput,
  handler: async (args, ctx) => {
    if (!(await isZoomInfoConfiguredForTenant(ctx.tenantId))) {
      return notConfigured(ctx.tenantId);
    }
    const parsed = z.object(similarCompaniesInput).parse(args ?? {});
    if (!parsed.companyId && !parsed.companyWebsite) {
      return {
        content: [
          {
            type: "text",
            text: "similar_companies requires either companyId or companyWebsite (seed company).",
          },
        ],
        isError: true,
      };
    }
    const results = await zoomInfoSimilarCompanies(parsed);
    if (results.length === 0) {
      return textResult("No similar companies found in ZoomInfo.");
    }
    const seedLabel = parsed.companyId
      ? `id ${parsed.companyId}`
      : parsed.companyWebsite!;
    const header = `ZoomInfo similar_companies · ${results.length} matches near ${seedLabel}`;
    return textResult(
      `${header}\n\n${results.map((c, i) => formatCompanySummary(c, i + 1)).join("\n\n")}`,
    );
  },
};

// ─── Registration helpers ────────────────────────────────────────────────────

export const TOGARI_ZOOMINFO_TOOLS: ToolModule[] = [
  companySearchTool,
  companyEnrichTool,
  personSearchTool,
  personEnrichTool,
  similarCompaniesTool,
];

/**
 * Register all ZoomInfo MCP tools on an `McpServer`. Called by
 * `src/transports/mcp/server.ts` alongside the other tool-module registrants.
 */
export function registerZoominfoTools(server: McpServer): void {
  for (const mod of TOGARI_ZOOMINFO_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as zoominfoTools; zoominfoTools.register(server)` pattern. */
export const register = registerZoominfoTools;
