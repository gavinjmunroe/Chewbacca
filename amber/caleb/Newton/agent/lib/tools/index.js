/**
 * Tool aggregator: combines all tool sources into one list for Claude.
 *
 * Native (Composio-free) modules take priority. Composio is kept as a
 * fallback during the migration window but is filtered down to actions
 * that DON'T have a native replacement yet.
 *
 * Native surface:
 *   GitHub, Togari, Peoplerank, Travel, Coordination,
 *   Gmail, Slack, Notion, Linear, LinkedIn, YouTube, Vercel,
 *   Drive, Docs, Sheets, GCal (schedule_event + freebusy + list + reschedule + cancel),
 *   Beads (task_*), Exa (exa_*), Crust (crust_*).
 *
 * Removed:
 *   Todoist — replaced by Beads (task_*). Kept on disk as reference only.
 */

// Native tool modules (preferred)
import { GITHUB_TOOLS } from "./github.js";
import { RAILWAY_TOOLS } from "./railway.js";
import { TOGARI_TOOLS } from "./togari.js";
import { TOGARI_SEARCH_TOOLS } from "./togari-search.js";
import { PEOPLERANK_TOOLS } from "./peoplerank.js";
import { TRAVEL_TOOLS } from "./travel.js";
import { COORDINATION_TOOLS } from "./coordination.js";
import { GMAIL_TOOLS } from "./gmail.js";
import { SLACK_TOOLS } from "./slack.js";
import { NOTION_TOOLS } from "./notion.js";
import { LINEAR_TOOLS } from "./linear.js";
import { LINKEDIN_TOOLS } from "./linkedin.js";
import { YOUTUBE_TOOLS } from "./youtube.js";
import { VERCEL_TOOLS } from "./vercel.js";
import { DRIVE_TOOLS } from "./drive.js";
import { DOCS_TOOLS } from "./docs.js";
import { SHEETS_TOOLS } from "./sheets.js";
// Tab 6 — tenant-scoped workspace docs registry (named Sheet/Doc lookup)
import { WORKSPACE_DOCS_TOOLS } from "./workspace-docs.js";
import { GCAL_TOOLS } from "./gcal.js";
// Tab 25 — block scheduling + focus time (find_free_block, schedule_focus_block, propose_reschedule)
import { CALENDAR_BLOCK_TOOLS } from "./calendar-block.js";
import { MICROSOFT_TOOLS } from "./microsoft.js";
import { TWITTER_TOOLS } from "./twitter.js";
import { BEADS_TOOLS } from "./beads.js";
import { EXA_TOOLS } from "./exa.js";
import { CRUST_TOOLS } from "./crust.js";
import { OCR_TOOLS } from "./ocr.js";
import { CLAUDE_VISION_OCR_TOOLS } from "./claude-vision-ocr.js";
import { PDF_TOOLS } from "./pdf-utils.js";
import { TRANSCRIBE_TOOLS } from "./transcribe.js";
import { TTS_TOOLS } from "./tts.js";
import { WEB_BROWSE_TOOLS } from "./web-browse.js";
import { IMAGE_GEN_TOOLS } from "./image-gen.js";
import { CAROUSEL_TOOLS } from "./generate-carousel.js"; // Tab 28
// Tab 27 - refine an existing image ("make it more blue", "remove the text")
import { IMAGE_EDIT_TOOLS } from "./image-edit.js";
import { PDF_GEN_TOOLS } from "./pdf-gen.js";
// PR-G — DOCX / XLSX / CSV / MD / TXT / JSON / code-file generation. Mirrors
// the pdf-gen pattern: in-process buffer build, stored via image-host,
// auto-attached by the agent's *_url scanner.
import { FILE_GEN_TOOLS } from "./file-gen.js";
import { SMART_HOME_TOOLS } from "./smart-home.js";
import { DM_EACH_TOOLS } from "./dm-each.js";
import { EVENT_TOOLS } from "./events-tool.js";
// flaw #9 — opt-in roster / status diagnostics
import { OPT_IN_STATUS_TOOLS } from "./opt-in-status.js";
// flaws #77 + #85 — undo_last_action + find_my_recent_message
import { MEDHA_UTILITY_TOOLS } from "./medha-utility.js";
// Tab 2 — cross-person reminders
import { REMINDERS_TOOLS } from "./reminders.js";
// Tab 9 — raw content → Drive folder + personal repurposing loop
import { CONTENT_LOOP_TOOLS } from "./content-loop.js";
// Tab 12 — newsletter editor: draft -> hostile-stranger critique -> revise loop
import { NEWSLETTER_EDITOR_TOOLS } from "./newsletter-editor.js";
// Tab 4 — show_team_content aggregator
import { TEAM_CONTENT_TOOLS } from "./team-content.js";
// Tab 3 — investor / event / multi-thread relationship pipelines
import { PIPELINE_TOOLS } from "./pipelines.js";
// Tab 8 follow-up — personal-life (brand decisions, teammate pursuits, journal)
import { PERSONAL_LIFE_TOOLS } from "./personal-life.js";
// T17 — long-form partnerships with append-only history + contact context
import { PARTNERSHIP_TOOLS } from "./partnerships.js";
// Weekly digest tools (summarize_week, weekly_recap...)
import { WEEKLY_TOOLS } from "./weekly.js";
// Tab 9 — search_contacts (unified people graph via amber-id Pinecone)
import { CONTACTS_SEARCH_TOOLS } from "./contacts-search.js";
import { RECALL_BY_DIMENSION_TOOLS } from "./recall-by-dimension.js";
// Tab 32 — relationship trajectory (warming / cooling over time)
import { RELATIONSHIP_TRAJECTORY_TOOLS } from "./relationship-trajectory.js";
// Tab 34 — network-wide PeopleRank + drift alerts
import { PEOPLE_RANK_TOOLS } from "./people-rank.js";
// Tab 33 — contact graph (mutual connections / intro paths / neighborhood)
import { CONTACT_GRAPH_TOOLS } from "./contact-graph.js";
// T15 — personal event + task planning (plan_event, plan_event_add_tasks...)
import { EVENT_PLANNING_TOOLS } from "./event-planning.js";
// Tab 5 — org-scoped asset ingest (tag_asset)
import { TAG_ASSET_TOOLS } from "./tag-asset.js";
// Tab 4 — newsletter section briefs (get_newsletter_brief)
import { NEWSLETTER_TOOLS } from "./newsletter.js";
// Tab 13 — content seed Firestore object + polish pipeline (capture_content_seed, polish_content_seed)
import { POLISH_DRAFT_TOOLS } from "./polish-draft.js";
// Introspection — describe_self enumerates this tenant's live surface
import { INTROSPECTION_TOOLS } from "./introspection.js";
// Tab 20 — forget-on-demand + point-in-time memory snapshots
import { FORGET_MEMORY_TOOLS } from "./forget_memory.js";
import { MEMORY_SNAPSHOT_TOOLS } from "./memory_snapshot.js";
// Tab 24 — code interpreter for inbound XLSX/CSV (analyze_tabular)
import { DATA_ANALYZE_TOOLS } from "./data-analyze.js";

// MCP-native tools (Perplexity search, contacts, memory, health).
// These live in lib/mcp/tools.js and use the MCP-style `inputSchema` key,
// which we normalize to Claude's `input_schema` below.
import { MCP_TOOLS } from "../mcp/tools.js";

// Composio fallback (shrinking surface — only actions with no native replacement)
import { getComposioTools } from "./composio.js";

// Normalize MCP-style tool schemas to Claude Agent API format:
// { name, description, inputSchema } → { name, description, input_schema }
function normalizeMcpTool(t) {
  if (!t) return t;
  if (t.input_schema) return t;
  if (t.inputSchema)
    return {
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    };
  return t;
}

// Composio action prefixes that now have native replacements.
// These are FILTERED OUT so Claude only sees the native versions.
const COMPOSIO_SUPERSEDED = [
  "GMAIL_",
  "GOOGLECALENDAR_",
  "GOOGLEDRIVE_",
  "GOOGLEDOCS_",
  "GOOGLESHEETS_",
  "LINKEDIN_",
  "YOUTUBE_",
  "VERCEL_",
  "TODOIST_", // Todoist → Beads
  "NOTION_",
  "SLACK_",
  "LINEAR_",
  // Microsoft Graph natives now own outlook_*, mscal_*, onedrive_*, teams_*.
  // Filter any Composio MS Graph variants so the model only sees ours.
  "OUTLOOK_",
  "MICROSOFT_OUTLOOK_",
  "MICROSOFTOUTLOOK_",
  "MICROSOFT_TEAMS_",
  "MICROSOFTTEAMS_",
  "TEAMS_",
  "ONEDRIVE_",
  "MICROSOFTCALENDAR_",
  "OFFICE365_",
];

function isSupersededByNative(toolName) {
  const upper = String(toolName || "").toUpperCase();
  return COMPOSIO_SUPERSEDED.some((p) => upper.startsWith(p));
}

export async function getAllTools() {
  const composio = await getComposioTools();

  // Drop composio tools that collide with native modules.
  const composioRemaining = composio.filter(
    (t) => !isSupersededByNative(t.name),
  );

  const all = [
    // Native first — they win on any name collision via dedup below.
    ...GITHUB_TOOLS,
    ...RAILWAY_TOOLS,
    ...TOGARI_TOOLS,
    ...TOGARI_SEARCH_TOOLS,
    ...PEOPLERANK_TOOLS,
    ...TRAVEL_TOOLS,
    ...COORDINATION_TOOLS,
    ...GMAIL_TOOLS,
    ...SLACK_TOOLS,
    ...NOTION_TOOLS,
    ...LINEAR_TOOLS,
    ...LINKEDIN_TOOLS,
    ...YOUTUBE_TOOLS,
    ...VERCEL_TOOLS,
    ...DRIVE_TOOLS,
    ...DOCS_TOOLS,
    ...SHEETS_TOOLS,
    ...WORKSPACE_DOCS_TOOLS, // Tab 6 — workspace_list_docs + workspace_read_doc
    ...GCAL_TOOLS,
    ...CALENDAR_BLOCK_TOOLS,
    ...MICROSOFT_TOOLS,
    ...TWITTER_TOOLS,
    ...BEADS_TOOLS,
    ...EXA_TOOLS,
    ...CRUST_TOOLS,
    ...OCR_TOOLS,
    ...CLAUDE_VISION_OCR_TOOLS,
    ...PDF_TOOLS,
    ...TRANSCRIBE_TOOLS,
    ...TTS_TOOLS,
    ...WEB_BROWSE_TOOLS,
    ...IMAGE_GEN_TOOLS,
    ...CAROUSEL_TOOLS, // Tab 28 — multi-slide LinkedIn carousels
    ...IMAGE_EDIT_TOOLS, // Tab 27 - edit_image (iterate on an existing image)
    ...PDF_GEN_TOOLS,
    ...FILE_GEN_TOOLS, // PR-G: docx, xlsx, csv, md, txt, json, code_file
    ...SMART_HOME_TOOLS,
    // Trip planning / group coordination tools (decisions 1, 5, 14)
    ...DM_EACH_TOOLS,
    ...EVENT_TOOLS,
    ...OPT_IN_STATUS_TOOLS, // flaw #9
    ...MEDHA_UTILITY_TOOLS, // flaws #77 + #85
    ...REMINDERS_TOOLS, // Tab 2 — schedule_reminder
    ...CONTENT_LOOP_TOOLS, // Tab 9
    ...NEWSLETTER_EDITOR_TOOLS, // Tab 12 — edit_for_newsletter critique loop
    ...TEAM_CONTENT_TOOLS, // Tab 4 — show_team_content
    ...PIPELINE_TOOLS, // Tab 3: investor / event / relationship pipelines
    ...PERSONAL_LIFE_TOOLS, // Tab 8 follow-up: brand decisions, teammate pursuits, journal
    ...PARTNERSHIP_TOOLS, // T17: track/append/recall partnerships + update_contact_context
    ...WEEKLY_TOOLS, // summarize_week + future weekly_recap
    ...CONTACTS_SEARCH_TOOLS, // Tab 9 — search_contacts
    ...RECALL_BY_DIMENSION_TOOLS, // Tab 18 — recall_by_dimension
    ...RELATIONSHIP_TRAJECTORY_TOOLS, // Tab 32 — relationship_trajectory
    ...PEOPLE_RANK_TOOLS, // Tab 34 — people_rank (network ranking + drift)
    ...CONTACT_GRAPH_TOOLS, // Tab 33 — contact_graph (mutual / intro_path / neighborhood)
    ...EVENT_PLANNING_TOOLS, // T15: personal event + task planning
    ...TAG_ASSET_TOOLS, // Tab 5: org-scoped media ingest with follow-up questions
    ...NEWSLETTER_TOOLS, // Tab 4 — newsletter section briefs (get_newsletter_brief)
    ...POLISH_DRAFT_TOOLS, // Tab 13: content seed capture + polish pipeline
    ...INTROSPECTION_TOOLS, // describe_self: tenant-scoped live surface
    ...FORGET_MEMORY_TOOLS, // Tab 20 — forget_memory
    ...MEMORY_SNAPSHOT_TOOLS, // Tab 20 — memory_snapshot
    ...DATA_ANALYZE_TOOLS, // Tab 24 — analyze_tabular (XLSX/CSV code interpreter)
    // MCP-native search/memory/health/contacts. Normalized so Claude
    // sees them as valid Agent API tools (input_schema, not inputSchema).
    ...MCP_TOOLS.map(normalizeMcpTool),
    // Composio last — only non-superseded actions remain.
    ...composioRemaining,
  ];

  const seen = new Set();
  return all.filter((t) => {
    if (!t || !t.name) return false;
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}
