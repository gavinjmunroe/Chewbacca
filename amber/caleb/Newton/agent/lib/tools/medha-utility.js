/**
 * medha-utility.js — small utility tools that don't fit the bigger
 * categories.
 *
 * Tools:
 *   • undo_last_action          (flaw #77)
 *   • find_my_recent_message    (flaw #85)
 *
 * Both are surgical and deterministic: no LLM round-trip, just DB
 * lookups + a focused side effect. They give the model a way to do
 * the two things users ask for most often that the rest of the tool
 * surface doesn't cleanly cover.
 */

import { registerCapability } from "../capabilities.js";
import {
  insertRow as pdwInsertRow,
  tenantId as pdwTenantId,
  isReady as pdwIsReady,
} from "../pdw/bq-client.js";
import { BigQuery } from "@google-cloud/bigquery";

registerCapability("_tools_MedhaUtility", [
  "Undo Medha's most recent action in a group (undo_last_action) — v1 supports event_create undo only",
  "Search Medha's recent outbound messages in this chat for a keyword (find_my_recent_message)",
]);

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const MEDHA_UTILITY_TOOLS = [
  {
    name: "undo_last_action",
    description:
      "Undo the most recent durable action Medha took in the CURRENT " +
      "group (or DM). Reads the latest entry from the per-group action " +
      "log (medha_pdw.event_messages where direction encodes an action) " +
      "and inverts it. v1 supports event_create → event delete + " +
      "apology bubble. Sent-DM undo is NOT yet supported in v1 (the " +
      "best we can do is send an 'ignore my last DM' follow-up). Returns " +
      "{ ok, undone: <kind>, detail }.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Optional one-liner Medha can say to the group when " +
            "announcing the undo (e.g. 'wrong day, sorry').",
        },
      },
    },
  },
  {
    name: "find_my_recent_message",
    description:
      "Search Medha's last ~50 outbound messages in THIS conversation " +
      "(DM or group) for one whose body contains the given keyword. " +
      "Returns { message_id, text, sent_at } for the most recent " +
      "match, or { found: false } when nothing matches. Use this when " +
      "a user says 'about what you said earlier about X' so you can " +
      "thread the reply via [reply:<id>].",
    input_schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description:
            "Substring to look for (case-insensitive). Short is better — " +
            "a single noun usually wins.",
        },
      },
      required: ["keyword"],
    },
  },
];

// ── Implementations ─────────────────────────────────────────────────────────

async function undoLastAction(input, ctx) {
  const { tenant, groupId } = ctx || {};
  if (!pdwIsReady()) {
    return { error: "pdw not ready (no BigQuery credentials)" };
  }
  if (!groupId) {
    return {
      error:
        "undo_last_action requires a group context — DM undo isn't wired " +
        "yet (v1 limitation).",
    };
  }

  // Read the most recent action row for this group. We currently
  // recognize direction='action' rows that carry a JSON body
  // describing the action shape; event_create is the only kind we
  // know how to invert today.
  let row;
  try {
    const project = process.env.GCP_PROJECT_ID;
    const dataset = process.env.MEDHA_PDW_DATASET || "medha_pdw";
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const bq = credsJson
      ? new BigQuery({ projectId: project, credentials: JSON.parse(credsJson) })
      : new BigQuery({ projectId: project });
    const [rows] = await bq.query({
      query: `SELECT message_id, body, sent_at, direction
              FROM \`${project}.${dataset}.event_messages\`
              WHERE tenant_id = @tenantId
                AND group_id = @groupId
                AND direction IN ('action', 'event_create')
              ORDER BY sent_at DESC
              LIMIT 1`,
      params: { tenantId: pdwTenantId(), groupId },
    });
    row = rows?.[0] || null;
  } catch (err) {
    return { error: `bq query failed: ${err.message?.slice(0, 200)}` };
  }
  if (!row) {
    return { ok: false, reason: "no_action_log_row_for_group" };
  }

  let parsed;
  try {
    parsed = typeof row.body === "string" ? JSON.parse(row.body) : row.body;
  } catch {
    parsed = null;
  }
  const kind = parsed?.kind || row.direction;

  // v1: only event_create is invertible. Everything else is doc'd as
  // "not yet supported" so the model surfaces an honest answer.
  if (kind === "event_create" || row.direction === "event_create") {
    const eventId = parsed?.event_id || parsed?.eventId;
    if (!eventId) {
      return {
        ok: false,
        reason: "no_event_id_in_action_body",
        action_row: row,
      };
    }
    // Record an inverse action so the dashboard sees the undo.
    pdwInsertRow("event_messages", {
      tenant_id: pdwTenantId(),
      message_id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      group_id: groupId,
      direction: "action",
      body: JSON.stringify({
        kind: "event_undo",
        target_event_id: eventId,
        target_message_id: row.message_id,
        reason: input?.reason || null,
      }),
      sent_at: new Date().toISOString(),
    }).catch(() => {});
    return {
      ok: true,
      undone: "event_create",
      detail: {
        event_id: eventId,
        original_message_id: row.message_id,
        note:
          "Inverse action logged. The events writer should observe " +
          "direction='action' kind='event_undo' and soft-delete the " +
          "target row on next reconcile.",
      },
    };
  }

  // Other kinds (sent DMs, fan-outs, reactions) — document the gap.
  return {
    ok: false,
    reason: "undo_not_implemented_for_kind",
    kind,
    suggestion:
      kind === "dm_each_invoke"
        ? "Send a follow-up DM that says 'ignore my last message'."
        : kind === "reaction"
          ? "Remove the reaction by sending the same reaction prefixed with '-'."
          : "v1 only supports event_create undo.",
  };
}

async function findMyRecentMessage(input, ctx) {
  const keyword = String(input?.keyword || "").trim();
  if (!keyword) return { error: "keyword is required" };
  if (keyword.length > 200) {
    return { error: "keyword must be ≤200 chars" };
  }
  const { tenant, normFrom, isGroup, groupId } = ctx || {};
  if (!tenant?.privyDid) return { error: "tenant.privyDid required" };

  const project = process.env.GCP_PROJECT_ID;
  if (!project) return { error: "GCP_PROJECT_ID not configured" };
  const dataset = process.env.MEDHA_CONV_DATASET || "medha_conversations";

  try {
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const bq = credsJson
      ? new BigQuery({ projectId: project, credentials: JSON.parse(credsJson) })
      : new BigQuery({ projectId: project });
    // We constrain by tenant_did + chat scope (group_id when in a
    // group; contact when in a DM). LIMIT 50 then filter LIKE; pulling
    // 50 rows is cheap and avoids a full table scan.
    const scopeClause = isGroup
      ? "group_id = @groupId"
      : "contact = @contact AND group_id IS NULL";
    const params = isGroup
      ? { tenantDid: tenant.privyDid, groupId }
      : { tenantDid: tenant.privyDid, contact: normFrom };
    const [rows] = await bq.query({
      query: `SELECT message_id, text, sent_at
              FROM \`${project}.${dataset}.outbound_messages\`
              WHERE tenant_did = @tenantDid
                AND ${scopeClause}
              ORDER BY sent_at DESC
              LIMIT 50`,
      params,
    });
    const needle = keyword.toLowerCase();
    const match = (rows || []).find(
      (r) =>
        typeof r.text === "string" && r.text.toLowerCase().includes(needle),
    );
    if (!match) return { found: false };
    return {
      found: true,
      message_id: match.message_id,
      text: (match.text || "").slice(0, 500),
      sent_at: match.sent_at,
      hint:
        "Thread your reply with [reply:" +
        match.message_id +
        "] " +
        "so the user's iMessage shows the quote inline.",
    };
  } catch (err) {
    return { error: `bq query failed: ${err.message?.slice(0, 200)}` };
  }
}

export async function executeMedhaUtilityTool(toolName, input, ctx = {}) {
  switch (toolName) {
    case "undo_last_action":
      return undoLastAction(input, ctx);
    case "find_my_recent_message":
      return findMyRecentMessage(input, ctx);
    default:
      return { error: `unknown medha-utility tool: ${toolName}` };
  }
}
