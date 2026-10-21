/**
 * events-tool.js — model-facing wrappers around lib/events.js.
 *
 * Tools, all backed by the medha_pdw BigQuery dataset:
 *
 *   event_create         — mint a new Event ID (MED-XXXX) for a group/type
 *   event_update         — patch an existing event (flaw #23)
 *   event_cancel         — mark event status=cancelled (flaw #24)
 *   event_archive        — mark event status=past (flaw #24)
 *   commitment_add       — record "I'll bring X" against an event
 *   commitment_complete  — mark a commitment status=completed (flaw #29)
 *   commitment_miss      — mark a commitment status=missed (flaw #29)
 *
 * The model rarely needs to read events back directly — the dashboard
 * does that. For now we keep this surface tight and grow it when a real
 * read use case lands.
 */

import {
  createEvent,
  updateEvent,
  cancelEvent,
  archiveEvent,
  addCommitment,
  completeCommitment,
  missCommitment,
  EVENT_TYPES_SEED,
} from "../events.js";
import { loadGroupMemory, saveGroupMemory } from "../group-memory.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Events", [
  "Create a new planning event with an MED-XXXX id (event_create)",
  "Patch / cancel / archive an existing event (event_update, event_cancel, event_archive)",
  "Record a commitment a person made in a group (commitment_add)",
  "Mark a commitment as done or missed (commitment_complete, commitment_miss)",
]);

export const EVENT_TOOLS = [
  {
    name: "event_create",
    description:
      "Create a new planning event (trip, rave, wedding, retreat, etc.) " +
      "and return its short MED-XXXX id. Use this when the user clearly " +
      "kicks off planning ('let's plan EDC May 16-18', 'we should do a " +
      "retreat in June'). The id is the durable handle for everything " +
      "that follows: commitments, reminders, dashboard. " +
      "If the same event already exists, the result will include " +
      "deduped=true and an llm_note telling you NOT to re-announce it.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: `Event type. Seed set: ${EVENT_TYPES_SEED.join(", ")}. Open-string — use a new value if none fit.`,
        },
        title: {
          type: "string",
          description: "Human title, e.g. 'EDC Vegas 2026'.",
        },
        start_date: {
          type: "string",
          description: "ISO date YYYY-MM-DD, optional.",
        },
        end_date: {
          type: "string",
          description: "ISO date YYYY-MM-DD, optional.",
        },
        participant_handles: {
          type: "array",
          items: { type: "string" },
          description:
            "Handles (phone/email) of confirmed/invited participants. " +
            "Sender will be added as organizer automatically.",
        },
      },
      required: ["type"],
    },
  },
  // flaw #23
  {
    name: "event_update",
    description:
      "Patch fields on an existing event (title, dates, status, type). " +
      "Append-only under the hood: a fresh row is written with the new " +
      "fields + updated_at=now, and downstream reads pick the latest. " +
      "Use this when the user revises plans ('actually push EDC to May 23').",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "MED-XXXX to patch." },
        patch: {
          type: "object",
          description:
            "Fields to update. Any of: title, start_date, end_date, status, type.",
          properties: {
            title: { type: "string" },
            start_date: { type: "string" },
            end_date: { type: "string" },
            status: { type: "string" },
            type: { type: "string" },
          },
        },
      },
      required: ["event_id", "patch"],
    },
  },
  // flaw #24
  {
    name: "event_cancel",
    description:
      "Cancel an event ('we're not doing the retreat anymore'). " +
      "Sets status='cancelled' and clears it as the group's active event.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "MED-XXXX to cancel." },
      },
      required: ["event_id"],
    },
  },
  // flaw #24
  {
    name: "event_archive",
    description:
      "Archive a past event ('that trip's over, it was great'). " +
      "Sets status='past' and clears it as the group's active event.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "MED-XXXX to archive." },
      },
      required: ["event_id"],
    },
  },
  {
    name: "commitment_add",
    description:
      "Record that a specific person committed to handle a specific " +
      "thing for an event ('Sarah said she'll bring speakers'). Returns " +
      "a CMT-XXXX id. Re-run safely if the same commitment is restated — " +
      "deduped=true means we already had it. If `conflict` is set, " +
      "another person already committed to the same item; consider posting " +
      "a one-line heads up in the group.",
    input_schema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "MED-XXXX from a prior event_create.",
        },
        person_handle: {
          type: "string",
          description: "Handle (phone/email) of the committer.",
        },
        item: {
          type: "string",
          description:
            "What they committed to. Keep concrete: 'speakers', 'hotel booking', 'snacks for 6'.",
        },
        source: {
          type: "string",
          description: "Origin: chat | dm | dashboard. Default chat.",
        },
      },
      required: ["event_id", "person_handle", "item"],
    },
  },
  // flaw #29
  {
    name: "commitment_complete",
    description:
      "Mark a commitment as completed ('Sarah said she got the speakers'). " +
      "Use when the committer explicitly confirms it's done.",
    input_schema: {
      type: "object",
      properties: {
        commitment_id: {
          type: "string",
          description: "CMT-XXXX returned from commitment_add.",
        },
      },
      required: ["commitment_id"],
    },
  },
  // flaw #29
  {
    name: "commitment_miss",
    description:
      "Mark a commitment as missed ('Sarah said she forgot the speakers'). " +
      "Use when the committer drops the ball; don't use for cancellations.",
    input_schema: {
      type: "object",
      properties: {
        commitment_id: {
          type: "string",
          description: "CMT-XXXX returned from commitment_add.",
        },
      },
      required: ["commitment_id"],
    },
  },
];

export async function executeEventTool(toolName, input, ctx = {}) {
  const { normFrom, groupId, isGroup, messageId, tenant } = ctx;
  switch (toolName) {
    case "event_create": {
      const organizerHandle = normFrom;
      if (!organizerHandle) {
        return { error: "event_create requires sender context (normFrom)" };
      }
      try {
        // Thread the trigger Loop message_id through as dedupeKey so a
        // webhook retry across processes resolves to the same event_id
        // (the in-process 10-min cache only catches same-pod dupes).
        const { eventId, row, deduped } = await createEvent({
          groupId: isGroup ? groupId : null,
          type: input.type || "general",
          title: input.title || null,
          startDate: input.start_date || null,
          endDate: input.end_date || null,
          organizerHandle,
          participantHandles: input.participant_handles || [],
          dedupeKey: messageId || null,
        });
        // flaw #27: park the freshly-created (or rediscovered) event id
        // on the group's hot-path memory so the commitment-extractor
        // knows what event to attribute "I'll bring X" to. Best-effort
        // — a group-memory save failure must not error the tool.
        if (isGroup && groupId) {
          try {
            const mem = await loadGroupMemory(groupId, tenant);
            if (mem && mem.currentEventId !== eventId) {
              mem.currentEventId = eventId;
              await saveGroupMemory(groupId, mem, tenant);
            }
          } catch {}
        }
        // flaw #22: when we deduped, give the LLM a clear "don't
        // re-announce" cue so it doesn't post a second "kicked off your
        // EDC plan!" right after the user's bump.
        const base = {
          ok: true,
          event_id: eventId,
          type: row.type,
          title: row.title,
          group_id: row.group_id,
          participants_count: row.participants?.length || 0,
          deduped: !!deduped,
        };
        if (deduped) {
          base.llm_note =
            "This event already exists. I'm reusing it — do not re-announce.";
        }
        return base;
      } catch (err) {
        return { error: `event_create failed: ${err.message}` };
      }
    }
    // flaw #23
    case "event_update": {
      try {
        const result = await updateEvent({
          eventId: input.event_id,
          patch: input.patch || {},
        });
        return {
          ok: true,
          event_id: result.eventId,
          status: result.row?.status,
          title: result.row?.title,
          start_date: result.row?.start_date,
          end_date: result.row?.end_date,
          type: result.row?.type,
        };
      } catch (err) {
        return { error: `event_update failed: ${err.message}` };
      }
    }
    // flaw #24
    case "event_cancel": {
      try {
        const result = await cancelEvent({ eventId: input.event_id });
        // flaw #27: if this group was tracking the event as current, clear it.
        if (isGroup && groupId) {
          try {
            const mem = await loadGroupMemory(groupId, tenant);
            if (mem?.currentEventId === input.event_id) {
              mem.currentEventId = null;
              await saveGroupMemory(groupId, mem, tenant);
            }
          } catch {}
        }
        return {
          ok: true,
          event_id: result.eventId,
          status: result.row?.status,
        };
      } catch (err) {
        return { error: `event_cancel failed: ${err.message}` };
      }
    }
    // flaw #24
    case "event_archive": {
      try {
        const result = await archiveEvent({ eventId: input.event_id });
        // flaw #27: clear currentEventId on archive.
        if (isGroup && groupId) {
          try {
            const mem = await loadGroupMemory(groupId, tenant);
            if (mem?.currentEventId === input.event_id) {
              mem.currentEventId = null;
              await saveGroupMemory(groupId, mem, tenant);
            }
          } catch {}
        }
        return {
          ok: true,
          event_id: result.eventId,
          status: result.row?.status,
        };
      } catch (err) {
        return { error: `event_archive failed: ${err.message}` };
      }
    }
    case "commitment_add": {
      try {
        const result = await addCommitment({
          eventId: input.event_id,
          personHandle: input.person_handle,
          item: input.item,
          source: input.source || "chat",
        });
        // flaw #26: surface conflict to the LLM in the result so it can
        // post a "heads up: X and Y both said Z" line in the group.
        return { ok: true, ...result };
      } catch (err) {
        return { error: `commitment_add failed: ${err.message}` };
      }
    }
    // flaw #29
    case "commitment_complete": {
      try {
        const result = await completeCommitment({
          commitmentId: input.commitment_id,
        });
        return result;
      } catch (err) {
        return { error: `commitment_complete failed: ${err.message}` };
      }
    }
    // flaw #29
    case "commitment_miss": {
      try {
        const result = await missCommitment({
          commitmentId: input.commitment_id,
        });
        return result;
      } catch (err) {
        return { error: `commitment_miss failed: ${err.message}` };
      }
    }
    default:
      return { error: `unknown events tool: ${toolName}` };
  }
}
