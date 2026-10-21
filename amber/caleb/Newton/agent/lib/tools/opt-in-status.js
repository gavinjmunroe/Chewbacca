/**
 * opt-in-status.js — `opt_in_status_check` admin / diagnostics tool (flaw #9).
 *
 * Surfaces the per-group opt-in roster OR per-handle status across all
 * known groups in memory. Read-only; never mutates state. Used when a
 * user (or operator) asks "did so-and-so opt in?" — Medha shouldn't
 * have to guess.
 */

import {
  loadGroupMemory,
  // We DON'T have a "list all groups in memory" function, so the
  // by-handle path requires the caller to pass a hint OR we walk
  // recently-cached groups. For simplicity we expose by-group + by-
  // handle-in-this-group; cross-group sweep is a later phase.
} from "../group-memory.js";
import { registerCapability } from "../capabilities.js";
import { getGroupOptInRoster } from "../bootstrapping.js";

registerCapability("_tools_OptInStatusCheck", [
  "Read the opt-in roster for a group or the status for a specific handle (opt_in_status_check)",
]);

export const OPT_IN_STATUS_TOOLS = [
  {
    name: "opt_in_status_check",
    description:
      "Read the opt-in roster for the CURRENT group (when no args given), " +
      "for a specific group_id, OR look up a specific handle's status " +
      "within a group. Returns the full {handle, status} list. Use this " +
      "when the user asks who's opted in, who hasn't, or what so-and-so's " +
      "status is. Read-only — never modifies state.",
    input_schema: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          description:
            "Group id to inspect. Defaults to the CURRENT group when " +
            "called from inside a group chat.",
        },
        handle: {
          type: "string",
          description:
            "Optional handle (phone E.164 or email) to look up. When set, " +
            "the result is filtered to just that person's status in the " +
            "given group.",
        },
      },
      required: [],
    },
  },
];

async function optInStatusCheck(input, ctx = {}) {
  const { tenant, groupId: ctxGroupId, isGroup } = ctx;
  const targetGroupId =
    (input && typeof input.group_id === "string" && input.group_id.trim()) ||
    (isGroup ? ctxGroupId : null);

  if (!targetGroupId) {
    return {
      error:
        "opt_in_status_check requires a group_id (or must be called from " +
        "inside a group chat).",
    };
  }

  const groupMem = await loadGroupMemory(targetGroupId, tenant).catch(
    () => null,
  );
  if (!groupMem) {
    return { error: `could not load group memory for ${targetGroupId}` };
  }

  const roster = getGroupOptInRoster(groupMem);
  if (input?.handle) {
    const h = String(input.handle).trim();
    const hit = roster.find((r) => r.handle === h);
    return {
      group_id: targetGroupId,
      group_name: groupMem.name || null,
      handle: h,
      status: hit ? hit.status : "unknown",
      llm_summary: hit
        ? `${h} is ${hit.status} in this group.`
        : `${h} isn't in this group's opt-in roster yet.`,
    };
  }

  // No handle — return the whole roster + small summary by bucket.
  const bucket = { opted_in: [], pending: [], opted_out: [], stopped: [] };
  for (const r of roster) {
    if (bucket[r.status]) bucket[r.status].push(r.handle);
  }
  const parts = [];
  parts.push(`${bucket.opted_in.length} opted in`);
  parts.push(`${bucket.pending.length} pending`);
  if (bucket.opted_out.length)
    parts.push(`${bucket.opted_out.length} opted out`);
  if (bucket.stopped.length) parts.push(`${bucket.stopped.length} stopped`);

  return {
    group_id: targetGroupId,
    group_name: groupMem.name || null,
    roster,
    buckets: bucket,
    llm_summary: parts.join("; "),
  };
}

export async function executeOptInStatusTool(toolName, input, ctx = {}) {
  switch (toolName) {
    case "opt_in_status_check":
      return optInStatusCheck(input, ctx);
    default:
      return { error: `unknown opt-in-status tool: ${toolName}` };
  }
}
