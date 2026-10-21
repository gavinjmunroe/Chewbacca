/**
 * Composio tools: Google Calendar, Gmail, Drive, Docs, Sheets, LinkedIn,
 * Vercel, YouTube integration via Composio SDK.
 */

import { ComposioToolSet } from "composio-core";
import { COMPOSIO_API_KEY, TOOLS_CACHE_DURATION } from "../constants.js";
import { registerCapability } from "../capabilities.js";
import { getSecret } from "../secrets.js";

// Auto-register capabilities from Composio integrations
registerCapability(
  "_tools_Gmail",
  "Read inbox, send emails, draft replies, search contacts",
);
registerCapability(
  "_tools_Google Calendar",
  "Check schedule, create events, find free slots, update/delete events",
);
registerCapability(
  "_tools_Google Drive",
  "Find files, create documents, upload files",
);
registerCapability(
  "_tools_Google Docs",
  "Create and read documents, markdown support",
);
registerCapability(
  "_tools_Google Sheets",
  "Read, write, lookup spreadsheet data",
);
registerCapability(
  "_tools_LinkedIn",
  "Post on Caleb's behalf, get profile and company info",
);
registerCapability(
  "_tools_YouTube",
  "Search videos, get channel stats, list channel videos",
);
registerCapability(
  "_tools_Vercel",
  "Check projects, deployments, project details",
);
registerCapability(
  "_tools_Todoist",
  "Create, complete, update, list tasks and projects",
);

// Default org-level toolset — lazy so module import never throws when
// COMPOSIO_API_KEY is absent (composio-core constructor rejects empty keys).
// Per-tenant action execution goes through toolsetForTenant().
let _composioToolset = null;
export function composioToolsetRef() {
  if (_composioToolset) return _composioToolset;
  if (!COMPOSIO_API_KEY) return null;
  try {
    _composioToolset = new ComposioToolSet({ apiKey: COMPOSIO_API_KEY });
  } catch (err) {
    console.warn("[composio] disabled:", err?.message || err);
    return null;
  }
  return _composioToolset;
}
// Back-compat export: proxy that forwards to the lazy instance.
export const composioToolset = new Proxy({}, {
  get(_t, prop) {
    const ts = composioToolsetRef();
    if (!ts) {
      if (prop === "then") return undefined; // not a thenable
      return () => {
        throw new Error("composio-disabled: COMPOSIO_API_KEY not set");
      };
    }
    const v = ts[prop];
    return typeof v === "function" ? v.bind(ts) : v;
  },
});

// Per-tenant toolset cache keyed by Privy DID. Each tenant has their own
// Composio account / API key so their actions resolve against their own
// connected apps (Gmail, Calendar, etc.).
const toolsetByDid = new Map();

async function toolsetForTenant(tenant) {
  const did = tenant?.privyDid || tenant?.amberId || tenant?.id;
  if (!did) return composioToolsetRef(); // anonymous → default (may be null)
  if (toolsetByDid.has(did)) return toolsetByDid.get(did);
  const apiKey = await getSecret(tenant, "COMPOSIO_API_KEY", {
    fallbackEnv: "COMPOSIO_API_KEY",
  });
  const effective = apiKey || COMPOSIO_API_KEY;
  if (!effective) return null;
  let ts;
  try {
    ts = new ComposioToolSet({ apiKey: effective });
  } catch (err) {
    console.warn("[composio] per-tenant init failed:", err?.message || err);
    return null;
  }
  toolsetByDid.set(did, ts);
  return ts;
}

// Cache for tools
let composioTools = null;
let composioToolsLastFetched = null;

// Composio actions to expose
export const COMPOSIO_ACTIONS = [
  // ── Google Calendar ────────────────────────────────────────────────────
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_CREATE_EVENT",
  "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
  "GOOGLECALENDAR_FIND_FREE_SLOTS",
  "GOOGLECALENDAR_UPDATE_EVENT",
  "GOOGLECALENDAR_DELETE_EVENT",
  "GOOGLECALENDAR_EVENTS_LIST",
  // ── Gmail ──────────────────────────────────────────────────────────────
  "GMAIL_FETCH_EMAILS",
  "GMAIL_SEND_EMAIL",
  "GMAIL_REPLY_TO_THREAD",
  "GMAIL_SEARCH_PEOPLE",
  "GMAIL_CREATE_EMAIL_DRAFT",
  // ── Google Drive ───────────────────────────────────────────────────────
  "GOOGLEDRIVE_FIND_FILE",
  "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
  "GOOGLEDRIVE_UPLOAD_FILE",
  "GOOGLEDRIVE_LIST_FILES",
  // ── Google Docs ────────────────────────────────────────────────────────
  "GOOGLEDOCS_CREATE_DOCUMENT",
  "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
  "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
  // ── Google Sheets ──────────────────────────────────────────────────────
  "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
  "GOOGLESHEETS_VALUES_GET",
  "GOOGLESHEETS_VALUES_UPDATE",
  "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
  // ── LinkedIn ───────────────────────────────────────────────────────────
  "LINKEDIN_GET_MY_INFO",
  "LINKEDIN_CREATE_LINKED_IN_POST",
  "LINKEDIN_GET_COMPANY_INFO",
  // ── Vercel ─────────────────────────────────────────────────────────────
  "VERCEL_GET_PROJECTS",
  "VERCEL_GET_DEPLOYMENTS",
  "VERCEL_GET_PROJECT",
  // ── YouTube ────────────────────────────────────────────────────────────
  "YOUTUBE_SEARCH_YOU_TUBE",
  "YOUTUBE_GET_CHANNEL_STATISTICS",
  "YOUTUBE_LIST_CHANNEL_VIDEOS",
  // ── Slack (multi-platform messaging) ───────────────────────────────────
  "SLACK_SEND_MESSAGE",
  "SLACK_LIST_CHANNELS",
  "SLACK_READ_MESSAGES",
  // ── Notion (knowledge management) ──────────────────────────────────────
  "NOTION_SEARCH",
  "NOTION_CREATE_PAGE",
  "NOTION_GET_PAGE",
  "NOTION_UPDATE_PAGE",
  "NOTION_GET_DATABASE",
  "NOTION_QUERY_DATABASE",
  // ── Linear (project management) ────────────────────────────────────────
  "LINEAR_CREATE_ISSUE",
  "LINEAR_LIST_ISSUES",
  "LINEAR_UPDATE_ISSUE",
  "LINEAR_GET_TEAMS",
  // NOTE: each of the above apps must be connected per-tenant in Composio
  // before actions resolve. Unconnected apps will surface helpful errors.
  // ── Todoist (via Composio, backup to direct API) ───────────────────────
  "TODOIST_GET_ALL_TASKS",
  "TODOIST_CREATE_TASK",
  "TODOIST_CLOSE_TASK",
  "TODOIST_UPDATE_TASK",
  "TODOIST_GET_ALL_PROJECTS",
];

export async function getComposioTools() {
  // Return cached tools if still fresh
  if (
    composioTools &&
    composioToolsLastFetched &&
    Date.now() - composioToolsLastFetched < TOOLS_CACHE_DURATION
  ) {
    return composioTools;
  }

  try {
    console.log("   Loading Composio tools...");

    const composioSchema = await composioToolset.getToolsSchema({
      actions: COMPOSIO_ACTIONS,
    });

    // Convert Composio format to Claude format
    const claudeTools = composioSchema
      .filter((tool) => tool && tool.name)
      .map((tool) => ({
        name: tool.name.toLowerCase(),
        description: tool.description || `Execute ${tool.name}`,
        input_schema: tool.parameters || {
          type: "object",
          properties: {},
          required: [],
        },
      }));

    composioTools = claudeTools;
    composioToolsLastFetched = Date.now();
    console.log(`   Loaded ${claudeTools.length} Composio tools`);

    return claudeTools;
  } catch (error) {
    console.error("   Could not load Composio tools:", error.message);
    return [];
  }
}

/**
 * Dynamic tool discovery: search Composio's 1000+ tools by natural language query.
 * Used to find relevant tools for a specific user request instead of loading all tools upfront.
 */
export async function findRelevantTools(query, maxTools = 5) {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const tools = await composioToolset.findActionEnumsByUseCase({
      useCase: query,
      apps: [
        "googlecalendar",
        "gmail",
        "googledrive",
        "googledocs",
        "googlesheets",
        "linkedin",
        "vercel",
        "youtube",
        "todoist",
        "github",
        "slack",
        "notion",
      ],
    });
    const topTools = (tools || []).slice(0, maxTools);
    if (topTools.length > 0) {
      console.log(
        `[composio-search] Found ${topTools.length} relevant tools for "${query.slice(0, 40)}": ${topTools.join(", ")}`,
      );
      // Fetch schemas for the discovered tools
      const schemas = await composioToolset.getToolsSchema({
        actions: topTools,
      });
      return schemas
        .filter((t) => t && t.name)
        .map((t) => ({
          name: t.name.toLowerCase(),
          description: t.description || `Execute ${t.name}`,
          input_schema: t.parameters || {
            type: "object",
            properties: {},
            required: [],
          },
        }));
    }
    return [];
  } catch (err) {
    console.warn("[composio-search] Tool discovery failed:", err.message);
    return [];
  }
}

export async function executeComposioAction(toolName, toolInput, tenant = null) {
  try {
    console.log(`   Executing Composio ${toolName}...`);

    const toolset = await toolsetForTenant(tenant);
    if (!toolset) {
      throw new Error("composio-disabled: no API key for tenant or org");
    }
    // Each tenant has their own Composio entity; fall back to "default" only
    // when no tenant-specific entity ID is stored.
    const entityId =
      (tenant &&
        (await getSecret(tenant, "COMPOSIO_ENTITY_ID", {
          fallbackEnv: "COMPOSIO_ENTITY_ID",
        }))) ||
      "default";
    const entity = await toolset.getEntity(entityId);

    const result = await toolset.executeAction({
      action: toolName.toUpperCase(),
      params: toolInput,
      entityId: entity.id,
    });

    console.log(`   ${toolName} completed (entity=${entityId})`);
    return result;
  } catch (error) {
    console.error(`   Error executing ${toolName}:`, error.message);
    throw error;
  }
}
