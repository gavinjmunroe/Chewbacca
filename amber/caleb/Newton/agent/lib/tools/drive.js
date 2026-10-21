/**
 * Google Drive tools — REST API client.
 *
 * Reuses Google OAuth via google-oauth.js helper.
 * Service key prefix: DRIVE (falls back to GCAL)
 * Required scopes: drive.readonly + drive.file (for writes)
 *
 * Endpoint base: https://www.googleapis.com/drive/v3/
 *
 * Tools:
 *   drive_list_files    (query?, pageSize?)
 *   drive_search        (query)
 *   drive_get_file      (fileId)
 *   drive_create_file   (name, content, mimeType?, parentId?)
 *   drive_download_file (fileId)
 */

import { getGoogleAccessToken } from "./google-oauth.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Drive",
  "Read, search, create, and download Google Drive files",
);

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/";

// MIME types that return as text
const TEXT_MIMES = new Set([
  "text/plain",
  "text/html",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "text/markdown",
]);

// Google Workspace types → export MIME
const EXPORT_MAP = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const DRIVE_TOOLS = [
  {
    name: "drive_list_files",
    description:
      "List files in Google Drive. Optionally filter with a Drive query string.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Drive query string, e.g. \"name contains 'report'\" or \"mimeType='application/pdf'\"",
        },
        pageSize: {
          type: "integer",
          description: "Max results (1-100). Defaults to 20.",
        },
      },
    },
  },
  {
    name: "drive_search",
    description: "Full-text search across Google Drive file names and content.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search text" },
      },
    },
  },
  {
    name: "drive_get_file",
    description: "Get metadata for a specific Drive file by its ID.",
    input_schema: {
      type: "object",
      required: ["fileId"],
      properties: {
        fileId: { type: "string" },
      },
    },
  },
  {
    name: "drive_create_file",
    description: "Create a new file in Google Drive.",
    input_schema: {
      type: "object",
      required: ["name", "content"],
      properties: {
        name: { type: "string", description: "File name" },
        content: { type: "string", description: "Text content of the file" },
        mimeType: {
          type: "string",
          description: "MIME type, e.g. text/plain. Defaults to text/plain.",
        },
        parentId: {
          type: "string",
          description: "Parent folder ID (optional)",
        },
      },
    },
  },
  {
    name: "drive_download_file",
    description:
      "Download a Drive file. Returns text content for text files; metadata + download URL for binaries.",
    input_schema: {
      type: "object",
      required: ["fileId"],
      properties: {
        fileId: { type: "string" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeDriveTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  let token;
  try {
    token = await getGoogleAccessToken(tenant, "drive");
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  try {
    switch (toolName) {
      case "drive_list_files":
        return driveListFiles(token, input);
      case "drive_search":
        return driveSearch(token, input);
      case "drive_get_file":
        return driveGetFile(token, input);
      case "drive_create_file":
        return driveCreateFile(token, input);
      case "drive_download_file":
        return driveDownloadFile(token, input);
      default:
        return { error: `Unknown Drive tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function driveGet(path, token, qs = {}) {
  const params = new URLSearchParams(qs);
  const url = `${DRIVE_BASE}${path}${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

const FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents";

function formatFile(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    parents: f.parents,
  };
}

async function driveListFiles(token, { query, pageSize = 20 }) {
  const qs = {
    fields: `files(${FILE_FIELDS})`,
    pageSize: String(Math.min(pageSize, 100)),
    orderBy: "modifiedTime desc",
  };
  if (query) qs.q = query;
  const data = await driveGet("files", token, qs);
  return { files: (data.files ?? []).map(formatFile) };
}

async function driveSearch(token, { query }) {
  const qs = {
    fields: `files(${FILE_FIELDS})`,
    pageSize: "20",
    q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
    orderBy: "modifiedTime desc",
  };
  const data = await driveGet("files", token, qs);
  return { files: (data.files ?? []).map(formatFile) };
}

async function driveGetFile(token, { fileId }) {
  const data = await driveGet(
    `files/${encodeURIComponent(fileId)}`,
    token,
    { fields: FILE_FIELDS },
  );
  return formatFile(data);
}

async function driveCreateFile(
  token,
  { name, content, mimeType = "text/plain", parentId },
) {
  const metadata = { name, mimeType };
  if (parentId) metadata.parents = [parentId];

  const boundary = "amber_drive_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch(`${UPLOAD_BASE}files?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive create failed (${res.status}): ${text}`);
  }
  return formatFile(await res.json());
}

async function driveDownloadFile(token, { fileId }) {
  // First get file metadata
  const meta = await driveGetFile(token, { fileId });

  // Google Workspace files need export
  const exportMime = EXPORT_MAP[meta.mimeType];
  if (exportMime) {
    const res = await fetch(
      `${DRIVE_BASE}files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive export failed (${res.status}): ${text}`);
    }
    const content = await res.text();
    return { ...meta, content };
  }

  // Binary or text file
  const res = await fetch(
    `${DRIVE_BASE}files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive download failed (${res.status}): ${text}`);
  }

  if (TEXT_MIMES.has(meta.mimeType) || meta.mimeType?.startsWith("text/")) {
    const content = await res.text();
    return { ...meta, content };
  }

  // Binary: return metadata + a short-lived download URL
  const buf = await res.arrayBuffer();
  return {
    ...meta,
    type: "binary",
    sizeBytes: buf.byteLength,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    note: "Binary file — use downloadUrl or drive_get_file for the webViewLink",
  };
}
