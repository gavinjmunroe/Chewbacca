/**
 * content-loop.js — Tab 9: raw content -> personal repurposing.
 *
 * Two tools that close the loop Sagar called out: "Why is there not a
 * feedback loop with taking my raw content and repurposing it for my own
 * enjoyment?"
 *
 *   ingest_to_drive_folder        — upload a piece of raw content into the
 *                                   right Drive folder (auto-creates the
 *                                   "Medha / <Topic>" folder hierarchy).
 *   suggest_personal_repurposing  — list files in the topic folder, ask
 *                                   Claude for 3-5 starter ideas Sagar can
 *                                   riff on. Output is a starting prompt
 *                                   for HIS creative process, not slop.
 *
 * Drive access reuses google-oauth.js with the "drive" service prefix.
 * Claude calls go direct to the Anthropic REST API (mirrors the pattern in
 * lib/commitment-extractor.js) since the agent surface doesn't take a hard
 * dependency on the @anthropic-ai/sdk package.
 */

import { getGoogleAccessToken } from "./google-oauth.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_ContentLoop", [
  "Ingest raw content (URLs, photos, audio, docs) into the right Drive folder for a topic (ingest_to_drive_folder)",
  "Suggest ways to repurpose Sagar's raw content for his own enjoyment, not for marketing (suggest_personal_repurposing)",
]);

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Medha";

const ALLOWED_DIMENSIONS = new Set([
  "social",
  "spiritual",
  "emotional",
  "physical",
  "financial",
  "intellectual",
]);

const ALLOWED_TYPES = new Set(["photo", "video", "audio", "doc", "auto"]);
const ALLOWED_AUDIENCES = new Set(["personal", "rytual", "bma"]);
const ALLOWED_FORMATS = new Set(["video_short", "carousel", "blog", "any"]);

// ─── Tool schemas ────────────────────────────────────────────────────────────

export const CONTENT_LOOP_TOOLS = [
  {
    name: "ingest_to_drive_folder",
    description:
      "Ingest a piece of raw content (photo, video, audio, doc) into the " +
      "right Google Drive folder for a topic. Auto-creates a 'Medha/<Topic>' " +
      "folder structure when missing. Accepts a remote URL as the source " +
      "(http/https). Returns the Drive folder URL plus the new file id.",
    input_schema: {
      type: "object",
      required: ["topic", "source"],
      properties: {
        topic: {
          type: "string",
          description:
            "Topic / event name. Becomes the folder name under 'Medha/'. " +
            "Examples: 'lightning in a bottle', 'everything night', 'vipassana'.",
        },
        source: {
          type: "string",
          description:
            "Remote URL to fetch and upload (http or https). Local file " +
            "paths are not supported in this environment.",
        },
        type: {
          type: "string",
          enum: ["photo", "video", "audio", "doc", "auto"],
          description: "Content kind. 'auto' infers from the response MIME.",
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
          description: "Optional six-dimension tag for downstream indexing.",
        },
        filename: {
          type: "string",
          description:
            "Optional name for the uploaded file. Defaults to the URL basename.",
        },
      },
    },
  },
  {
    name: "suggest_personal_repurposing",
    description:
      "List the files in the 'Medha/<Topic>' Drive folder and propose 3-5 " +
      "ways Sagar could repurpose that raw content for his own enjoyment " +
      "(default) or for Rytual / BMA channels. Output is a structured " +
      "starter prompt for his creative process, not finished copy.",
    input_schema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: {
          type: "string",
          description:
            "Topic name matching the folder created by ingest_to_drive_folder.",
        },
        audience: {
          type: "string",
          enum: ["personal", "rytual", "bma"],
          description: "Who the repurposing is for. Defaults to 'personal'.",
        },
        format: {
          type: "string",
          enum: ["video_short", "carousel", "blog", "any"],
          description:
            "Preferred output format. 'any' lets the suggester pick.",
        },
      },
    },
  },
];

// ─── Drive helpers ───────────────────────────────────────────────────────────

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

async function findFolder(token, name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  const parentClause = parentId
    ? ` and '${parentId}' in parents`
    : " and 'root' in parents";
  const q =
    `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false` +
    parentClause;
  const data = await driveGet("files", token, {
    q,
    fields: "files(id,name,webViewLink)",
    pageSize: "1",
  });
  return data.files?.[0] || null;
}

async function createFolder(token, name, parentId) {
  const metadata = { name, mimeType: FOLDER_MIME };
  if (parentId) metadata.parents = [parentId];
  const res = await fetch(`${DRIVE_BASE}files?fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive create folder failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function ensureTopicFolder(token, topic) {
  let root = await findFolder(token, ROOT_FOLDER_NAME, null);
  if (!root) root = await createFolder(token, ROOT_FOLDER_NAME, null);
  let topicFolder = await findFolder(token, topic, root.id);
  if (!topicFolder) topicFolder = await createFolder(token, topic, root.id);
  return { root, topicFolder };
}

function inferMimeFromUrl(url) {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return null;
}

function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "ingested-file";
  } catch {
    return "ingested-file";
  }
}

function suggestedTagsFor(topic, dimension) {
  const tags = [topic.toLowerCase().replace(/\s+/g, "-")];
  if (dimension) tags.push(dimension);
  tags.push("raw");
  return tags;
}

async function uploadBinary(token, { folderId, name, mimeType, bytes }) {
  const boundary = "content_loop_boundary";
  const metadata = { name, mimeType, parents: [folderId] };
  const metadataPart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    "\r\n";
  const dataPartHeader =
    `--${boundary}\r\n` + `Content-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const enc = new TextEncoder();
  const head = enc.encode(metadataPart + dataPartHeader);
  const tail = enc.encode(closing);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch(
    `${UPLOAD_BASE}files?uploadType=multipart&fields=id,name,mimeType,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Implementations ─────────────────────────────────────────────────────────

async function ingestToDriveFolder(input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const { topic, source, type = "auto", dimension, filename } = input || {};

  if (!topic || typeof topic !== "string") {
    return { error: "topic is required" };
  }
  if (!source || typeof source !== "string") {
    return { error: "source is required (remote URL)" };
  }
  if (type && !ALLOWED_TYPES.has(type)) {
    return { error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}` };
  }
  if (dimension && !ALLOWED_DIMENSIONS.has(dimension)) {
    return {
      error: `dimension must be one of: ${[...ALLOWED_DIMENSIONS].join(", ")}`,
    };
  }
  if (!/^https?:\/\//i.test(source)) {
    return {
      error:
        "source must be an http(s) URL. Local paths are not reachable from " +
        "the agent runtime — re-upload as a temporary URL first.",
    };
  }

  let token;
  try {
    token = await getGoogleAccessToken(tenant, "drive");
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  const fetchRes = await fetch(source);
  if (!fetchRes.ok) {
    return {
      error: `failed to fetch source (${fetchRes.status} ${fetchRes.statusText})`,
    };
  }
  const headerMime = fetchRes.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim();
  const mimeType =
    headerMime || inferMimeFromUrl(source) || "application/octet-stream";

  const arrayBuf = await fetchRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  const { topicFolder } = await ensureTopicFolder(token, topic);
  const finalName = filename || basenameFromUrl(source);

  const uploaded = await uploadBinary(token, {
    folderId: topicFolder.id,
    name: finalName,
    mimeType,
    bytes,
  });

  return {
    ok: true,
    uploaded_to: topicFolder.webViewLink,
    folder_id: topicFolder.id,
    folder_name: topicFolder.name,
    file_id: uploaded.id,
    file_name: uploaded.name,
    file_mime: uploaded.mimeType,
    file_view_link: uploaded.webViewLink,
    inferred_type: classifyType(mimeType),
    size_bytes: bytes.length,
    suggested_tags: suggestedTagsFor(topic, dimension),
  };
}

function classifyType(mimeType) {
  if (!mimeType) return "unknown";
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/") || mimeType.includes("pdf")) return "doc";
  return "unknown";
}

async function listFolderFiles(token, folderId) {
  const data = await driveGet("files", token, {
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });
  return data.files ?? [];
}

function buildRepurposingPrompt({ topic, audience, format, files }) {
  const fileList = files
    .slice(0, 25)
    .map(
      (f, i) =>
        `${i + 1}. ${f.name} (${f.mimeType || "unknown"}, modified ${
          f.modifiedTime || "?"
        })`,
    )
    .join("\n");
  return [
    `Sagar is sitting on a folder of raw content from "${topic}".`,
    `Target audience: ${audience}. Preferred format: ${format}.`,
    "",
    "Files in the folder (most recently modified first):",
    fileList || "(folder is empty)",
    "",
    "Generate 3-5 starter ideas Sagar can riff on. These are PROMPTS for",
    "his creative process, not finished copy. Each idea must be specific to",
    "this content (no generic 'share your story' fluff).",
    "",
    "Return strict JSON, no prose, no code fences:",
    "{",
    '  "ideas": [',
    "    {",
    '      "format": "<video_short|carousel|blog|note|voice_memo>",',
    '      "hook": "<one specific opening line tied to the files>",',
    '      "why_it_lands": "<one sentence on the angle>",',
    '      "est_effort": "<low|medium|high>"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

async function callClaudeForIdeas(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ideas: [],
      note:
        "ANTHROPIC_API_KEY is not set on this service. Wire it via Railway " +
        "to enable AI-generated repurposing ideas.",
    };
  }
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5-20251001";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ideas: [],
        note: `Claude call failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ideas: [], note: "Claude returned no parseable JSON." };
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.ideas)) return { ideas: parsed.ideas };
      return { ideas: [], note: "JSON shape did not contain an ideas array." };
    } catch {
      return { ideas: [], note: "JSON parse failed on Claude output." };
    }
  } catch (e) {
    clearTimeout(timer);
    return { ideas: [], note: `Claude call error: ${e.message}` };
  }
}

async function suggestPersonalRepurposing(input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const { topic, audience = "personal", format = "any" } = input || {};

  if (!topic || typeof topic !== "string") {
    return { error: "topic is required" };
  }
  if (audience && !ALLOWED_AUDIENCES.has(audience)) {
    return {
      error: `audience must be one of: ${[...ALLOWED_AUDIENCES].join(", ")}`,
    };
  }
  if (format && !ALLOWED_FORMATS.has(format)) {
    return {
      error: `format must be one of: ${[...ALLOWED_FORMATS].join(", ")}`,
    };
  }

  let token;
  try {
    token = await getGoogleAccessToken(tenant, "drive");
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  const root = await findFolder(token, ROOT_FOLDER_NAME, null);
  if (!root) {
    return {
      ideas: [],
      source_files: [],
      note:
        "No 'Medha' root folder in Drive yet. Run ingest_to_drive_folder " +
        "first to create the topic folder.",
    };
  }
  const topicFolder = await findFolder(token, topic, root.id);
  if (!topicFolder) {
    return {
      ideas: [],
      source_files: [],
      note:
        `No 'Medha/${topic}' folder in Drive. Run ingest_to_drive_folder ` +
        "to populate it first.",
    };
  }

  const files = await listFolderFiles(token, topicFolder.id);
  const sourceFiles = files.map((f) => ({
    name: f.name,
    url: f.webViewLink,
    mime: f.mimeType,
    modified: f.modifiedTime,
  }));

  if (sourceFiles.length === 0) {
    return {
      topic,
      audience,
      format,
      folder_view_link: topicFolder.webViewLink,
      ideas: [],
      source_files: [],
      note:
        `Folder 'Medha/${topic}' is empty. Ingest a few items via ` +
        "ingest_to_drive_folder and try again.",
    };
  }

  const prompt = buildRepurposingPrompt({ topic, audience, format, files });
  const { ideas, note } = await callClaudeForIdeas(prompt);

  return {
    topic,
    audience,
    format,
    folder_view_link: topicFolder.webViewLink,
    ideas,
    source_files: sourceFiles,
    ...(note ? { note } : {}),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export async function executeContentLoopTool(toolName, input, ctx = {}) {
  switch (toolName) {
    case "ingest_to_drive_folder":
      return ingestToDriveFolder(input, ctx);
    case "suggest_personal_repurposing":
      return suggestPersonalRepurposing(input, ctx);
    default:
      return { error: `unknown content-loop tool: ${toolName}` };
  }
}
