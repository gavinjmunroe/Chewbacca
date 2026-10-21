/**
 * Tool dispatcher — routes a Claude tool_use to the correct native module.
 *
 * Extracted from agent.js to honor the <800-line AGENTS.md rule and to make
 * routing a single-responsibility module that's easy to test and extend.
 *
 * Every branch here must have a matching tool schema registered in
 * lib/tools/index.js getAllTools(), otherwise Claude will never call it.
 *
 * Fallback policy: unknown tool names ARE NOT silently forwarded to
 * Composio. The model can hallucinate tool names, and a catch-all
 * forwarder lets it call arbitrary external actions. Instead, only
 * names that match the Composio allowlist (COMPOSIO_ACTIONS in
 * tiwari/composio.js, plus optional COMPOSIO_EXTRA_TOOLS env override)
 * are forwarded. Anything else returns a structured error so the model
 * can recover.
 */

import { executeGitHubTool, GITHUB_TOOL_NAMES } from "./tools/github.js";
import { executeRailwayTool, RAILWAY_TOOL_NAMES } from "./tools/railway.js";
import { executeBeadsTool } from "./tools/beads.js";
import { executeComposioAction, COMPOSIO_ACTIONS } from "./tiwari/composio.js";
import { executeMcpTool } from "./mcp/tools.js";
import { withAuditLog } from "./middleware/audit.js";
import { withAuthBounce } from "./middleware/auth-bounce.js";
import { withRateLimit } from "./middleware/rate-limit.js";
import { withToolRetry } from "./middleware/tool-retry.js";
import { emitProgress } from "./reply-capture.js";
import { toolProgressLabel } from "./stream-frames.js";

// MCP-native tools (Perplexity search, contacts, memory, health) that
// are defined in lib/mcp/tools.js. MUST be routed here or Camber's tool
// calls to `web_search`/`deep_research` fall through to the Composio
// fallback and silently fail — which is exactly why she was telling
// Caleb "search tool isn't connecting" despite the tool being armed.
const MCP_EXACT_TOOLS = new Set([
  "web_search",
  "deep_research",
  "generate_embeddings",
  "list_contacts",
  "get_contact",
  // NOTE: search_contacts is intentionally NOT here. The MCP handler queries a
  // legacy Supabase `contacts` table that does not hold imported medha-id
  // contacts, so it always returned []. Routing falls through to
  // CONTACTS_SEARCH_EXACT -> executeContactsSearchTool (engine-backed, honors
  // the Sagar's-network test override and actually finds the contacts).
  "update_contact_note",
  "get_conversation",
  "get_recent_interactions",
  "get_health_profile",
  "get_health_history",
  "submit_health_checkin",
  "save_memory",
  "search_memories",
  "add_trip_item",
]);

// GitHub exact-name routes. Imported from the github tool barrel so a
// new tool added in tools/github/tools.js is automatically dispatched
// without a second source-of-truth list here.
const GITHUB_TOOLS = GITHUB_TOOL_NAMES;

const TRAVEL_TOOLS = new Set([
  "create_trip",
  "get_trip",
  "list_trips",
  "add_to_itinerary",
  "add_reservation",
  "add_expense",
  "get_budget_summary",
  "add_packing_item",
  "get_packing_list",
]);

const COORDINATION_TOOLS = new Set([
  "create_group_task",
  "create_poll",
  "vote_poll",
  "group_health_checkin",
  "list_group_tasks",
  "complete_task",
  "schedule_group_event",
  "who_owes_who",
]);

const GCAL_TOOLS = new Set([
  "schedule_event",
  "get_availability",
  "list_events",
  "reschedule_event",
  "cancel_event",
]);

// Tab 25 — block scheduling + focus time. Separate surface from GCAL_TOOLS
// (uses the same gcal client) so the dispatcher routes it to its own module.
const CALENDAR_BLOCK_TOOLS = new Set([
  "find_free_block",
  "schedule_focus_block",
  "propose_reschedule",
]);

const IMAGE_GEN_TOOLS = new Set(["generate_image"]);

// Tab 27 - edit_image (refine an existing image). Exact-name route; it
// shares no prefix with anything else on the surface.
const IMAGE_EDIT_EXACT = new Set(["edit_image"]);

// Tab 28 — multi-slide LinkedIn carousels.
const CAROUSEL_TOOLS = new Set(["generate_carousel"]);

const PDF_GEN_EXACT = new Set(["generate_pdf"]);

// PR-G — file-gen tool surface. All seven generators share one exact-name
// route because they don't share a clean prefix (generate_* would also catch
// generate_pdf and generate_image which are owned by other modules).
const FILE_GEN_EXACT = new Set([
  "generate_docx",
  "generate_xlsx",
  "generate_csv",
  "generate_markdown",
  "generate_md",
  "generate_text",
  "generate_txt",
  "generate_json",
  "generate_code_file",
]);

// flaws #77 + #85 — medha-utility tools (undo, find recent message).
// Exact-name match because they don't share a single prefix.
const MEDHA_UTILITY_EXACT = new Set([
  "undo_last_action",
  "find_my_recent_message",
]);

// Tab 2 — cross-person reminders. Exact-name route because the tool
// surface is a single verb without a prefix. Tab 16 adds list / cancel.
const REMINDERS_EXACT = new Set([
  "schedule_reminder",
  "list_my_reminders",
  "cancel_reminder",
]);

// Tab 9 — content ingest + repurposing. Exact-name match: neither tool
// shares a prefix with anything else on the surface, so prefix-routing
// would either be ambiguous or invent a fake prefix.
const CONTENT_LOOP_EXACT = new Set([
  "ingest_to_drive_folder",
  "suggest_personal_repurposing",
]);
// Tab 12 — newsletter editor with draft -> critique -> revise loop.
// Exact-name match; single verb on the surface.
const NEWSLETTER_EDITOR_EXACT = new Set(["edit_for_newsletter"]);
// Tab 4 — show_team_content aggregator. Exact-name route because it
// doesn't share a prefix with another module.
const TEAM_CONTENT_EXACT = new Set(["show_team_content"]);
// Tab 5 — org-scoped asset ingest. Exact-name route; the verb is
// `tag_asset` and shares no prefix with anything else.
const TAG_ASSET_EXACT = new Set(["tag_asset"]);
// Tab 4 (this dispatch) — newsletter section briefs. Exact-name route.
const NEWSLETTER_EXACT = new Set(["get_newsletter_brief"]);
// Tab 3 — pipeline tools (investor / event / multi-thread relationship).
// Exact-name match; the tools share no prefix because they read as natural
// verbs (track_investor, list_investors, track_event, ...).
const PIPELINE_EXACT_TOOLS = new Set([
  "track_investor",
  "list_investors",
  "track_event",
  "track_relationship",
  "find_relationship",
]);

// Tab 8 follow-up — personal-life agent tools. Tab 8 shipped the medha-id
// REST routes (#103) but the agent had no tools wired to call them, so
// Medha truthfully reported "no track_brand_decision tool wired yet"
// on Caleb's self-test. Closes the gap.
const PERSONAL_LIFE_EXACT_TOOLS = new Set([
  "track_brand_decision",
  "track_teammate_pursuit",
  "add_journal_entry",
  "recall_journal",
  "recall_person",
  // Tab 11 — per-author voice models + ghost-writing draft tool.
  "track_author_voice",
  "recall_author_voice",
  "draft_in_author_voice",
]);

// T17 — long-form partnerships with append-only history + contact context.
// Companion to pipelines (funnel-shaped) and personal-life (brand /
// teammate / journal). Partnerships hold the rich evolving substance:
// Perplexity, Carlo's tax-credit thread, Karthik as advisor, vendors.
const PARTNERSHIP_EXACT_TOOLS = new Set([
  "track_partnership",
  "append_partnership_note",
  "recall_partnership",
  "list_partnerships",
  "update_contact_context",
  "set_relationship",
  "recall_contact",
]);
// Weekly digest tools — exact-name match. Lifted in from
// googleworkspace/apps-script-samples/solutions/automations/agenda-maker
// (reshaped to Medha's per-tenant GCal + Gmail clients).
const WEEKLY_EXACT = new Set(["summarize_week"]);

// Tab 9 — search_contacts (unified people graph). Exact-name route; the
// tool is a single verb with no shared prefix.
const CONTACTS_SEARCH_EXACT = new Set(["search_contacts"]);

// Tab 18 — dimension/kind-filtered semantic recall over the user's memory.
const RECALL_BY_DIMENSION_EXACT = new Set(["recall_by_dimension"]);

// Tab 32 — time-series relationship trajectory (warming / cooling / drift).
const RELATIONSHIP_TRAJECTORY_EXACT = new Set(["relationship_trajectory"]);

// Tab 34 — network-wide PeopleRank ranking + drift alerts.
const PEOPLE_RANK_EXACT = new Set(["people_rank"]);

// Tab 33 — contact-edge graph (mutual / intro_path / neighborhood).
const CONTACT_GRAPH_EXACT = new Set(["contact_graph"]);

// Tab 20 — forget-on-demand + memory snapshots (via medha-id admin routes)
const FORGET_MEMORY_EXACT = new Set(["forget_memory"]);
const MEMORY_SNAPSHOT_EXACT = new Set(["memory_snapshot"]);

// Tab 24 — code interpreter for inbound XLSX/CSV. Exact-name route; the verb
// `analyze_tabular` shares no prefix with anything else on the surface.
const DATA_ANALYZE_EXACT = new Set(["analyze_tabular"]);

// T15 — personal event planning tools (plan_event, plan_event_add_tasks,
// plan_task_complete, ...). Exact-name match; they share a `plan_` prefix
// but so might future tools so we route by exact membership.
const EVENT_PLANNING_EXACT = new Set([
  "plan_event",
  "plan_event_add_tasks",
  "plan_event_list",
  "plan_event_get",
  "plan_event_list_tasks",
  "plan_task_update",
  "plan_task_complete",
]);

// Tab 13 — content seed Firestore object + polish pipeline.
// capture_content_seed types the raw paste; polish_content_seed runs the
// critique-and-revise loop (Tab 12's edit_for_newsletter when present,
// direct Anthropic fallback otherwise) and emits to Drive.
const POLISH_DRAFT_EXACT = new Set([
  "capture_content_seed",
  "polish_content_seed",
  "list_content_seeds",
]);

// Introspection: describe_self enumerates this tenant's live surface
// (armed tools, OAuth connections, workspace docs, voice cards).
const INTROSPECTION_EXACT = new Set(["describe_self"]);

// Claude-vision OCR fallback: handles PDFs + images when MISTRAL_API_KEY
// is not configured. Exact-name route; the tool name does not share a
// prefix with anything else on the surface.
const CLAUDE_VISION_OCR_EXACT = new Set(["claude_vision_extract"]);

// Composio allowlist: lowercase form of every COMPOSIO_ACTIONS entry,
// plus any operator-configured additions in COMPOSIO_EXTRA_TOOLS (CSV).
// Anything not in this set is rejected — no silent forwarding of
// hallucinated/unknown tool names.
const COMPOSIO_ALLOWLIST = new Set([
  ...COMPOSIO_ACTIONS.map((n) => String(n).toLowerCase()),
  ...(process.env.COMPOSIO_EXTRA_TOOLS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
]);

function isAllowedComposioTool(name) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  return COMPOSIO_ALLOWLIST.has(lc);
}

// Map of "prefix_" → dynamic import loader + function name
const PREFIX_ROUTES = [
  { prefix: "togari_", module: "./tools/togari.js", fn: "executeTogariTool" },
  { prefix: "exa_", module: "./tools/exa.js", fn: "executeExaTool" },
  { prefix: "crust_", module: "./tools/crust.js", fn: "executeCrustTool" },
  {
    prefix: "peoplerank_",
    module: "./tools/peoplerank.js",
    fn: "executePeoplerankTool",
  },
  { prefix: "gmail_", module: "./tools/gmail.js", fn: "executeGmailTool" },
  { prefix: "slack_", module: "./tools/slack.js", fn: "executeSlackTool" },
  {
    prefix: "twitter_",
    module: "./tools/twitter.js",
    fn: "executeTwitterTool",
  },
  { prefix: "notion_", module: "./tools/notion.js", fn: "executeNotionTool" },
  { prefix: "linear_", module: "./tools/linear.js", fn: "executeLinearTool" },
  {
    prefix: "linkedin_",
    module: "./tools/linkedin.js",
    fn: "executeLinkedInTool",
  },
  {
    prefix: "youtube_",
    module: "./tools/youtube.js",
    fn: "executeYouTubeTool",
  },
  { prefix: "vercel_", module: "./tools/vercel.js", fn: "executeVercelTool" },
  { prefix: "drive_", module: "./tools/drive.js", fn: "executeDriveTool" },
  { prefix: "docs_", module: "./tools/docs.js", fn: "executeDocsTool" },
  { prefix: "sheets_", module: "./tools/sheets.js", fn: "executeSheetsTool" },
  // Tab 6 — tenant-scoped workspace docs registry
  {
    prefix: "workspace_",
    module: "./tools/workspace-docs.js",
    fn: "executeWorkspaceDocsTool",
  },
  { prefix: "ocr_", module: "./tools/ocr.js", fn: "executeOcrTool" },
  { prefix: "pdf_", module: "./tools/pdf-utils.js", fn: "executePdfTool" },
  {
    prefix: "transcribe_",
    module: "./tools/transcribe.js",
    fn: "executeTranscribeTool",
  },
  { prefix: "tts_", module: "./tools/tts.js", fn: "executeTtsTool" },
  {
    prefix: "web_",
    module: "./tools/web-browse.js",
    fn: "executeWebBrowseTool",
  },
  {
    prefix: "home_",
    module: "./tools/smart-home.js",
    fn: "executeSmartHomeTool",
  },
  // Microsoft Graph: one consent grants Outlook + Calendar + OneDrive + Teams;
  // four prefixes route to the same dispatcher.
  {
    prefix: "outlook_",
    module: "./tools/microsoft.js",
    fn: "executeMicrosoftTool",
  },
  {
    prefix: "mscal_",
    module: "./tools/microsoft.js",
    fn: "executeMicrosoftTool",
  },
  {
    prefix: "onedrive_",
    module: "./tools/microsoft.js",
    fn: "executeMicrosoftTool",
  },
  {
    prefix: "teams_",
    module: "./tools/microsoft.js",
    fn: "executeMicrosoftTool",
  },
  // Trip-planning / group coordination
  { prefix: "dm_each", module: "./tools/dm-each.js", fn: "executeDmEachTool" },
  {
    prefix: "event_",
    module: "./tools/events-tool.js",
    fn: "executeEventTool",
  },
  {
    prefix: "commitment_",
    module: "./tools/events-tool.js",
    fn: "executeEventTool",
  },
  // flaw #9 — opt-in roster diagnostics
  {
    prefix: "opt_in_status",
    module: "./tools/opt-in-status.js",
    fn: "executeOptInStatusTool",
  },
];

/**
 * Execute a single Claude tool_use block.
 *
 * Wraps the inner dispatch with withAuditLog so every tool call emits a
 * structured JSON audit line (tool_name, tenant_id, duration_ms, status,
 * error_*). This is the single audit point for the entire tool surface;
 * individual handlers do not need to log. Errors are re-thrown so callers
 * still see them.
 *
 * NOTE: Wrapping at the dispatcher level (instead of at each
 * registration site) keeps the diff small and the risk surface low.
 * If a future PR wants per-handler audit middleware (e.g. handler-
 * specific redaction), wrap individual handlers in their own modules
 * — withAuditLog composes cleanly.
 *
 * @param {{name: string, input: object}} toolUse — the Claude tool_use block
 * @param {{tenant: object, normFrom: string, isGroup: boolean, groupId?: string}} ctx
 * @returns {Promise<any>} tool result (object) — errors are caught by caller
 */
export async function dispatchToolCall(toolUse, ctx) {
  const name = toolUse?.name || "unknown";
  // Item 191: notify any active streamed surface that a tool is starting, so
  // the app can render "Checking your calendar" while it runs. No-op for
  // normal iMessage runs (no capture context) and idempotent-friendly: the
  // stream route dedupes repeated identical labels.
  emitProgress("tool", toolProgressLabel(name));
  // Composition order, OUTER to INNER:
  //   audit → rateLimit → authBounce → retry → inner
  // Audit on the outside so rate-limit drops + auth-bounce short-circuits
  // still emit a structured log line. Rate-limit runs BEFORE auth-bounce
  // so a runaway loop that's also missing creds doesn't waste magic-link
  // issuance on every retry — the rate limiter eats the call first.
  // Item 193: retry is INNERMOST so a transient read failure recovers without
  // consuming a fresh rate-limit token per attempt and without auth-bounce
  // misreading a transient 5xx as a missing-credential bounce. It only wraps
  // strictly read-only calendar/email/drive tools (RETRYABLE_READ_TOOLS); for
  // every other tool it is a pass-through.
  const retried = withToolRetry(name, _dispatchToolCallInner);
  const guarded = withAuthBounce(name, retried);
  const rateLimited = withRateLimit(name, guarded);
  const audited = withAuditLog(name, rateLimited);
  return audited(toolUse, ctx);
}

/**
 * Inner dispatcher — original routing logic. Do not call directly from
 * outside this module; go through dispatchToolCall so the audit wrapper
 * runs.
 */
async function _dispatchToolCallInner(toolUse, ctx) {
  const name = toolUse?.name || "";
  const input = toolUse?.input || {};
  const { tenant, normFrom, isGroup, groupId } = ctx;

  console.log(
    `[tool-dispatch] ${name}(${JSON.stringify(input).slice(0, 160)})`,
  );

  // MCP-native tools FIRST — web_search/deep_research/etc. must resolve
  // here, not fall through to Composio. Without this block the model's
  // search calls were silently erroring out.
  if (MCP_EXACT_TOOLS.has(name)) {
    try {
      const result = await executeMcpTool(name, input);
      console.log(
        `[tool-dispatch] ✓ ${name} → ${typeof result === "string" ? result.slice(0, 120) : JSON.stringify(result || {}).slice(0, 120)}`,
      );
      return result;
    } catch (err) {
      console.warn(`[tool-dispatch] ✗ ${name} failed: ${err.message}`);
      throw err;
    }
  }

  // Exact-name routes (no prefix)
  if (GITHUB_TOOLS.has(name)) {
    return executeGitHubTool(name, input, tenant);
  }
  if (RAILWAY_TOOL_NAMES.has(name)) {
    return executeRailwayTool(name, input, tenant);
  }
  if (TRAVEL_TOOLS.has(name)) {
    const { executeTravelTool } = await import("./tools/travel.js");
    return executeTravelTool(name, input, {
      tenant,
      from: normFrom,
      groupId: isGroup ? groupId : null,
    });
  }
  if (COORDINATION_TOOLS.has(name)) {
    const { executeCoordinationTool } = await import("./tools/coordination.js");
    return executeCoordinationTool(name, input, {
      from: normFrom,
      groupId: isGroup ? groupId : null,
    });
  }
  if (GCAL_TOOLS.has(name)) {
    const { executeGcalTool } = await import("./tools/gcal.js");
    return executeGcalTool(name, input, { tenant });
  }
  // Tab 25 — block scheduling + focus time (find_free_block,
  // schedule_focus_block, propose_reschedule). Routed after GCAL_TOOLS
  // since these share the same gcal client but are a distinct surface.
  if (CALENDAR_BLOCK_TOOLS.has(name)) {
    const { executeCalendarBlockTool } =
      await import("./tools/calendar-block.js");
    return executeCalendarBlockTool(name, input, { tenant });
  }
  // togari-search (Python service) — community-event match. Exact-name
  // route ahead of the togari_ prefix so togari_match_community_event
  // doesn't fall through to togari.js's executeTogariTool which doesn't
  // know about it.
  if (name === "togari_match_community_event") {
    const { executeTogariSearchTool } =
      await import("./tools/togari-search.js");
    return executeTogariSearchTool(name, input);
  }
  if (IMAGE_GEN_TOOLS.has(name)) {
    const { executeImageGenTool } = await import("./tools/image-gen.js");
    // Tab 15 — pass the sender so generated images are indexed with the
    // contact they were made for (filterable recall later).
    return executeImageGenTool(name, input, { tenant, contact: normFrom });
  }
  // Tab 27 - edit_image refines an image already in the conversation.
  // Pass the sender so edited images are indexed with the contact they
  // were made for, matching the generate_image path above.
  if (IMAGE_EDIT_EXACT.has(name)) {
    const { executeImageEditTool } = await import("./tools/image-edit.js");
    return executeImageEditTool(name, input, { tenant, contact: normFrom });
  }
  if (CAROUSEL_TOOLS.has(name)) {
    const { executeCarouselTool } =
      await import("./tools/generate-carousel.js");
    // Tab 28 — each slide reuses the generate_image path, so the Tab 15
    // per-image Pinecone write happens per slide; pass the sender through.
    return executeCarouselTool(name, input, { tenant, contact: normFrom });
  }
  if (PDF_GEN_EXACT.has(name)) {
    const { executePdfGenTool } = await import("./tools/pdf-gen.js");
    return executePdfGenTool(name, input, { tenant });
  }
  // PR-G — file-gen family (docx, xlsx, csv, md/markdown, txt/text, json, code)
  if (FILE_GEN_EXACT.has(name)) {
    const { executeFileGenTool } = await import("./tools/file-gen.js");
    return executeFileGenTool(name, input, { tenant });
  }
  // flaws #77 + #85 — medha-utility (undo, find recent message)
  if (MEDHA_UTILITY_EXACT.has(name)) {
    const { executeMedhaUtilityTool } =
      await import("./tools/medha-utility.js");
    return executeMedhaUtilityTool(name, input, {
      tenant,
      normFrom,
      isGroup,
      groupId: isGroup ? groupId : null,
    });
  }
  // Tab 2 — cross-person reminders (schedule_reminder)
  if (REMINDERS_EXACT.has(name)) {
    const { executeRemindersTool } = await import("./tools/reminders.js");
    return executeRemindersTool(name, input, {
      tenant,
      normFrom,
      isGroup,
      groupId: isGroup ? groupId : null,
    });
  }

  // Tab 9 — content-loop (ingest_to_drive_folder, suggest_personal_repurposing)
  if (CONTENT_LOOP_EXACT.has(name)) {
    const { executeContentLoopTool } = await import("./tools/content-loop.js");
    return executeContentLoopTool(name, input, { tenant });
  }

  // Tab 12 — newsletter editor: draft -> hostile-stranger critique -> revise.
  if (NEWSLETTER_EDITOR_EXACT.has(name)) {
    const { executeNewsletterEditorTool } =
      await import("./tools/newsletter-editor.js");
    return executeNewsletterEditorTool(name, input, { tenant });
  }

  // Tab 4 — show_team_content
  if (TEAM_CONTENT_EXACT.has(name)) {
    const { executeTeamContentTool } = await import("./tools/team-content.js");
    return executeTeamContentTool(name, input, { tenant });
  }

  // Tab 5 — tag_asset (org-scoped media ingest with follow-up questions)
  if (TAG_ASSET_EXACT.has(name)) {
    const { executeTagAssetTool } = await import("./tools/tag-asset.js");
    return executeTagAssetTool(name, input, { tenant });
  }

  // Tab 4 (newsletter dispatch) — get_newsletter_brief
  if (NEWSLETTER_EXACT.has(name)) {
    const { executeNewsletterTool } = await import("./tools/newsletter.js");
    return executeNewsletterTool(name, input, { tenant });
  }

  // Tab 3 — investor / event / multi-thread relationship pipelines
  if (PIPELINE_EXACT_TOOLS.has(name)) {
    const { executePipelineTool } = await import("./tools/pipelines.js");
    return executePipelineTool(name, input, { tenant });
  }

  // Tab 8 follow-up — personal-life (brand decisions, teammate pursuits, journal)
  if (PERSONAL_LIFE_EXACT_TOOLS.has(name)) {
    const { executePersonalLifeTool } =
      await import("./tools/personal-life.js");
    return executePersonalLifeTool(name, input, { tenant });
  }

  // T17 — long-form partnerships (Perplexity, Carlo, advisors, vendors)
  // and contact-context updates ("Shirley shipped X").
  if (PARTNERSHIP_EXACT_TOOLS.has(name)) {
    const { executePartnershipTool } = await import("./tools/partnerships.js");
    return executePartnershipTool(name, input, { tenant });
  }

  // T15 — personal event planning (plan_event, plan_event_add_tasks, ...)
  if (EVENT_PLANNING_EXACT.has(name)) {
    const { executeEventPlanningTool } =
      await import("./tools/event-planning.js");
    return executeEventPlanningTool(name, input, { tenant });
  }

  // Tab 13 — content seed capture + polish pipeline
  if (POLISH_DRAFT_EXACT.has(name)) {
    const { executePolishDraftTool } = await import("./tools/polish-draft.js");
    return executePolishDraftTool(name, input, { tenant });
  }

  // Introspection: describe_self enumerates the tenant's live surface
  if (INTROSPECTION_EXACT.has(name)) {
    const { executeIntrospectionTool } =
      await import("./tools/introspection.js");
    return executeIntrospectionTool(name, input, { tenant });
  }

  // Claude-vision OCR fallback: used directly by attachment-ingest.js when
  // Mistral is unavailable. Also exposed as a callable tool so Claude can
  // invoke it on demand for image / PDF URLs the model has in conversation.
  if (CLAUDE_VISION_OCR_EXACT.has(name)) {
    const { executeClaudeVisionOcrTool } =
      await import("./tools/claude-vision-ocr.js");
    return executeClaudeVisionOcrTool(name, input, { tenant });
  }

  // summarize_week (apps-script-samples lift, PR #157)
  if (WEEKLY_EXACT.has(name)) {
    const { executeWeeklyTool } = await import("./tools/weekly.js");
    return executeWeeklyTool(name, input, { tenant });
  }

  // Tab 9 — search_contacts (unified people graph via amber-id Pinecone)
  if (CONTACTS_SEARCH_EXACT.has(name)) {
    const { executeContactsSearchTool } =
      await import("./tools/contacts-search.js");
    return executeContactsSearchTool(name, input, { tenant, normFrom });
  }

  // Tab 18 — recall_by_dimension (dimension/kind-filtered semantic recall)
  if (RECALL_BY_DIMENSION_EXACT.has(name)) {
    const { executeRecallByDimensionTool } =
      await import("./tools/recall-by-dimension.js");
    return executeRecallByDimensionTool(name, input, { tenant });
  }

  // Tab 24 — analyze_tabular (code interpreter for inbound XLSX/CSV)
  if (DATA_ANALYZE_EXACT.has(name)) {
    const { executeDataAnalyzeTool } = await import("./tools/data-analyze.js");
    return executeDataAnalyzeTool(name, input, { tenant });
  }

  // Tab 32 — relationship_trajectory (warming / cooling over time)
  if (RELATIONSHIP_TRAJECTORY_EXACT.has(name)) {
    const { executeRelationshipTrajectoryTool } =
      await import("./tools/relationship-trajectory.js");
    return executeRelationshipTrajectoryTool(name, input, { tenant });
  }

  // Tab 34 — people_rank (network-wide ranking + drift alerts)
  if (PEOPLE_RANK_EXACT.has(name)) {
    const { executePeopleRankTool } = await import("./tools/people-rank.js");
    return executePeopleRankTool(name, input, { tenant, normFrom });
  }

  // Tab 33 — contact_graph (mutual / intro_path / neighborhood over the edge graph)
  if (CONTACT_GRAPH_EXACT.has(name)) {
    const { executeContactGraphTool } =
      await import("./tools/contact-graph.js");
    return executeContactGraphTool(name, input, { tenant });
  }

  // Tab 20 — forget_memory (delete vectors from the tenant's namespace)
  if (FORGET_MEMORY_EXACT.has(name)) {
    const { executeForgetMemoryTool } =
      await import("./tools/forget_memory.js");
    return executeForgetMemoryTool(name, input, { tenant });
  }

  // Tab 20 — memory_snapshot (point-in-time view of the knowledge base)
  if (MEMORY_SNAPSHOT_EXACT.has(name)) {
    const { executeMemorySnapshotTool } =
      await import("./tools/memory_snapshot.js");
    return executeMemorySnapshotTool(name, input, { tenant });
  }

  // Beads — prefix + statically imported
  if (name.startsWith("task_")) {
    return executeBeadsTool(name, input, { tenant });
  }

  // Prefix-based native module routes
  for (const route of PREFIX_ROUTES) {
    if (name.startsWith(route.prefix)) {
      const mod = await import(route.module);
      const fn = mod[route.fn];
      if (typeof fn !== "function") {
        throw new Error(
          `dispatcher: ${route.module} does not export ${route.fn}`,
        );
      }
      // flaws #21-29: event_ and commitment_ tools need the sender +
      // group context to dedupe, attribute, and update group memory.
      // The previous dispatcher dropped everything but tenant, which is
      // why event_create couldn't tell who was organizing and why
      // currentEventId never made it onto group memory.
      if (
        route.prefix === "event_" ||
        route.prefix === "commitment_" ||
        // flaw #9 — opt_in_status_check needs the current group + sender
        // so the no-args call defaults to the CURRENT group. flaw #13 —
        // dm_each needs normFrom for per-recipient rate-limit attribution.
        route.prefix === "opt_in_status" ||
        route.prefix === "dm_each"
      ) {
        return fn(name, input, {
          tenant,
          normFrom: ctx.normFrom,
          isGroup: ctx.isGroup,
          groupId: ctx.groupId,
          messageId: ctx.messageId,
        });
      }
      return fn(name, input, { tenant });
    }
  }

  // Unknown name. Forward to Composio ONLY if the name is on the
  // explicit allowlist; otherwise return a structured error so the
  // model can recover. The previous catch-all let the model invoke
  // arbitrary external actions — including tool names it had
  // hallucinated — which is both a reliability and a security
  // concern.
  if (isAllowedComposioTool(name)) {
    console.log(`[tool-dispatch] composio allowlisted "${name}" → forwarding`);
    return executeComposioAction(name, input, tenant);
  }
  console.warn(
    `[tool-dispatch] reject unknown tool "${name}" (not on Composio allowlist)`,
  );
  return {
    error: "unknown_tool",
    message: `Tool "${name}" is not registered. Use one of the configured tools.`,
  };
}
