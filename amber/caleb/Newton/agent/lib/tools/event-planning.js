/**
 * event-planning.js — personal-event + task tools backed by amber-id's
 * /v1/me/events surface.
 *
 * These tools are distinct from `events-tool.js` (group-chat commitments
 * via BigQuery). This file is for personal planning: Sagar's Rytual retreat,
 * a wedding, a retreat weekend. Each event lives at amber-id under
 *   agent_data/{tenantDid}/events/{event_id}
 * with tasks at
 *   agent_data/{tenantDid}/event_tasks/{task_id}
 * and both flow into the user's Pinecone namespace so "what do I still
 * need to do for the retreat?" resolves via semantic recall.
 *
 * Tools exposed to Claude:
 *   plan_event              create or update a personal event card
 *   plan_event_add_tasks    append a list of task titles to an event
 *   plan_event_list         list the caller's events (newest first)
 *   plan_event_get          fetch one event + its current tasks
 *   plan_event_list_tasks   list tasks for one event, optional status filter
 *   plan_task_update        patch a task (status, title, due_date, notes)
 *   plan_task_complete      shortcut: set a task to status=done
 *
 * Auth: service x-api-key + x-amber-phone (no Privy JWT). Tenant phone is
 * sourced from ctx.tenant.phoneNumber. If amber-id isn't configured, all
 * tools return a structured error so the model can surface that to the user
 * instead of silently dropping the request.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_EventPlanning", [
  "Create or update a personal event card (plan_event)",
  "Add one or many tasks to an event in a single call (plan_event_add_tasks)",
  "List my events, fetch one, list its tasks (plan_event_list, plan_event_get, plan_event_list_tasks)",
  "Update or complete a task (plan_task_update, plan_task_complete)",
]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantPhone(tenant) {
  return tenant?.phoneNumber || tenant?.phone || null;
}

function notConfiguredError() {
  return {
    error: "amber_id_not_configured",
    message:
      "amber-id is not configured for this environment (AMBER_ID_API_URL / AMBER_ID_API_KEY missing). Cannot persist event planning state.",
  };
}

function noPhoneError() {
  return {
    error: "tenant_phone_missing",
    message:
      "Tenant phoneNumber is required to call amber-id /v1/me/events* but was not present on the resolved tenant.",
  };
}

async function callAmberId(method, path, { phone, body, query } = {}) {
  const url = new URL(`${AMBER_ID_API_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const headers = {
    "x-api-key": AMBER_ID_API_KEY,
    "x-amber-phone": phone,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response — leave json null, error path will surface text
  }
  if (!res.ok) {
    return {
      error: json?.error || "amber_id_error",
      message: json?.message || text.slice(0, 400),
      status: res.status,
    };
  }
  return json;
}

// Common card-write field set, mirrored from medha-id's cardPatchSchema.
// Validation is enforced server-side; we keep the schema light here so the
// model can pass through any field the backend accepts without us having
// to mirror the full shape twice.
const eventCardFields = {
  title: {
    type: "string",
    description: "Human title (e.g. 'Rytual Retreat').",
  },
  year: {
    type: "integer",
    description:
      "Year the event occurs. Defaults to current year if omitted. Used to namespace the event id.",
  },
  slug: {
    type: "string",
    description:
      "Optional short URL-safe identifier (e.g. 'rytual-retreat'). Defaults to a slugified title.",
  },
  description: {
    type: "string",
    description: "Free-form description of the event.",
  },
  start_date: {
    type: "string",
    description: "ISO date YYYY-MM-DD when the event starts.",
  },
  end_date: {
    type: "string",
    description: "ISO date YYYY-MM-DD when the event ends.",
  },
  location: { type: "string", description: "Where it happens." },
  status: {
    type: "string",
    enum: ["planning", "confirmed", "completed", "cancelled"],
    description:
      "Event lifecycle. Defaults to 'planning'. Flip to 'confirmed' once the date and location are locked.",
  },
  attendees: {
    type: "array",
    description:
      "Confirmed/invited attendees. Each entry can carry { name, contact_id, role, status }.",
    items: { type: "object" },
  },
};

const taskInputProperties = {
  title: {
    type: "string",
    description: "Short task title (e.g. 'Book an Airbnb').",
  },
  status: {
    type: "string",
    enum: ["open", "done", "blocked"],
    description: "Defaults to 'open' on create.",
  },
  notes: { type: "string", description: "Free-form notes for the task." },
  assigned_to: {
    type: "string",
    description:
      "Who owns this task. Free-form (a contact name, an email, or 'self').",
  },
  due_date: {
    type: "string",
    description: "ISO date YYYY-MM-DD when the task is due.",
  },
  order: {
    type: "integer",
    minimum: 0,
    maximum: 999,
    description:
      "Optional explicit ordinal. Auto-assigned (appended to the end) when omitted.",
  },
};

export const EVENT_PLANNING_TOOLS = [
  {
    name: "plan_event",
    description:
      "Create or update a personal event card. Use whenever the user says " +
      "'note that my next retreat is...', 'please track my wedding on...', " +
      "'add my Rytual retreat 7/17-19', or similar. Returns the full event " +
      "card including the canonical event_id (event:<did>:<slug>:<year>). " +
      "If the event already exists for the same (slug, year), this upserts " +
      "the supplied fields without losing the rest of the card.",
    input_schema: {
      type: "object",
      required: ["title"],
      properties: eventCardFields,
    },
  },
  {
    name: "plan_event_add_tasks",
    description:
      "Append one or more tasks to a personal event in a single call. The " +
      "Sagar Rytual retreat prompt with eight numbered tasks should land in " +
      "ONE plan_event_add_tasks call, not eight. Returns the created task " +
      "rows with their stable task_id values.",
    input_schema: {
      type: "object",
      required: ["event_id", "tasks"],
      properties: {
        event_id: {
          type: "string",
          description:
            "event_id returned by plan_event (looks like event:<did>:<slug>:<year>).",
        },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          description:
            "Tasks to append. Each task must have a title; everything else is optional.",
          items: {
            type: "object",
            required: ["title"],
            properties: taskInputProperties,
          },
        },
      },
    },
  },
  {
    name: "plan_event_list",
    description:
      "List the caller's personal events, newest-updated first. Use when " +
      "the user asks 'what events am I planning?', 'show me my upcoming " +
      "events', or you need to find the right event_id to operate on.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "plan_event_get",
    description:
      "Fetch one event card plus its tasks. Use when the user references a " +
      "specific event and you need full context (dates, location, attendees, " +
      "all tasks with current status).",
    input_schema: {
      type: "object",
      required: ["event_id"],
      properties: {
        event_id: { type: "string" },
        task_status: {
          type: "string",
          enum: ["open", "done", "blocked"],
          description:
            "Optionally narrow the inlined tasks to a single status (e.g. only show open tasks).",
        },
      },
    },
  },
  {
    name: "plan_event_list_tasks",
    description:
      "List tasks for an event. Use when the user asks 'what's left for the " +
      "retreat?', 'what's done?', or you want to enumerate tasks without " +
      "re-pulling the full event card.",
    input_schema: {
      type: "object",
      required: ["event_id"],
      properties: {
        event_id: { type: "string" },
        status: {
          type: "string",
          enum: ["open", "done", "blocked"],
          description: "Optional status filter.",
        },
      },
    },
  },
  {
    name: "plan_task_update",
    description:
      "Patch a task. Use to rename, reassign, set a due date, add notes, " +
      "reorder, or change status. For the common 'mark this done' case, " +
      "prefer plan_task_complete — it reads more naturally in audit history.",
    input_schema: {
      type: "object",
      required: ["event_id", "task_id"],
      properties: {
        event_id: { type: "string" },
        task_id: { type: "string" },
        ...taskInputProperties,
      },
    },
  },
  {
    name: "plan_task_complete",
    description:
      "Mark a task as done. Convenience wrapper over plan_task_update; the " +
      "audit row will read 'task completed: <title>' which is more useful " +
      "for later retrieval than a generic 'task updated'.",
    input_schema: {
      type: "object",
      required: ["event_id", "task_id"],
      properties: {
        event_id: { type: "string" },
        task_id: { type: "string" },
      },
    },
  },
];

export async function executeEventPlanningTool(toolName, input = {}, ctx = {}) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx?.tenant);
  if (!phone) return noPhoneError();

  switch (toolName) {
    case "plan_event": {
      if (!input?.title || typeof input.title !== "string") {
        return { error: "title is required" };
      }
      // Filter to the fields the backend accepts so caller-injected junk
      // doesn't 400 the request at the schema layer.
      const body = {};
      for (const key of Object.keys(eventCardFields)) {
        if (input[key] !== undefined) body[key] = input[key];
      }
      const result = await callAmberId("POST", "/v1/me/events", {
        phone,
        body,
      });
      if (result?.error) return result;
      return {
        ok: true,
        event_id: result.event?.event_id,
        event: result.event,
      };
    }

    case "plan_event_add_tasks": {
      if (!input?.event_id) return { error: "event_id is required" };
      if (!Array.isArray(input?.tasks) || input.tasks.length === 0) {
        return { error: "tasks must be a non-empty array" };
      }
      const result = await callAmberId(
        "POST",
        `/v1/me/events/${encodeURIComponent(input.event_id)}/tasks`,
        { phone, body: { tasks: input.tasks } },
      );
      if (result?.error) return result;
      return { ok: true, count: result.count, tasks: result.tasks };
    }

    case "plan_event_list": {
      const result = await callAmberId("GET", "/v1/me/events", { phone });
      if (result?.error) return result;
      return { ok: true, count: result.count, events: result.events };
    }

    case "plan_event_get": {
      if (!input?.event_id) return { error: "event_id is required" };
      const [event, tasks] = await Promise.all([
        callAmberId(
          "GET",
          `/v1/me/events/${encodeURIComponent(input.event_id)}`,
          { phone },
        ),
        callAmberId(
          "GET",
          `/v1/me/events/${encodeURIComponent(input.event_id)}/tasks`,
          {
            phone,
            query: input.task_status
              ? { status: input.task_status }
              : undefined,
          },
        ),
      ]);
      if (event?.error) return event;
      if (tasks?.error) return tasks;
      return {
        ok: true,
        event: event.event,
        tasks: tasks.tasks || [],
        task_count: tasks.count || 0,
      };
    }

    case "plan_event_list_tasks": {
      if (!input?.event_id) return { error: "event_id is required" };
      const result = await callAmberId(
        "GET",
        `/v1/me/events/${encodeURIComponent(input.event_id)}/tasks`,
        {
          phone,
          query: input.status ? { status: input.status } : undefined,
        },
      );
      if (result?.error) return result;
      return { ok: true, count: result.count, tasks: result.tasks };
    }

    case "plan_task_update": {
      if (!input?.event_id) return { error: "event_id is required" };
      if (!input?.task_id) return { error: "task_id is required" };
      const body = {};
      for (const key of Object.keys(taskInputProperties)) {
        if (input[key] !== undefined) body[key] = input[key];
      }
      const result = await callAmberId(
        "PATCH",
        `/v1/me/events/${encodeURIComponent(input.event_id)}/tasks/${encodeURIComponent(input.task_id)}`,
        { phone, body },
      );
      if (result?.error) return result;
      return { ok: true, task: result.task };
    }

    case "plan_task_complete": {
      if (!input?.event_id) return { error: "event_id is required" };
      if (!input?.task_id) return { error: "task_id is required" };
      const result = await callAmberId(
        "PATCH",
        `/v1/me/events/${encodeURIComponent(input.event_id)}/tasks/${encodeURIComponent(input.task_id)}`,
        { phone, body: { status: "done" } },
      );
      if (result?.error) return result;
      return { ok: true, task: result.task };
    }

    default:
      return { error: `Unknown event_planning tool: ${toolName}` };
  }
}
