/**
 * Workspace docs — tenant-scoped registry over Google Sheets / Docs lookup
 * by friendly name. Shirley registers her BMA Performance Tracker once
 * (via medha-id metadata) and from then on can ask "what's winning this
 * week?" without re-pasting the spreadsheet ID.
 *
 * Read-only for v1. Self-register (workspace_register_doc), org-shared
 * scoping, and a frontend UI are follow-ups.
 *
 * Registry shape lives on the tenant as `tenant.workspaceDocs`:
 *   [
 *     { slug, name, kind: "sheet" | "doc", id, defaultRange? },
 *     ...
 *   ]
 *
 * Tools:
 *   workspace_list_docs        ()                     -> entries
 *   workspace_read_doc         (name OR slug OR id)   -> sheet values / doc body
 */

import { executeSheetsTool } from "./sheets.js";
import { executeDocsTool } from "./docs.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_WorkspaceDocs",
  "Look up tenant-registered Google Sheets and Docs by friendly name",
);

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const WORKSPACE_DOCS_TOOLS = [
  {
    name: "workspace_list_docs",
    description:
      "List the Google Sheets / Docs the tenant has registered for quick lookup by name. " +
      "Returns an array of { slug, name, kind, id, defaultRange? }. Call this when " +
      "the user references a workspace doc by name (e.g. 'the Performance Tracker') " +
      "and you need to discover what they have on file.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "workspace_read_doc",
    description:
      "Read a tenant-registered Sheet or Doc by friendly name, slug, or ID. " +
      "Routes to sheets_get_values (using the registered defaultRange when present) " +
      "for kind='sheet', or docs_get_document for kind='doc'. Provide ONE of: " +
      "name (case-insensitive match on the registered name), slug, or id. " +
      "Optionally override range for sheets.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Friendly name as registered, e.g. 'BMA Performance Tracker'",
        },
        slug: {
          type: "string",
          description: "Short slug, e.g. 'performance-tracker'",
        },
        id: {
          type: "string",
          description: "Google file ID (spreadsheet or document)",
        },
        range: {
          type: "string",
          description:
            "Optional A1 range override for sheets (e.g. 'Sheet1!A1:Z100')",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeWorkspaceDocsTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const docs = Array.isArray(tenant?.workspaceDocs) ? tenant.workspaceDocs : [];

  switch (toolName) {
    case "workspace_list_docs":
      return {
        count: docs.length,
        docs: docs.map((d) => ({
          slug: d.slug,
          name: d.name,
          kind: d.kind,
          id: d.id,
          defaultRange: d.defaultRange ?? null,
        })),
      };

    case "workspace_read_doc":
      return readDoc(docs, input, tenant);

    default:
      return { error: `Unknown workspace docs tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDoc(docs, { name, slug, id }) {
  if (slug) {
    const m = docs.find((d) => d.slug === slug);
    if (m) return m;
  }
  if (id) {
    const m = docs.find((d) => d.id === id);
    if (m) return m;
  }
  if (name) {
    const needle = String(name).trim().toLowerCase();
    const m = docs.find(
      (d) =>
        (d.name && d.name.toLowerCase() === needle) ||
        (d.slug && d.slug.toLowerCase() === needle),
    );
    if (m) return m;
  }
  return null;
}

async function readDoc(docs, input, tenant) {
  const { name, slug, id, range } = input || {};
  if (!name && !slug && !id) {
    return {
      error: "Provide one of: name, slug, or id",
      hint: "Call workspace_list_docs to see registered docs.",
    };
  }

  const entry = findDoc(docs, { name, slug, id });
  if (!entry) {
    return {
      error: "No registered workspace doc matches",
      query: { name: name ?? null, slug: slug ?? null, id: id ?? null },
      registered: docs.map((d) => ({
        slug: d.slug,
        name: d.name,
        kind: d.kind,
      })),
    };
  }

  if (entry.kind === "sheet") {
    const effectiveRange = range || entry.defaultRange || "A1:Z200";
    const result = await executeSheetsTool(
      "sheets_get_values",
      { spreadsheetId: entry.id, range: effectiveRange },
      { tenant },
    );
    return { matched: entryToSummary(entry), range: effectiveRange, ...result };
  }

  if (entry.kind === "doc") {
    const result = await executeDocsTool(
      "docs_get_document",
      { documentId: entry.id },
      { tenant },
    );
    return { matched: entryToSummary(entry), ...result };
  }

  return {
    error: `Unsupported workspace doc kind: ${entry.kind}`,
    matched: entryToSummary(entry),
  };
}

function entryToSummary(entry) {
  return {
    slug: entry.slug,
    name: entry.name,
    kind: entry.kind,
    id: entry.id,
  };
}
