/**
 * Google Docs tools — REST API client.
 *
 * Reuses Google OAuth via google-oauth.js.
 * Service key prefix: DOCS (falls back to GCAL)
 * Endpoint: https://docs.googleapis.com/v1/documents/
 *
 * Tools:
 *   docs_get_document    (documentId)
 *   docs_create_document (title, content?)
 *   docs_append_text     (documentId, text)
 */

import { getGoogleAccessToken } from "./google-oauth.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Docs",
  "Read and write Google Docs documents",
);

const DOCS_BASE = "https://docs.googleapis.com/v1/documents/";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const DOCS_TOOLS = [
  {
    name: "docs_get_document",
    description: "Fetch the full content and metadata of a Google Doc.",
    input_schema: {
      type: "object",
      required: ["documentId"],
      properties: {
        documentId: { type: "string", description: "Google Docs document ID" },
      },
    },
  },
  {
    name: "docs_create_document",
    description: "Create a new Google Docs document, optionally with content.",
    input_schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Document title" },
        content: {
          type: "string",
          description: "Initial plain-text content to insert (optional)",
        },
      },
    },
  },
  {
    name: "docs_append_text",
    description: "Append plain text to an existing Google Doc.",
    input_schema: {
      type: "object",
      required: ["documentId", "text"],
      properties: {
        documentId: { type: "string" },
        text: {
          type: "string",
          description: "Text to append. A newline is prepended automatically.",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeDocsTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  let token;
  try {
    token = await getGoogleAccessToken(tenant, "docs");
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  try {
    switch (toolName) {
      case "docs_get_document":
        return docsGet(token, input);
      case "docs_create_document":
        return docsCreate(token, input);
      case "docs_append_text":
        return docsAppend(token, input);
      default:
        return { error: `Unknown Docs tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function docsGet(token, { documentId }) {
  const res = await fetch(`${DOCS_BASE}${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Docs GET failed (${res.status}): ${text}`);
  }

  const doc = await res.json();

  // Extract readable text from the doc body
  const text = extractDocText(doc.body?.content ?? []);

  return {
    documentId: doc.documentId,
    title: doc.title,
    text,
    revisionId: doc.revisionId,
    lastModifiedTime: doc.lastModifiedTime,
  };
}

async function docsCreate(token, { title, content }) {
  // Create empty document
  const res = await fetch(DOCS_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Docs create failed (${res.status}): ${text}`);
  }

  const doc = await res.json();

  if (content) {
    // Insert content using batchUpdate
    await docsInsertText(token, doc.documentId, content, 1);
  }

  return {
    documentId: doc.documentId,
    title: doc.title,
    url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
  };
}

async function docsAppend(token, { documentId, text }) {
  // Get current doc to find end index
  const res = await fetch(`${DOCS_BASE}${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Docs fetch for append failed (${res.status}): ${errText}`);
  }

  const doc = await res.json();
  const content = doc.body?.content ?? [];
  const lastElement = content[content.length - 1];
  // End of body index (minus 1 to insert before the trailing newline)
  const endIndex = Math.max((lastElement?.endIndex ?? 2) - 1, 1);

  await docsInsertText(token, documentId, "\n" + text, endIndex);

  return { success: true, documentId, appended: text.length };
}

async function docsInsertText(token, documentId, text, index) {
  const res = await fetch(
    `${DOCS_BASE}${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index },
              text,
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Docs batchUpdate (insert) failed (${res.status}): ${errText}`,
    );
  }
  return res.json();
}

// Extract plain text from Docs API body content array
function extractDocText(content) {
  const parts = [];
  for (const elem of content) {
    if (elem.paragraph) {
      const paraText = (elem.paragraph.elements ?? [])
        .map((e) => e.textRun?.content ?? "")
        .join("");
      parts.push(paraText);
    } else if (elem.table) {
      for (const row of elem.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          parts.push(extractDocText(cell.content ?? []));
        }
      }
    }
  }
  return parts.join("");
}
