/**
 * Tool arming — pick the tool subset to expose to the model on a given turn.
 *
 * Single source of truth for "which tools does Claude see this turn?"
 * Extracted from agent.js so the logic can be tested directly and so any
 * future change is one diff away from a passing parity test.
 *
 * INVARIANT: this function does NOT take `isGroup`. Group chats and DMs
 * receive identical tool surfaces. Differences in how the model uses those
 * tools (group voice, group focus clause, etc.) live in the prompt layer,
 * not the tool layer. If a tool needs to behave differently in a group, the
 * tool's own handler reads `isGroup` from its ctx — not the arming layer.
 *
 * Anyone adding a new tool needs to do exactly one thing: register it in
 * lib/tools/index.js (so getAllTools picks it up) and optionally add it to
 * a keyword in lib/tool-selector.js. The new tool is automatically armed
 * in both DM and group surfaces with no further code changes.
 */

import { selectToolsByKeyword } from "./tool-selector.js";
import { mightNeedSearch } from "./search.js";

/**
 * Calendar tools that we keep always-armed for expert-mode tenants so the
 * LLM sees them every turn instead of relying on a keyword match. Without
 * this, phrasings the selector misses ("planning session", "block time",
 * "lock in a sync") result in the LLM saying "I have no calendar tool"
 * even though the tool exists.
 */
const CALENDAR_TOOL_NAMES = new Set([
  "schedule_event",
  "get_availability",
  "list_events",
  "reschedule_event",
  "cancel_event",
  // Tab 25 — block scheduling + focus time. Always-armed for the same reason
  // as the rest of the calendar bank: phrasings like "block time", "protect
  // my morning", "find me a deep-work window" are easy for the keyword
  // selector to miss, and a missed arm means the LLM claims it has no tool.
  "find_free_block",
  "schedule_focus_block",
  "propose_reschedule",
]);

/**
 * Partnership tools that we keep always-armed for expert-mode tenants.
 *
 * Belt-and-suspenders for the CRITICAL audit gap (workflow wzhjv19sw):
 * partnership tools existed and were documented in the system prompt, but
 * the per-turn keyword selector only fired them on the literal word
 * "partnership". Sagar's actual phrasings ("please track that we are
 * building...", "main contact is X", "what do you know about Perplexity")
 * never matched, so the tools were effectively dark. Even with the
 * expanded keyword map in tool-selector.js, we always-arm here so a
 * future keyword regression cannot dark-room these tools again.
 */
const PARTNERSHIP_TOOL_NAMES = new Set([
  "track_partnership",
  "append_partnership_note",
  "recall_partnership",
  "list_partnerships",
  "update_contact_context",
  "track_investor",
  "track_relationship",
  "list_investors",
  "find_relationship",
]);

/**
 * Personal-life tools (journal capture/recall, person recall, brand and
 * teammate trackers) that we keep always-armed for expert tenants. Same
 * rationale as PARTNERSHIP_TOOL_NAMES: these are reflective/long-tail
 * surfaces where keyword matching is brittle ("yapping", "today I", etc.)
 * and a missed arm means the tool is silently absent.
 */
const PERSONAL_LIFE_TOOL_NAMES = new Set([
  "add_journal_entry",
  "recall_journal",
  "recall_person",
  "track_brand_decision",
  "track_teammate_pursuit",
]);

/**
 * Reminder tools that we keep always-armed for expert tenants.
 *
 * PR-H — closes the proactive-reminders gap from the 2026-05-28 audit
 * (workflow wzhjv19sw). The tools, persistence (/v1/me/reminders), and
 * delivery worker shipped in Tab 16, but the keyword selector only fires
 * on the literal word "reminder", missing the actual phrasings tenants
 * use ("ping me on Tuesday", "note to self", "remind @Shirley to ...").
 * Sagar's audit transcript showed Medha apologizing verbally instead of
 * scheduling because the tool was never armed. Always-arming here mirrors
 * the PR #234 fix for partnership + personal-life tools.
 */
const REMINDER_TOOL_NAMES = new Set([
  "schedule_reminder",
  "list_my_reminders",
  "cancel_reminder",
]);

/**
 * File / image / PDF generation tools (PR #239, PR #241, Tab 2). These are
 * the outbound "make me a thing and send it" surface. Always-armed for
 * expert tenants so a missed keyword match (e.g. "Fortnite PDF") never
 * leaves Medha verbally refusing what she can actually do.
 */
const GEN_FILE_TOOL_NAMES = new Set([
  "generate_image",
  // Tab 27 - iterate on a generated/received image ("make it more blue").
  // Always-armed so a missed keyword never leaves Medha refusing a refine.
  "edit_image",
  // Tab 28 - multi-page carousel deck for posts and slide-format output.
  // Wave 2 audit gap: registered + dispatched but never armed, so the
  // model would refuse "make me a carousel" with a hallucinated "I don't
  // have that tool". Same silent-broken pattern as Wave 1 memory tools.
  "generate_carousel",
  // Tab 30 - Slack canvas (long-form doc surface inside a channel).
  // Belongs here because it is the "make a thing and send it" surface for
  // long-form output that would otherwise wall-of-text a channel. Without
  // this, the prompts.js doctrine that tells the model to prefer a canvas
  // over a 2000-char chat dump is unreachable.
  "slack_create_canvas",
  "generate_pdf",
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

/**
 * Wave 1 memory tools (Tab 18 + Tab 20). Always-armed for expert tenants
 * so the model never refuses with "I don't have that tool" when the user
 * asks for dimension-filtered recall, point-in-time snapshots, or "forget
 * this." Without this set, the tools live in `tools/index.js` and
 * `tool-dispatcher.js` but never reach the model's surface because no
 * keyword in `tool-selector.js` maps to them.
 */
const MEMORY_TOOL_NAMES = new Set([
  "recall_by_dimension",
  "forget_memory",
  "memory_snapshot",
  // Tab 32 — relationship trajectory (warming / cooling / drift over time)
  "relationship_trajectory",
  // Tab 34 — network-wide PeopleRank ranking + drift alerts
  "people_rank",
  // Tab 33 — contact graph (mutual connections / intro paths / neighborhood)
  "contact_graph",
]);

/**
 * Voice tools (Tab 23). Always-armed for expert tenants so an explicit
 * spoken-reply request ("voice mode on", "read this back to me", "reply as
 * voice", "read me my reminders out loud") never lands on a turn where
 * tts_generate was dark.
 *
 * Note on the two voice-out paths: the PRIMARY outbound mechanism is the
 * `[voice]` reply prefix handled in agent.js, which synthesizes the reply
 * text itself and attaches it as a true iMessage voice note via Loop's
 * mediaUrl. tts_generate is the separate, explicit "make me an audio file"
 * tool (returns base64 the model can hand off elsewhere). Always-arming it
 * keeps the keyword selector ("voice"/"speak"/"audio") from being the only
 * thing standing between the user and spoken output when they phrase the ask
 * in a way the selector misses.
 */
const VOICE_TOOL_NAMES = new Set(["tts_generate"]);

/**
 * Tab 24 — code interpreter for inbound spreadsheets. Always-armed for expert
 * tenants so when a user drops an XLSX/CSV and asks "what's the top row by
 * likes" or "sum revenue by month", the model can actually compute it instead
 * of falling back to eyeballing OCR'd text. Keyword arming alone misses the
 * common case where the file is already in the conversation.
 */
const DATA_TOOL_NAMES = new Set(["analyze_tabular"]);

/**
 * Intent types that trigger fallback core-tool arming when toolsEnabled is
 * false (rare: stranger DM with a clear intent we can still service).
 */
const FALLBACK_INTENT_TYPES = new Set([
  "create_task",
  "check_calendar",
  "send_message",
  "lookup",
]);

/**
 * Pick the set of tools to expose to Claude this turn.
 *
 * @param {object} opts
 * @param {Array<object>} opts.allTools         Full tool list from getAllTools().
 * @param {string} opts.text                    User's message text.
 * @param {boolean} opts.toolsEnabled           Whether tools are enabled at all.
 *                                              In agent.js: isCaleb || tenant.expertMode.
 * @param {boolean} [opts.isExpert]             Legacy gate for always-armed banks.
 *                                              Kept for backward-compat: when
 *                                              senderIsOwner is omitted, isExpert
 *                                              still drives the always-armed set
 *                                              the way it did before.
 * @param {boolean} [opts.senderIsOwner]        Whether the human typing this turn
 *                                              is the tenant's owner. This is the
 *                                              new transport-agnostic gate for the
 *                                              always-armed banks (calendar +
 *                                              partnership + personal-life). The
 *                                              owner of a tenant gets the same
 *                                              tool surface in iMessage DM,
 *                                              iMessage group, AND Slack. When
 *                                              passed, replaces isExpert as the
 *                                              gate (still honors an explicit
 *                                              tenant.expertMode === false opt-out).
 * @param {object} [opts.tenant]                Tenant object — only used to read
 *                                              tenant.expertMode for the opt-out
 *                                              check when senderIsOwner is set.
 * @param {object|null} [opts.detectedIntent]   Fallback intent when toolsEnabled is false.
 * @returns {{tools: Array<object>|undefined, summary: string}}
 */
export function armTools({
  allTools,
  text,
  toolsEnabled,
  isExpert,
  senderIsOwner,
  tenant,
  detectedIntent = null,
}) {
  // Resolve the always-armed gate. New behavior: senderIsOwner drives it so
  // that owner-in-group and owner-in-Slack get the same expert-grade surface
  // as owner-in-DM. Backward compat: if the caller hasn't passed
  // senderIsOwner, fall through to the legacy isExpert flag verbatim. An
  // explicit tenant.expertMode === false still suppresses (operator opt-out).
  const armAlwaysBanks =
    senderIsOwner !== undefined
      ? !!senderIsOwner && tenant?.expertMode !== false
      : !!isExpert;

  const coreTools = (allTools || []).filter(
    (t) =>
      t.name &&
      (t.name.startsWith("task_") ||
        t.name.startsWith("github_") ||
        (armAlwaysBanks && CALENDAR_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && PARTNERSHIP_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && PERSONAL_LIFE_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && REMINDER_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && GEN_FILE_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && MEMORY_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && VOICE_TOOL_NAMES.has(t.name)) ||
        (armAlwaysBanks && DATA_TOOL_NAMES.has(t.name))),
  );

  if (toolsEnabled) {
    // No-owner model (2026-06-04): Medha has no owner. Every registered
    // medha-id is a full first-class user of THEIR OWN Medha, enhanced by
    // their connected accounts + memory. So every enabled tenant sees the
    // FULL tool surface, not a keyword-filtered sliver. Tool *visibility* is
    // not authorization — lib/tool-dispatcher.js + permissions.js still gate
    // destructive execution per tenant. This deletes the entire class of
    // "keyword selector missed the phrasing -> tool went dark -> 'I don't
    // have that tool'" bugs that the always-armed banks were band-aiding.
    const seen = new Set();
    const tools = (allTools || []).filter((t) => {
      if (!t?.name || seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
    return {
      tools: tools.length > 0 ? tools : undefined,
      summary: `${tools.length} armed (full surface)`,
    };
  }

  if (detectedIntent && FALLBACK_INTENT_TYPES.has(detectedIntent.type)) {
    return {
      tools: coreTools.length > 0 ? coreTools : undefined,
      summary: `${coreTools.length} fallback (intent=${detectedIntent.type})`,
    };
  }

  return { tools: undefined, summary: "0 armed (tools disabled)" };
}

export const CALENDAR_ALWAYS_ARMED = CALENDAR_TOOL_NAMES;
export const REMINDER_ALWAYS_ARMED = REMINDER_TOOL_NAMES;
export const VOICE_ALWAYS_ARMED = VOICE_TOOL_NAMES;
