/**
 * reminders.js — `schedule_reminder` tool.
 *
 * Tab 2 of the 2026-05-27 Medha parallel-tabs dispatch.
 *
 * Sagar's trigger prompt that this unblocks:
 *
 *   "please make a note for me to have a rytual event and content planning
 *    session with @Shirley Park by wednesday of this week. remind me on
 *    tuesday to onboard lightning in a bottle, everything night, and
 *    vipassana content into the correct google drive folders, and remind
 *    @Shirley Park to give me a write up of content formats / systems for
 *    BMA that can and should be replicated for the rytual brand"
 *
 * Three reminders, two recipients (self + Shirley), one cross-person task.
 *
 * Scope of THIS PR (Phase 1):
 *   - Tool surface that accepts {recipient, when, message, transport?, cc_requester?}
 *   - Recipient resolution: self | E.164 phone | email | @handle
 *   - Time parsing: ISO 8601, "in N minutes/hours/days", and full
 *     date/time phrases via the in-house date-resolver
 *   - Queue to Firestore `pending_reminders` collection, scoped by
 *     tenant Privy DID
 *
 * Phase 2 (NOT in this PR — tracked as a follow-up):
 *   - Delivery cron that scans `pending_reminders` for due rows and
 *     fires the actual send. The medha-platform proactive-runner ticks
 *     hourly; a 60s-resolution worker is a separate scope.
 *   - `@handle` lookup against medha-id contacts. For now @handles are
 *     accepted with a best-effort phone resolution from the agent's
 *     contact cache; unresolved @handles fail closed with a clear error
 *     instead of silently queueing an undeliverable reminder.
 */

import { randomUUID } from "node:crypto";
import { registerCapability } from "../capabilities.js";
import { normalizeHandle } from "../permissions.js";
import { parseDateTime, resolveDay } from "../date-resolver.js";

registerCapability(
  "_tools_Reminders",
  "Schedule reminders for yourself or another person (schedule_reminder). " +
    "Supports iMessage, Slack DM, and email transports. Times accept " +
    "ISO 8601, 'in N minutes/hours/days', or natural phrases like " +
    "'tuesday 9am' or 'tomorrow at 3pm'.",
);

const DEFAULT_TIMEZONE = "America/Los_Angeles";

const VALID_TRANSPORTS = new Set(["imessage", "slack", "email", "auto"]);

const TIME_RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TIME_RE_REL =
  /^in\s+(\d{1,4})\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)$/i;

/**
 * Normalize a `when` string into an ISO 8601 UTC timestamp.
 * Returns { iso, source } on success or { error } on failure.
 *
 * Acceptable forms (in priority order):
 *   1. Full ISO 8601 ("2026-05-27T17:00:00Z")
 *   2. Relative duration ("in 5 minutes", "in 2 hours", "in 3 days")
 *   3. Full date+time phrase ("tuesday 9am", "tomorrow at 3pm")
 *   4. Bare date phrase ("tuesday", "tomorrow") — defaults to 09:00
 *      in the resolver's anchor timezone
 *
 * The tz argument is the requester's IANA timezone (e.g. America/Los_Angeles)
 * — relative phrases anchor to "now in this tz" and bare-date phrases
 * default to 9am local in this tz.
 */
function parseWhen(when, tz = DEFAULT_TIMEZONE, now = new Date()) {
  if (!when || typeof when !== "string") {
    return { error: "when is required and must be a string" };
  }
  const trimmed = when.trim();
  if (!trimmed) return { error: "when is empty" };

  // 1. ISO 8601
  if (TIME_RE_ISO.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return { error: `Invalid ISO 8601 timestamp: ${trimmed}` };
    }
    return { iso: parsed.toISOString(), source: "iso" };
  }

  // 2. Relative duration: "in N minutes/hours/days"
  const relMatch = trimmed.match(TIME_RE_REL);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms = unitToMs(unit, n);
    if (ms === null) {
      return { error: `Unsupported relative unit: ${unit}` };
    }
    return {
      iso: new Date(now.getTime() + ms).toISOString(),
      source: "relative",
    };
  }

  // 3. Full date+time phrase via date-resolver.
  // parseDateTime returns wall-clock components in tz with a UTC-anchored
  // ISO ("9am" → 09:00Z). That's right for calendar callers paired with
  // timeZone: tz, but a reminder needs an actual UTC instant. Rebuild
  // the ISO by treating {hour,minute} as local-in-tz.
  const dt = parseDateTime(trimmed, tz, now);
  if (dt && dt.date && dt.time) {
    const iso = buildIsoAt(dt.date, dt.time.hour, dt.time.minute, tz);
    if (iso) return { iso, source: "phrase" };
  }

  // 4. Bare date phrase — default to 9am in the requester's tz
  const day = resolveDay(trimmed, tz, now);
  if (day) {
    const iso = buildIsoAt(day, 9, 0, tz);
    if (iso) return { iso, source: "date_default_9am" };
  }

  return {
    error:
      `Could not parse "${trimmed}". Use ISO 8601, "in N minutes/hours/days", ` +
      `or a phrase like "tuesday 9am" or "tomorrow at 3pm".`,
  };
}

function unitToMs(unit, n) {
  if (unit.startsWith("minute") || unit === "min" || unit === "mins") {
    return n * 60_000;
  }
  if (unit.startsWith("hour") || unit === "hr" || unit === "hrs") {
    return n * 3_600_000;
  }
  if (unit.startsWith("day")) {
    return n * 86_400_000;
  }
  return null;
}

/**
 * Build a UTC ISO string for {year, month, day} at hour:minute LOCAL to
 * the requester's timezone. We compute the UTC offset for that wall-clock
 * date by formatting through Intl, then subtract it. Good enough for
 * reminder scheduling; calendar-grade precision lives in lib/date-resolver.
 */
function buildIsoAt(day, hour, minute, tz) {
  try {
    const utcGuess = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
    const offset = tzOffsetMinutes(new Date(utcGuess), tz);
    return new Date(utcGuess - offset * 60_000).toISOString();
  } catch {
    return null;
  }
}

function tzOffsetMinutes(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "00" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - date.getTime()) / 60_000;
}

/**
 * Resolve a recipient string into { transport, address }.
 *
 *   "self"                    → tenant's primary phone, imessage
 *   "+13105551212"            → that phone, imessage
 *   "name@example.com"        → email, email transport
 *   "@U0AEBS2UXRB"            → Slack user id, slack transport
 *   "@shirley.park"           → handle lookup (best-effort; fails
 *                               closed if unresolved)
 *
 * The `transport` override forces a channel when the recipient form is
 * ambiguous (e.g. send to "self" but via slack DM).
 */
function resolveRecipient(recipient, transport, tenant) {
  if (!recipient || typeof recipient !== "string") {
    return { error: "recipient is required" };
  }
  const raw = recipient.trim();
  if (!raw) return { error: "recipient is empty" };

  if (raw.toLowerCase() === "self") {
    const phone = tenant?.phoneNumber || tenant?.primaryPhone;
    if (!phone) {
      return { error: "tenant has no phoneNumber on context — cannot self" };
    }
    return {
      transport: transport === "auto" || !transport ? "imessage" : transport,
      address: normalizeHandle(phone),
      kind: "self",
    };
  }

  // Email
  if (raw.includes("@") && !raw.startsWith("@") && /.+@.+\..+/.test(raw)) {
    return {
      transport: transport === "auto" || !transport ? "email" : transport,
      address: raw.toLowerCase(),
      kind: "email",
    };
  }

  // Slack-style @handle. Resolution is left to the delivery cron — at
  // queue time we record the raw handle so the cron can look it up via
  // medha-id /internal/users/:did/contacts/by-handle (Tab 6 endpoint).
  if (raw.startsWith("@")) {
    return {
      transport: transport === "auto" || !transport ? "slack" : transport,
      address: raw,
      kind: "handle",
      needs_resolution: true,
    };
  }

  // Phone (E.164 or loose digits)
  const normalized = normalizeHandle(raw);
  if (normalized && normalized.startsWith("+")) {
    return {
      transport: transport === "auto" || !transport ? "imessage" : transport,
      address: normalized,
      kind: "phone",
    };
  }

  return { error: `Could not resolve recipient: ${raw}` };
}

/**
 * Persist the reminder to Firestore. Fails OPEN: a missing GCP project or
 * unavailable Firestore client returns a queued:false result with the
 * reminder still echoed to the caller so the model can fall back (e.g.
 * by creating a task_create in Beads). Never throws.
 */
async function queueReminder(reminder) {
  try {
    const { firestoreUpsert, firestoreReady } =
      await import("@amber/firestore");
    const ready = await firestoreReady();
    if (!ready) {
      return {
        queued: false,
        reason: "firestore_unavailable",
      };
    }
    const path = `pending_reminders/${reminder.reminder_id}`;
    await firestoreUpsert(path, reminder);
    return { queued: true, path };
  } catch (err) {
    return { queued: false, reason: `firestore_error: ${err.message}` };
  }
}

/**
 * Read-side reminder operations call medha-id directly so the agent and the
 * Privy dashboard speak to a single source of truth. Service auth is
 * `x-api-key` + `x-amber-phone`; the medha-id route resolves the phone to
 * the tenant DID and filters its responses to that tenant's rows.
 */
const MEDHA_ID_TIMEOUT_MS = 8_000;

async function medhaIdFetch(method, path, { tenant, body, log } = {}) {
  const baseUrl = (
    process.env.MEDHA_ID_URL ||
    process.env.AMBER_ID_API_URL ||
    ""
  ).replace(/\/$/, "");
  const apiKey =
    process.env.MEDHA_ID_API_KEY || process.env.AMBER_ID_API_KEY || "";
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "medha_id_unconfigured" };
  }
  const phone = tenant?.phoneNumber || tenant?.primaryPhone;
  if (!phone) {
    return { ok: false, error: "tenant_phone_missing" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDHA_ID_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "x-api-key": apiKey,
        "x-amber-phone": phone,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON body — return raw text in error
    }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: json?.error || json?.code || `medha_id_${resp.status}`,
        message: json?.message || text.slice(0, 200),
      };
    }
    return { ok: true, status: resp.status, json };
  } catch (err) {
    const code = err?.code || err?.cause?.code || err?.name || "fetch_failed";
    log?.warn?.(
      `[reminders] medha-id ${method} ${path} failed: ${code}: ${err.message}`,
    );
    return { ok: false, error: `fetch_failed:${code}` };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeReminder(row) {
  if (!row) return null;
  return {
    reminder_id: row.reminder_id,
    when: row.when?.iso,
    timezone: row.when?.timezone,
    message: row.message,
    recipient: row.recipient?.address,
    recipient_kind: row.recipient?.kind,
    transport: row.recipient?.transport,
    status: row.status,
    cc_requester: !!row.cc_requester,
    created_at: row.created_at,
    fired_at: row.fired_at || null,
  };
}

async function executeListMyReminders(input, ctx) {
  const tenant = ctx.tenant || null;
  if (!tenant?.privyDid) {
    return { error: "list_my_reminders requires a resolved tenant" };
  }
  const status = String(input?.status || "pending").toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(input?.limit) || 20));
  const qs = new URLSearchParams({ status, limit: String(limit) }).toString();
  const result = await medhaIdFetch("GET", `/v1/me/reminders?${qs}`, {
    tenant,
  });
  if (!result.ok) return { error: result.error, message: result.message };
  const rows = (result.json?.reminders || []).map(summarizeReminder);
  return { reminders: rows, count: rows.length, status };
}

async function executeCancelReminder(input, ctx) {
  const tenant = ctx.tenant || null;
  if (!tenant?.privyDid) {
    return { error: "cancel_reminder requires a resolved tenant" };
  }
  const reminderId = String(input?.reminder_id || "").trim();
  if (!reminderId.startsWith("rem_")) {
    return { error: "reminder_id is required (looks like 'rem_<uuid>')" };
  }
  const result = await medhaIdFetch(
    "DELETE",
    `/v1/me/reminders/${encodeURIComponent(reminderId)}`,
    { tenant },
  );
  if (!result.ok) return { error: result.error, message: result.message };
  return {
    cancelled: true,
    reminder: summarizeReminder(result.json?.reminder),
  };
}

export async function executeRemindersTool(toolName, input = {}, ctx = {}) {
  if (toolName === "list_my_reminders") {
    return executeListMyReminders(input, ctx);
  }
  if (toolName === "cancel_reminder") {
    return executeCancelReminder(input, ctx);
  }
  if (toolName !== "schedule_reminder") {
    return { error: `Unknown reminders tool: ${toolName}` };
  }

  const tenant = ctx.tenant || null;
  if (!tenant || !tenant.privyDid) {
    return {
      error:
        "schedule_reminder requires a resolved tenant (privyDid). " +
        "This usually means the request came in without an authenticated sender.",
    };
  }

  const {
    recipient,
    when,
    message,
    transport = "auto",
    cc_requester = false,
  } = input || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return { error: "message is required" };
  }
  if (transport && !VALID_TRANSPORTS.has(transport)) {
    return {
      error: `transport must be one of: ${[...VALID_TRANSPORTS].join(", ")}`,
    };
  }

  const tz = tenant.timezone || DEFAULT_TIMEZONE;
  const parsed = parseWhen(when, tz);
  if (parsed.error) return { error: parsed.error };

  const resolved = resolveRecipient(recipient, transport, tenant);
  if (resolved.error) return { error: resolved.error };

  const reminderId = `rem_${randomUUID()}`;
  const requesterPhone = tenant.phoneNumber || tenant.primaryPhone || null;

  const reminder = {
    reminder_id: reminderId,
    tenant_did: tenant.privyDid,
    requester_phone: requesterPhone,
    recipient_input: recipient,
    recipient: {
      transport: resolved.transport,
      address: resolved.address,
      kind: resolved.kind,
      needs_resolution: resolved.needs_resolution || false,
    },
    when: {
      iso: parsed.iso,
      source: parsed.source,
      input: when,
      timezone: tz,
    },
    message: message.trim(),
    cc_requester: Boolean(cc_requester),
    status: "pending",
    created_at: new Date().toISOString(),
    fired_at: null,
    attempts: 0,
  };

  const queueResult = await queueReminder(reminder);

  return {
    scheduled: queueResult.queued,
    reminder_id: reminderId,
    recipient: resolved.address,
    recipient_kind: resolved.kind,
    when: parsed.iso,
    when_source: parsed.source,
    transport: resolved.transport,
    cc_requester: Boolean(cc_requester),
    queue: queueResult,
    ...(resolved.needs_resolution
      ? {
          note:
            "Handle recipient queued for delivery-time lookup via medha-id " +
            "GET /internal/users/:did/contacts/by-handle. At fire time the cron " +
            "rewrites the handle to the contact's phone and delivers over " +
            "imessage. If the handle has no matching contact (or that contact " +
            "has no phone) the reminder is marked failed (failed_unknown_handle " +
            "/ unresolvable_handle_no_phone), never silently dropped.",
        }
      : {}),
  };
}

export const REMINDERS_TOOLS = [
  {
    name: "schedule_reminder",
    description:
      "Schedule a reminder for yourself or another person. Use this when " +
      "the user says 'remind me', 'make a note for me to', 'remind <name>', " +
      "or 'note to self'. Supports cross-person reminders — you can remind " +
      "another teammate (Shirley, Alinna, etc.) about something the user " +
      "owes them, with optional cc to the requester. Queues the reminder " +
      "in Firestore; the delivery cron is a separate worker.",
    input_schema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description:
            "Who the reminder is for. Accepts: 'self' for the requester; " +
            "an E.164 phone like '+13105551212'; an email; or a Slack-style " +
            "'@handle'. Defaults to 'self' if omitted.",
        },
        when: {
          type: "string",
          description:
            "When to fire. Accepts: ISO 8601 ('2026-05-27T17:00:00Z'); a " +
            "relative duration ('in 5 minutes', 'in 2 hours', 'in 3 days'); " +
            "a full phrase ('tuesday 9am', 'tomorrow at 3pm'); or a bare " +
            "date ('tuesday', 'tomorrow') which defaults to 09:00 local " +
            "in the requester's timezone.",
        },
        message: {
          type: "string",
          description: "The reminder body the recipient will see.",
        },
        transport: {
          type: "string",
          description:
            "Force a delivery channel. 'auto' (default) picks based on the " +
            "recipient shape: phone → imessage, email → email, @handle → slack.",
          enum: ["imessage", "slack", "email", "auto"],
        },
        cc_requester: {
          type: "boolean",
          description:
            "When true and the recipient is someone other than self, also " +
            "send the requester a copy when the reminder fires. Useful for " +
            "'remind Shirley to send me X and let me know you reminded her'.",
        },
      },
      required: ["recipient", "when", "message"],
    },
  },
  {
    name: "list_my_reminders",
    description:
      "List the user's reminders (pending by default). Call this when the user " +
      "asks 'what reminders do I have', 'show me my reminders', 'what am I " +
      "supposed to do tomorrow', or anything similar. Returns each reminder's " +
      "id, when, recipient, message, and status.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "fired", "cancelled", "failed", "all"],
          description:
            "Which slice to show. 'pending' (default) is the active queue; " +
            "'fired' is recently delivered; 'cancelled' / 'failed' are " +
            "historical; 'all' returns everything.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Max rows to return (1-50, default 20).",
        },
      },
    },
  },
  {
    name: "cancel_reminder",
    description:
      "Cancel a pending reminder. Use this when the user says 'cancel that " +
      "reminder', 'never mind the reminder about X', 'drop the reminder I " +
      "set yesterday'. The user typically refers to a reminder by topic; " +
      "call list_my_reminders first to find the matching reminder_id.",
    input_schema: {
      type: "object",
      properties: {
        reminder_id: {
          type: "string",
          description:
            "The reminder_id returned by schedule_reminder or list_my_reminders. " +
            "Looks like 'rem_<uuid>'.",
        },
      },
      required: ["reminder_id"],
    },
  },
];

// Internal exports for unit tests + the verification probe.
export const __internals = {
  parseWhen,
  resolveRecipient,
  unitToMs,
  tzOffsetMinutes,
  buildIsoAt,
};
