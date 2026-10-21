/**
 * notion.js — Notion REST integration for Medha, backed by per-tenant OAuth.
 *
 * Auth:
 *   - NOTION_OAUTH_ACCESS secret (long-lived bearer; Notion does NOT issue
 *     refresh tokens, see medha-id src/oauth/notion/callback.js).
 *     Legacy NOTION_API_KEY (internal-integration token) is honored as a
 *     fallback so any tenant on the old path keeps working until they
 *     reconnect via OAuth.
 *
 * Coverage:
 *   Mirrors the open-source `notion-cli` resource families (pages, databases,
 *   blocks, comments, users, search) plus a couple of agent-friendly extras
 *   (page-to-markdown recursive render, paginated property reads). Workers,
 *   raw API passthrough, and file uploads are out of scope here.
 *
 * Required header on every request: Notion-Version: 2022-06-28
 * Endpoint base: https://api.notion.com/v1/
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Notion",
  "Search, read, and create Notion pages and databases",
);
registerCapability(
  "_tools_Notion",
  "Edit blocks, manage comments, archive and restore pages, query databases with filters",
);
registerCapability(
  "_tools_Notion",
  "List and inspect workspace users, create and update database schemas",
);

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const MARKDOWN_MAX_BLOCKS = 400;
const MARKDOWN_MAX_DEPTH = 4;

// ── Token resolution ──────────────────────────────────────────────────────────

async function getApiKey(tenant) {
  const oauthToken = await getSecret(tenant, "NOTION_OAUTH_ACCESS");
  if (oauthToken) return oauthToken;
  return getSecret(tenant, "NOTION_API_KEY");
}

function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL ||
    "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

function notConnected() {
  const url = connectPageUrl();
  return {
    error: "notion_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Notion isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

// ── Core HTTP client ──────────────────────────────────────────────────────────

async function notionRequest({ token, method, path, body, query }) {
  let url = `${NOTION_BASE}${path}`;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg = data?.message || data?.code || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: errMsg };
  }

  return { ok: true, status: res.status, data };
}

async function paginate({ token, method, path, body, query, max = 200 }) {
  const results = [];
  let cursor;
  let pages = 0;
  while (true) {
    const next = { ...(body || {}) };
    const nextQuery = { ...(query || {}) };
    if (cursor) {
      if (method === "POST") next.start_cursor = cursor;
      else nextQuery.start_cursor = cursor;
    }
    const r = await notionRequest({
      token,
      method,
      path,
      body: method === "POST" ? next : undefined,
      query: method === "GET" ? nextQuery : undefined,
    });
    if (!r.ok) return r;
    const batch = r.data?.results || [];
    results.push(...batch);
    pages++;
    if (!r.data?.has_more || results.length >= max || pages >= 20) break;
    cursor = r.data.next_cursor;
    if (!cursor) break;
  }
  return { ok: true, status: 200, data: { results, has_more: false } };
}

// ── Content + property helpers ────────────────────────────────────────────────

function textToBlocks(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: para.slice(0, 2000) } }],
      },
    }));
}

function richTextToPlain(rich) {
  if (!Array.isArray(rich)) return "";
  return rich.map((r) => r.plain_text || r.text?.content || "").join("");
}

function titleProperty(title) {
  return {
    title: {
      title: [{ type: "text", text: { content: title } }],
    },
  };
}

function summarisePage(page) {
  const titleProp =
    page.properties?.title ||
    page.properties?.Name ||
    Object.values(page.properties || {}).find((p) => p.type === "title");
  const title = richTextToPlain(titleProp?.title) || "(untitled)";
  return {
    id: page.id,
    title,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    archived: page.archived,
    parentType: page.parent?.type,
    parentId:
      page.parent?.database_id ||
      page.parent?.page_id ||
      page.parent?.workspace,
  };
}

function summariseDatabase(db) {
  return {
    id: db.id,
    title: richTextToPlain(db.title) || "(untitled db)",
    url: db.url,
    createdTime: db.created_time,
    lastEditedTime: db.last_edited_time,
    archived: db.archived,
    properties: Object.entries(db.properties || {}).map(([name, p]) => ({
      name,
      type: p.type,
    })),
  };
}

function summariseUser(u) {
  return {
    id: u.id,
    name: u.name,
    type: u.type,
    avatarUrl: u.avatar_url,
    email: u.person?.email || null,
    botOwner: u.bot?.owner?.type || null,
    workspaceName: u.bot?.workspace_name || null,
  };
}

function summariseComment(c) {
  return {
    id: c.id,
    parentId: c.parent?.page_id || c.parent?.block_id,
    discussionId: c.discussion_id,
    createdTime: c.created_time,
    createdBy: c.created_by?.id,
    text: richTextToPlain(c.rich_text),
  };
}

function blockToMarkdownLine(b) {
  const text = (k) => richTextToPlain(b[k]?.rich_text);
  switch (b.type) {
    case "heading_1":
      return `# ${text("heading_1")}`;
    case "heading_2":
      return `## ${text("heading_2")}`;
    case "heading_3":
      return `### ${text("heading_3")}`;
    case "bulleted_list_item":
      return `- ${text("bulleted_list_item")}`;
    case "numbered_list_item":
      return `1. ${text("numbered_list_item")}`;
    case "to_do":
      return `- [${b.to_do?.checked ? "x" : " "}] ${text("to_do")}`;
    case "toggle":
      return `<details><summary>${text("toggle")}</summary></details>`;
    case "quote":
      return `> ${text("quote")}`;
    case "callout":
      return `> ${b.callout?.icon?.emoji || ""} ${text("callout")}`.trim();
    case "code": {
      const lang = b.code?.language || "";
      return `\`\`\`${lang}\n${text("code")}\n\`\`\``;
    }
    case "divider":
      return `---`;
    case "paragraph":
      return text("paragraph");
    case "image": {
      const f = b.image?.file?.url || b.image?.external?.url;
      return f ? `![](${f})` : "";
    }
    case "bookmark":
      return b.bookmark?.url ? `[${b.bookmark.url}](${b.bookmark.url})` : "";
    case "child_page":
      return `[page] ${b.child_page?.title || ""}`;
    case "child_database":
      return `[database] ${b.child_database?.title || ""}`;
    default:
      return "";
  }
}

// ── Page handlers ─────────────────────────────────────────────────────────────

async function searchNotion(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = { query: input.query, page_size: input.limit || 20 };
  if (input.filterObject)
    body.filter = { value: input.filterObject, property: "object" };
  if (input.sort)
    body.sort = { direction: input.sort, timestamp: "last_edited_time" };
  const r = await notionRequest({
    token,
    method: "POST",
    path: "/search",
    body,
  });
  if (!r.ok) return { error: r.error };
  const results = (r.data.results || []).map((obj) => {
    if (obj.object === "page") return { type: "page", ...summarisePage(obj) };
    if (obj.object === "database")
      return { type: "database", ...summariseDatabase(obj) };
    return { type: obj.object, id: obj.id };
  });
  return { query: input.query, count: results.length, results };
}

async function getPage(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "GET",
    path: `/pages/${input.pageId}`,
  });
  if (!r.ok) return { error: r.error };
  const page = summarisePage(r.data);

  const blocksR = await notionRequest({
    token,
    method: "GET",
    path: `/blocks/${input.pageId}/children`,
  });
  if (blocksR.ok) {
    page.blocks = (blocksR.data.results || []).slice(0, 30).map((b) => ({
      type: b.type,
      text: blockToMarkdownLine(b),
    }));
  }
  return { page };
}

async function createPage(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const parent = input.databaseId
    ? { database_id: input.databaseId }
    : { page_id: input.parentId };
  const body = {
    parent,
    properties: input.properties || titleProperty(input.title || "(untitled)"),
  };
  if (input.content) body.children = textToBlocks(input.content);
  if (input.icon) body.icon = input.icon;
  if (input.cover) body.cover = input.cover;
  const r = await notionRequest({
    token,
    method: "POST",
    path: "/pages",
    body,
  });
  if (!r.ok) return { error: r.error };
  return { created: true, page: summarisePage(r.data) };
}

async function updatePage(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = {};
  if (input.properties) body.properties = input.properties;
  if (input.icon !== undefined) body.icon = input.icon;
  if (input.cover !== undefined) body.cover = input.cover;
  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/pages/${input.pageId}`,
    body,
  });
  if (!r.ok) return { error: r.error };
  return { updated: true, page: summarisePage(r.data) };
}

async function archivePage(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/pages/${input.pageId}`,
    body: { archived: true },
  });
  if (!r.ok) return { error: r.error };
  return { archived: true, page: summarisePage(r.data) };
}

async function restorePage(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/pages/${input.pageId}`,
    body: { archived: false },
  });
  if (!r.ok) return { error: r.error };
  return { restored: true, page: summarisePage(r.data) };
}

async function getPageProperty(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await paginate({
    token,
    method: "GET",
    path: `/pages/${input.pageId}/properties/${input.propertyId}`,
    max: 100,
  });
  if (!r.ok) return { error: r.error };
  return { propertyId: input.propertyId, items: r.data.results };
}

async function pageToMarkdown(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();

  const pageR = await notionRequest({
    token,
    method: "GET",
    path: `/pages/${input.pageId}`,
  });
  if (!pageR.ok) return { error: pageR.error };

  let blockCount = 0;
  async function renderChildren(parentId, depth) {
    if (depth > MARKDOWN_MAX_DEPTH) return [];
    if (blockCount >= MARKDOWN_MAX_BLOCKS) return [];
    const r = await paginate({
      token,
      method: "GET",
      path: `/blocks/${parentId}/children`,
      max: MARKDOWN_MAX_BLOCKS,
    });
    if (!r.ok) return [];
    const lines = [];
    for (const b of r.data.results) {
      if (blockCount >= MARKDOWN_MAX_BLOCKS) {
        lines.push("...(truncated)");
        break;
      }
      blockCount++;
      const indent = "  ".repeat(depth);
      const line = blockToMarkdownLine(b);
      if (line) lines.push(indent + line);
      if (b.has_children) {
        const childLines = await renderChildren(b.id, depth + 1);
        lines.push(...childLines);
      }
    }
    return lines;
  }

  const body = await renderChildren(input.pageId, 0);
  const page = summarisePage(pageR.data);
  const markdown = `# ${page.title}\n\n${body.join("\n\n")}`;
  return {
    page,
    markdown,
    blockCount,
    truncated: blockCount >= MARKDOWN_MAX_BLOCKS,
  };
}

// ── Block handlers ────────────────────────────────────────────────────────────

async function getBlock(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "GET",
    path: `/blocks/${input.blockId}`,
  });
  if (!r.ok) return { error: r.error };
  return { block: r.data };
}

async function getBlockChildren(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await paginate({
    token,
    method: "GET",
    path: `/blocks/${input.blockId}/children`,
    max: input.max || 200,
  });
  if (!r.ok) return { error: r.error };
  const blocks = r.data.results.map((b) => ({
    id: b.id,
    type: b.type,
    hasChildren: b.has_children,
    text: blockToMarkdownLine(b),
  }));
  return { parentId: input.blockId, count: blocks.length, blocks };
}

async function appendBlock(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const blocks = textToBlocks(input.content);
  if (blocks.length === 0) return { error: "content is empty or invalid" };
  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/blocks/${input.pageId}/children`,
    body: { children: blocks },
  });
  if (!r.ok) return { error: r.error };
  return {
    appended: true,
    pageId: input.pageId,
    blocksAdded: blocks.length,
    results: (r.data.results || []).map((b) => b.id),
  };
}

async function updateBlock(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();

  let body = input.body;
  if (!body && input.text) {
    const blockR = await notionRequest({
      token,
      method: "GET",
      path: `/blocks/${input.blockId}`,
    });
    if (!blockR.ok) return { error: blockR.error };
    const type = blockR.data.type;
    const rich = [
      { type: "text", text: { content: String(input.text).slice(0, 2000) } },
    ];
    body = { [type]: { rich_text: rich } };
  }
  if (!body) return { error: "must supply text or body" };

  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/blocks/${input.blockId}`,
    body,
  });
  if (!r.ok) return { error: r.error };
  return { updated: true, block: r.data };
}

async function deleteBlock(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "DELETE",
    path: `/blocks/${input.blockId}`,
  });
  if (!r.ok) return { error: r.error };
  return { deleted: true, blockId: input.blockId };
}

// ── Database handlers ─────────────────────────────────────────────────────────

async function listDatabases(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "POST",
    path: "/search",
    body: {
      filter: { value: "database", property: "object" },
      page_size: input.limit || 50,
    },
  });
  if (!r.ok) return { error: r.error };
  const databases = (r.data.results || []).map(summariseDatabase);
  return { databases, count: databases.length };
}

async function queryDatabase(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = { page_size: input.limit || 50 };
  if (input.filter) body.filter = input.filter;
  if (input.sorts) body.sorts = input.sorts;
  if (input.startCursor) body.start_cursor = input.startCursor;
  const r = await notionRequest({
    token,
    method: "POST",
    path: `/databases/${input.databaseId}/query`,
    body,
  });
  if (!r.ok) return { error: r.error };
  const rows = (r.data.results || []).map(summarisePage);
  return {
    databaseId: input.databaseId,
    rows,
    count: rows.length,
    hasMore: r.data.has_more,
    nextCursor: r.data.next_cursor,
  };
}

async function getDatabase(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "GET",
    path: `/databases/${input.databaseId}`,
  });
  if (!r.ok) return { error: r.error };
  return { database: summariseDatabase(r.data), raw: r.data };
}

async function createDatabase(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = {
    parent: { type: "page_id", page_id: input.parentPageId },
    title: [{ type: "text", text: { content: input.title } }],
    properties: input.properties || { Name: { title: {} } },
  };
  if (input.icon) body.icon = input.icon;
  if (input.cover) body.cover = input.cover;
  const r = await notionRequest({
    token,
    method: "POST",
    path: "/databases",
    body,
  });
  if (!r.ok) return { error: r.error };
  return { created: true, database: summariseDatabase(r.data) };
}

async function updateDatabase(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = {};
  if (input.title)
    body.title = [{ type: "text", text: { content: input.title } }];
  if (input.properties) body.properties = input.properties;
  if (input.archived !== undefined) body.archived = input.archived;
  const r = await notionRequest({
    token,
    method: "PATCH",
    path: `/databases/${input.databaseId}`,
    body,
  });
  if (!r.ok) return { error: r.error };
  return { updated: true, database: summariseDatabase(r.data) };
}

// ── Comment handlers ──────────────────────────────────────────────────────────

async function listComments(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await paginate({
    token,
    method: "GET",
    path: `/comments`,
    query: { block_id: input.blockId },
    max: 100,
  });
  if (!r.ok) return { error: r.error };
  const comments = r.data.results.map(summariseComment);
  return { blockId: input.blockId, count: comments.length, comments };
}

async function addComment(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const body = {
    rich_text: [{ type: "text", text: { content: input.text } }],
  };
  if (input.discussionId) {
    body.discussion_id = input.discussionId;
  } else if (input.pageId) {
    body.parent = { page_id: input.pageId };
  } else {
    return {
      error: "must supply pageId (new thread) or discussionId (reply)",
    };
  }
  const r = await notionRequest({
    token,
    method: "POST",
    path: "/comments",
    body,
  });
  if (!r.ok) return { error: r.error };
  return { posted: true, comment: summariseComment(r.data) };
}

// ── User handlers ─────────────────────────────────────────────────────────────

async function notionMe(_input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({ token, method: "GET", path: "/users/me" });
  if (!r.ok) return { error: r.error };
  return { me: summariseUser(r.data), raw: r.data };
}

async function listUsers(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await paginate({
    token,
    method: "GET",
    path: "/users",
    max: input.max || 100,
  });
  if (!r.ok) return { error: r.error };
  const users = r.data.results.map(summariseUser);
  return { count: users.length, users };
}

async function getUser(input, ctx) {
  const token = await getApiKey(ctx.tenant);
  if (!token) return notConnected();
  const r = await notionRequest({
    token,
    method: "GET",
    path: `/users/${input.userId}`,
  });
  if (!r.ok) return { error: r.error };
  return { user: summariseUser(r.data) };
}

// ── Tool definitions (Claude format) ─────────────────────────────────────────

export const NOTION_TOOLS = [
  {
    name: "notion_search",
    description:
      "Search across all pages and databases the user's Notion workspace has shared with the Medha integration. Optionally restrict to one object type and sort by last edited time.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term." },
        filterObject: {
          type: "string",
          enum: ["page", "database"],
          description: "Optionally restrict results to pages or databases.",
        },
        sort: {
          type: "string",
          enum: ["ascending", "descending"],
          description: "Sort by last_edited_time direction.",
        },
        limit: { type: "number", description: "Max results (default 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "notion_get_page",
    description:
      "Fetch a Notion page (metadata + up to 30 inline blocks). For full markdown of long pages use notion_page_to_markdown.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Notion page ID (UUID)." },
      },
      required: ["pageId"],
    },
  },
  {
    name: "notion_page_to_markdown",
    description:
      "Render a Notion page and its nested children as readable Markdown so Medha can quote, summarise, or analyse the content. Caps at 400 blocks and 4 nesting levels to stay responsive.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Notion page ID (UUID)." },
      },
      required: ["pageId"],
    },
  },
  {
    name: "notion_get_page_property",
    description:
      "Paginate through a single page property (useful for relations, rollups, or very long rich_text fields whose value would otherwise be truncated).",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        propertyId: {
          type: "string",
          description: "Property ID from the database schema.",
        },
      },
      required: ["pageId", "propertyId"],
    },
  },

  {
    name: "notion_create_page",
    description:
      "Create a new Notion page under either another page (parentId) or as a row in a database (databaseId). Optionally pass properties (database-specific schema) or content (paragraphs separated by blank lines).",
    input_schema: {
      type: "object",
      properties: {
        parentId: {
          type: "string",
          description: "Parent page ID (set this OR databaseId).",
        },
        databaseId: {
          type: "string",
          description: "Parent database ID (creates a row).",
        },
        title: {
          type: "string",
          description: "Page title (used when properties is omitted).",
        },
        properties: {
          type: "object",
          description:
            "Full Notion properties object (overrides title shortcut).",
        },
        content: {
          type: "string",
          description: "Plain text body (paragraphs split on blank lines).",
        },
        icon: { type: "object", description: "Optional icon object." },
        cover: { type: "object", description: "Optional cover object." },
      },
    },
  },
  {
    name: "notion_update_page",
    description:
      "Update properties, icon, or cover on an existing Notion page (e.g. flip a Status select, set a date, change the assignee).",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        properties: {
          type: "object",
          description:
            'Notion properties patch. Example: { "Status": { "select": { "name": "Done" } } }.',
        },
        icon: { type: "object" },
        cover: { type: "object" },
      },
      required: ["pageId"],
    },
  },
  {
    name: "notion_archive_page",
    description:
      "Archive (soft-delete) a Notion page. Reversible with notion_restore_page.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
    },
  },
  {
    name: "notion_restore_page",
    description: "Restore a previously archived Notion page.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
    },
  },

  {
    name: "notion_get_block",
    description: "Fetch a single Notion block by ID.",
    input_schema: {
      type: "object",
      properties: { blockId: { type: "string" } },
      required: ["blockId"],
    },
  },
  {
    name: "notion_get_block_children",
    description:
      "List the children of a page or block, paginated. Returns up to `max` blocks (default 200) with type plus text snippet.",
    input_schema: {
      type: "object",
      properties: {
        blockId: {
          type: "string",
          description: "Parent page or block ID.",
        },
        max: {
          type: "number",
          description: "Cap on total blocks returned (default 200).",
        },
      },
      required: ["blockId"],
    },
  },
  {
    name: "notion_append_block",
    description:
      "Append text content as paragraph blocks to an existing Notion page. Paragraphs are split on blank lines.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        content: { type: "string" },
      },
      required: ["pageId", "content"],
    },
  },
  {
    name: "notion_update_block",
    description:
      "Update a block. Pass `text` for a quick rich_text replacement (Medha reads the block type first), or supply a full `body` for fine-grained control.",
    input_schema: {
      type: "object",
      properties: {
        blockId: { type: "string" },
        text: {
          type: "string",
          description:
            "Convenience: replace rich_text on the existing block type.",
        },
        body: {
          type: "object",
          description:
            "Raw PATCH body (overrides text). Example: { paragraph: { rich_text: [...] } }.",
        },
      },
      required: ["blockId"],
    },
  },
  {
    name: "notion_delete_block",
    description:
      "Archive a block (Notion's API soft-deletes via DELETE /blocks/:id).",
    input_schema: {
      type: "object",
      properties: { blockId: { type: "string" } },
      required: ["blockId"],
    },
  },

  {
    name: "notion_list_databases",
    description:
      "List the databases the user has shared with the Medha integration (top 50 by default).",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "notion_get_database",
    description:
      "Fetch a database's schema and metadata (returns summarised properties plus the raw payload for callers that need full type info).",
    input_schema: {
      type: "object",
      properties: { databaseId: { type: "string" } },
      required: ["databaseId"],
    },
  },
  {
    name: "notion_query_database",
    description:
      "Query a Notion database with filters and sorts. Returns up to `limit` rows plus pagination cursor.",
    input_schema: {
      type: "object",
      properties: {
        databaseId: { type: "string" },
        filter: {
          type: "object",
          description:
            'Notion filter object. Example: { "property": "Status", "select": { "equals": "In Progress" } }.',
        },
        sorts: {
          type: "array",
          description:
            'Notion sort array. Example: [{ "property": "Date", "direction": "descending" }].',
        },
        limit: { type: "number" },
        startCursor: { type: "string" },
      },
      required: ["databaseId"],
    },
  },
  {
    name: "notion_create_database",
    description:
      "Create a new database as a child of an existing page. Supply the parent page ID, title, and a properties schema.",
    input_schema: {
      type: "object",
      properties: {
        parentPageId: { type: "string" },
        title: { type: "string" },
        properties: {
          type: "object",
          description:
            'Property schema. Defaults to { Name: { title: {} } } if omitted. Example: { Name: { title: {} }, Status: { select: { options: [{ name: "Open" }, { name: "Done" }] } } }.',
        },
        icon: { type: "object" },
        cover: { type: "object" },
      },
      required: ["parentPageId", "title"],
    },
  },
  {
    name: "notion_update_database",
    description:
      "Patch a database's title, schema, or archived state. Only the fields you pass are changed.",
    input_schema: {
      type: "object",
      properties: {
        databaseId: { type: "string" },
        title: { type: "string" },
        properties: { type: "object" },
        archived: { type: "boolean" },
      },
      required: ["databaseId"],
    },
  },

  {
    name: "notion_list_comments",
    description:
      "List comments attached to a page or block. Pass the page or block ID as blockId.",
    input_schema: {
      type: "object",
      properties: {
        blockId: {
          type: "string",
          description: "Page or block ID to read comments for.",
        },
      },
      required: ["blockId"],
    },
  },
  {
    name: "notion_add_comment",
    description:
      "Post a new comment. For a new thread pass pageId; to reply to an existing thread pass discussionId.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        pageId: {
          type: "string",
          description: "Start a new thread on this page.",
        },
        discussionId: {
          type: "string",
          description: "Reply into this existing thread.",
        },
      },
      required: ["text"],
    },
  },

  {
    name: "notion_me",
    description:
      "Return the bot user info for the current Notion integration (workspace name, owner email, bot id).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "notion_list_users",
    description:
      "List members of the connected Notion workspace (people plus integrations). Paginated, default cap 100.",
    input_schema: {
      type: "object",
      properties: { max: { type: "number" } },
    },
  },
  {
    name: "notion_get_user",
    description: "Fetch a single Notion user by ID.",
    input_schema: {
      type: "object",
      properties: { userId: { type: "string" } },
      required: ["userId"],
    },
  },
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeNotionTool(toolName, input, ctx) {
  console.log(`[notion] ${toolName}`);
  try {
    switch (toolName) {
      case "notion_search":
        return await searchNotion(input, ctx);
      case "notion_get_page":
        return await getPage(input, ctx);
      case "notion_page_to_markdown":
        return await pageToMarkdown(input, ctx);
      case "notion_get_page_property":
        return await getPageProperty(input, ctx);
      case "notion_create_page":
        return await createPage(input, ctx);
      case "notion_update_page":
        return await updatePage(input, ctx);
      case "notion_archive_page":
        return await archivePage(input, ctx);
      case "notion_restore_page":
        return await restorePage(input, ctx);
      case "notion_get_block":
        return await getBlock(input, ctx);
      case "notion_get_block_children":
        return await getBlockChildren(input, ctx);
      case "notion_append_block":
        return await appendBlock(input, ctx);
      case "notion_update_block":
        return await updateBlock(input, ctx);
      case "notion_delete_block":
        return await deleteBlock(input, ctx);
      case "notion_list_databases":
        return await listDatabases(input, ctx);
      case "notion_get_database":
        return await getDatabase(input, ctx);
      case "notion_query_database":
        return await queryDatabase(input, ctx);
      case "notion_create_database":
        return await createDatabase(input, ctx);
      case "notion_update_database":
        return await updateDatabase(input, ctx);
      case "notion_list_comments":
        return await listComments(input, ctx);
      case "notion_add_comment":
        return await addComment(input, ctx);
      case "notion_me":
        return await notionMe(input, ctx);
      case "notion_list_users":
        return await listUsers(input, ctx);
      case "notion_get_user":
        return await getUser(input, ctx);
      default:
        return { error: `Unknown Notion tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[notion] ${toolName} failed:`, err?.message);
    return { error: err?.message || "notion-tool-error" };
  }
}
