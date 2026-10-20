/**
 * Read-only MCP tools for contacts in the Togari warehouse.
 *
 * Tools:
 *   - `togari_contacts_search` — paged search across contacts. Filter by
 *     company id, mandate id (via mandate_companies join), free-text
 *     (name/email/title), or is_primary.
 *   - `togari_contacts_get`    — single contact + company name + a
 *     provenance breakdown drawn from the source and contact_info JSON.
 *
 * Every query filters by `tenant_id` from ctx. Handlers wrap in traceCall.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { traceCall } from "../../lib/tracing";
import {
  T,
  defaultBq,
  markdownTable,
  markdownDl,
  asIso,
  asNumber,
  clamp,
  type ToolDeps,
} from "./_shared";

// ── togari_contacts_search ──────────────────────────────────────────

const searchInputShape = {
  companyId: z
    .string()
    .min(1)
    .optional()
    .describe("Restrict to contacts belonging to this company id."),
  mandateId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Restrict to contacts whose company is linked to this mandate via mandate_companies.",
    ),
  query: z
    .string()
    .min(1)
    .optional()
    .describe("Free-text contains match against full_name, email, title."),
  isPrimary: z
    .boolean()
    .optional()
    .describe("If true, only return contacts flagged is_primary."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to return (1-100, default 25)."),
};
const SearchInput = z.object(searchInputShape);
type SearchInput = z.infer<typeof SearchInput>;

export function buildContactsSearchTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_contacts_search",
    description:
      "Search contacts for the active tenant. Filter by company id, mandate id, free text (name/email/title), or is_primary. Returns a markdown table.",
    inputSchema: searchInputShape,
    handler: (args, ctx) =>
      traceCall("togari_contacts_search", async () => {
        const parsed = SearchInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const input: SearchInput = parsed.data;
        const limit = clamp(input.limit ?? 25, 1, 100);
        const bq = deps.bq ?? defaultBq();

        const params: Record<string, unknown> = {
          tenantId: ctx.tenantId,
          limit,
        };
        const where: string[] = ["c.tenant_id = @tenantId"];
        const joins: string[] = [];

        if (input.companyId) {
          where.push("c.company_id = @companyId");
          params.companyId = input.companyId;
        }
        if (input.mandateId) {
          joins.push(
            `JOIN ${T.mandateCompanies} mc
                ON mc.company_id = c.company_id
               AND mc.tenant_id = c.tenant_id
               AND mc.mandate_id = @mandateId
               AND mc.removed_at IS NULL`,
          );
          params.mandateId = input.mandateId;
        }
        if (input.query) {
          where.push(
            `(LOWER(IFNULL(c.full_name, '')) LIKE LOWER(@queryPattern)
              OR LOWER(IFNULL(c.email, '')) LIKE LOWER(@queryPattern)
              OR LOWER(IFNULL(c.title, '')) LIKE LOWER(@queryPattern))`,
          );
          params.queryPattern = `%${input.query}%`;
        }
        if (input.isPrimary !== undefined) {
          where.push("c.is_primary = @isPrimary");
          params.isPrimary = input.isPrimary;
        }

        const sql = `
          SELECT c.id, c.company_id, c.full_name, c.title, c.email, c.email_verified,
                 c.linkedin_url, c.is_primary, c.primary_score, c.source, c.created_at
            FROM ${T.contacts} c
            ${joins.join("\n            ")}
           WHERE ${where.join(" AND ")}
           ORDER BY c.is_primary DESC NULLS LAST, c.primary_score DESC NULLS LAST, c.created_at DESC
           LIMIT @limit
        `.trim();

        const result = await bq.executeQuery(sql, params);
        const rows = result.rows;

        const table = markdownTable(
          [
            "id",
            "company_id",
            "full_name",
            "title",
            "email",
            "verified",
            "primary",
            "score",
            "source",
          ],
          rows.map((r) => [
            r.id as string,
            r.company_id as string,
            (r.full_name as string | null) ?? "—",
            (r.title as string | null) ?? "—",
            (r.email as string | null) ?? "—",
            r.email_verified === true
              ? "yes"
              : r.email_verified === false
                ? "no"
                : "—",
            r.is_primary === true ? "yes" : r.is_primary === false ? "no" : "—",
            asNumber(r.primary_score) ?? "—",
            (r.source as string | null) ?? "—",
          ]),
        );

        const filterParts: string[] = [];
        if (input.companyId) filterParts.push(`company=${input.companyId}`);
        if (input.mandateId) filterParts.push(`mandate=${input.mandateId}`);
        if (input.query)
          filterParts.push(`query=${JSON.stringify(input.query)}`);
        if (input.isPrimary !== undefined)
          filterParts.push(`isPrimary=${input.isPrimary}`);
        const filtersLine =
          filterParts.length > 0
            ? `Filters: ${filterParts.join(", ")}`
            : "Filters: (none)";

        const text = [
          `**Contacts search** (tenant: ${ctx.tenantId})`,
          filtersLine,
          `Returned ${rows.length} of up to ${limit}.`,
          "",
          table,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── togari_contacts_get ─────────────────────────────────────────────

const getInputShape = {
  id: z.string().min(1).describe("Contact UUID."),
};
const GetInput = z.object(getInputShape);
type GetInput = z.infer<typeof GetInput>;

export function buildContactsGetTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_contacts_get",
    description:
      "Fetch a single contact by id for the active tenant. Returns the full contact row, the linked company name, and a provenance breakdown (source + contact_info keys).",
    inputSchema: getInputShape,
    handler: (args, ctx) =>
      traceCall("togari_contacts_get", async () => {
        const parsed = GetInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const input: GetInput = parsed.data;
        const bq = deps.bq ?? defaultBq();

        const result = await bq.executeQuery(
          `SELECT c.id, c.company_id, c.enrichment_run_id, c.source,
                  c.full_name, c.first_name, c.last_name, c.title,
                  c.email, c.email_verified, c.mobile_phone, c.business_phone,
                  c.linkedin_url, c.dc_contact_id, c.contact_info,
                  c.is_primary, c.primary_score, c.primary_reason,
                  c.created_at, c.updated_at,
                  co.name AS company_name
             FROM ${T.contacts} c
        LEFT JOIN ${T.companies} co
                  ON co.id = c.company_id AND co.tenant_id = c.tenant_id
            WHERE c.id = @id AND c.tenant_id = @tenantId
            LIMIT 1`,
          { id: input.id, tenantId: ctx.tenantId },
        );
        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No contact found with id=${input.id} for tenant ${ctx.tenantId}.`,
              },
            ],
            isError: true,
          };
        }
        const c = result.rows[0];

        const dl = markdownDl([
          ["id", c.id],
          ["full_name", c.full_name],
          ["title", c.title],
          ["email", c.email],
          ["email_verified", c.email_verified],
          ["mobile_phone", c.mobile_phone],
          ["business_phone", c.business_phone],
          ["linkedin_url", c.linkedin_url],
          ["dc_contact_id", c.dc_contact_id],
          ["company_id", c.company_id],
          ["company_name", c.company_name],
          ["is_primary", c.is_primary],
          ["primary_score", asNumber(c.primary_score)],
          ["primary_reason", c.primary_reason],
          ["source", c.source],
          ["enrichment_run_id", c.enrichment_run_id],
          ["created_at", asIso(c.created_at)],
          ["updated_at", asIso(c.updated_at)],
        ]);

        // Provenance breakdown: count keys on contact_info, list source.
        const provenanceLines: string[] = [];
        provenanceLines.push(
          `- **Primary source:** ${(c.source as string) ?? "—"}`,
        );
        if (c.contact_info && typeof c.contact_info === "object") {
          const keys = Object.keys(c.contact_info as Record<string, unknown>);
          if (keys.length > 0) {
            provenanceLines.push(
              `- **contact_info keys (${keys.length}):** ${keys.join(", ")}`,
            );
          }
        }

        const text = [
          `**Contact** (tenant: ${ctx.tenantId})`,
          "",
          dl,
          "",
          "**Provenance**",
          "",
          provenanceLines.join("\n"),
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildContactsSearchTool(deps));
  registerToolModule(server, buildContactsGetTool(deps));
}
