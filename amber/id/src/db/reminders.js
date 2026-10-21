/**
 * Reminder persistence — Firestore-backed.
 *
 * Tab 16 of the 2026-05-28 dispatch. The medha-platform `schedule_reminder`
 * tool (PR #174, merged) already writes rows to the flat top-level
 * `pending_reminders/{reminder_id}` collection. This module is the medha-id
 * read/write surface for the same collection — symmetric so the agent tool,
 * the user-facing Privy endpoints, and the delivery worker all operate on
 * one source of truth.
 *
 * Row shape (matches medha-platform Newton/agent/lib/tools/reminders.js):
 *
 *   {
 *     reminder_id:       "rem_<uuid>",
 *     tenant_did:        "did:privy:...",       // owner of the reminder
 *     requester_phone:   "+1...",               // null if unknown
 *     recipient_input:   "<raw input>",
 *     recipient: {
 *       transport:       "imessage"|"slack"|"email",
 *       address:         "+1..." | "user@..." | "@handle",
 *       kind:            "self"|"phone"|"email"|"handle",
 *       needs_resolution: boolean,
 *     },
 *     when: {
 *       iso:             "2026-05-28T17:00:00.000Z",
 *       source:          "iso"|"relative"|"phrase"|"date_default_9am",
 *       input:           "<raw when>",
 *       timezone:        "America/Los_Angeles",
 *     },
 *     message:           "<body>",
 *     cc_requester:      boolean,
 *     status:            "pending"|"fired"|"cancelled"|"failed",
 *     created_at:        "<ISO>",
 *     fired_at:          "<ISO>" | null,
 *     attempts:          number,
 *     last_error?:       "<string>",
 *     related_event_id?: string,
 *     related_task_id?:  string,
 *   }
 *
 * The collection is intentionally flat (not nested under tenant DID) so that
 * the worker can query "all pending rows whose when.iso <= now" with a single
 * indexed Firestore query, and so that the existing platform writes already
 * line up. Per-tenant access is enforced by always filtering on `tenant_did`
 * inside any caller-facing function.
 *
 * Fails open: if Firestore is unavailable, list/get return [] / null and the
 * write/update functions throw. Callers should map the throw to a 503 so the
 * agent knows to fall back to task_create.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";
import { resolveAmberIdByPrivyDid } from "./store.js";

// Kept for backward-compat with any importer; now the amber table name.
export const REMINDERS_COLLECTION = "reminders";

// "done" is the user ticking a reminder off in the app, and it is deliberately
// a STATUS rather than a flag in `data`. Every delivery scan in this codebase
// -- listDueReminders here, listDueSelfReminders in self-reminders.js -- filters
// on status = 'pending', so a reminder the user has already handled stops being
// deliverable the moment it is ticked, with no change to either scan. A flag
// would have needed both of them edited to honor it, and the one that got
// missed would text the user about something they had already done.
export const REMINDER_STATUSES = [
  "pending",
  "fired",
  "cancelled",
  "failed",
  "done",
];
export const REMINDER_TRANSPORTS = ["imessage", "slack", "email"];

function nowIso() {
  return new Date().toISOString();
}

function newReminderId() {
  return `rem_${crypto.randomUUID()}`;
}

function badRequest(code, message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  return err;
}

/**
 * Normalize a user-supplied reminder body into the canonical row shape.
 *
 * Used by the medha-id POST /v1/me/reminders route. The agent-side
 * schedule_reminder tool already produces the canonical shape directly,
 * so it bypasses this normalizer.
 */
export function normalizeReminderBody(body, { privyDid, requesterPhone }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "reminder body must be an object");
  }
  const message = String(body.message || "").trim();
  if (!message) throw badRequest("missing_message", "message is required");
  if (message.length > 4000) {
    throw badRequest("message_too_long", "message max length is 4000");
  }

  const whenInput = body.when || body.fire_at || null;
  let whenIso = null;
  let whenSource = "iso";
  if (typeof whenInput === "string" && whenInput.length <= 64) {
    const parsed = new Date(whenInput);
    if (!Number.isNaN(parsed.getTime())) {
      whenIso = parsed.toISOString();
    }
  }
  if (!whenIso) {
    throw badRequest(
      "invalid_when",
      "when must be an ISO 8601 timestamp (route accepts only ISO; use the schedule_reminder agent tool for natural-language parsing)",
    );
  }

  const transport = String(body.transport || "imessage").toLowerCase();
  if (!REMINDER_TRANSPORTS.includes(transport)) {
    throw badRequest(
      "invalid_transport",
      `transport must be one of ${REMINDER_TRANSPORTS.join(", ")}`,
    );
  }

  const address = String(body.recipient_address || body.address || "").trim();
  if (!address) {
    throw badRequest(
      "missing_recipient_address",
      "recipient_address is required",
    );
  }
  if (address.length > 200) {
    throw badRequest(
      "recipient_address_too_long",
      "recipient_address max length is 200",
    );
  }

  const kind =
    body.recipient_kind ||
    (transport === "email"
      ? "email"
      : transport === "slack"
        ? "handle"
        : "phone");

  const ccRequester = Boolean(body.cc_requester);
  const tz = String(body.timezone || "America/Los_Angeles").slice(0, 64);

  return {
    reminder_id: newReminderId(),
    tenant_did: privyDid,
    requester_phone: requesterPhone || null,
    recipient_input: body.recipient_input
      ? String(body.recipient_input).slice(0, 200)
      : address,
    recipient: {
      transport,
      address,
      kind,
      needs_resolution: Boolean(body.needs_resolution),
    },
    when: {
      iso: whenIso,
      source: whenSource,
      input: typeof whenInput === "string" ? whenInput : whenIso,
      timezone: tz,
    },
    message,
    cc_requester: ccRequester,
    status: "pending",
    created_at: nowIso(),
    fired_at: null,
    attempts: 0,
    ...(body.related_event_id
      ? { related_event_id: String(body.related_event_id).slice(0, 120) }
      : {}),
    ...(body.related_task_id
      ? { related_task_id: String(body.related_task_id).slice(0, 120) }
      : {}),
    ...(body.source
      ? { source: String(body.source).slice(0, 40) }
      : { source: "user" }),
  };
}

// ── amber-backed helpers ─────────────────────────────────────────────────
// The full canonical reminder row lives in the `data` jsonb column; the
// filterable fields (owner_id, status, due_at, created_at) are mirrored as
// real columns for the tenant list and the worker's due scan. Every function
// returns the full row shape (the `data` object) so consumers are unchanged.

// Fetch just the mutable state needed for a patch. Returns null if missing.
async function _readReminderRow(reminderId) {
  const { rows } = await query(
    `SELECT owner_id, status, data FROM reminders WHERE reminder_id = $1`,
    [reminderId],
  );
  return rows[0] ?? null;
}

/**
 * Persist a reminder row (UPSERT on reminder_id). Throws on DB error so callers
 * can return a 5xx; the agent tool catches its own write failures separately
 * and falls open to task_create. owner_id is the amber_id resolved from
 * tenant_did (NULL if it doesn't resolve — the row is still stored so the
 * global worker can fire it).
 */
export async function createReminder(reminder) {
  if (!reminder?.reminder_id || !reminder?.tenant_did) {
    throw badRequest("invalid_reminder", "reminder_id and tenant_did required");
  }
  const ownerId = await resolveAmberIdByPrivyDid(reminder.tenant_did);
  const dueAt = typeof reminder?.when?.iso === "string" ? reminder.when.iso : null;
  const status = reminder.status || "pending";
  await query(
    `INSERT INTO reminders (reminder_id, owner_id, status, due_at, created_at, data)
     VALUES ($1, $2, $3, $4::timestamptz, COALESCE($5::timestamptz, now()), $6::jsonb)
     ON CONFLICT (reminder_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           status   = EXCLUDED.status,
           due_at   = EXCLUDED.due_at,
           data     = COALESCE(reminders.data, '{}'::jsonb) || EXCLUDED.data`,
    [
      reminder.reminder_id,
      ownerId,
      status,
      dueAt,
      reminder.created_at ?? null,
      JSON.stringify(reminder),
    ],
  );
  return reminder;
}

export async function getReminder(reminderId) {
  if (!reminderId) return null;
  try {
    const { rows } = await query(
      `SELECT data FROM reminders WHERE reminder_id = $1`,
      [reminderId],
    );
    return rows[0]?.data ?? null;
  } catch {
    return null; // fail open on read
  }
}

/**
 * List reminders for a tenant, newest-first by created_at, optionally filtered
 * by status (default "pending"; falsy status lists all). Resolves the tenant
 * DID to amber_id; an unresolved DID returns [].
 */
export async function listRemindersForTenant(
  privyDid,
  { status = "pending", limit = 50 } = {},
) {
  if (!privyDid) return [];
  const ownerId = await resolveAmberIdByPrivyDid(privyDid);
  if (!ownerId) return [];
  const lim = Math.max(1, Math.min(limit, 200));
  try {
    const { rows } = status
      ? await query(
          `SELECT data FROM reminders
            WHERE owner_id = $1 AND status = $2
            ORDER BY created_at DESC
            LIMIT $3`,
          [ownerId, status, lim],
        )
      : await query(
          `SELECT data FROM reminders
            WHERE owner_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [ownerId, lim],
        );
    return rows.map((r) => r.data);
  } catch {
    return [];
  }
}

/**
 * Mark a reminder cancelled. Only the tenant who owns it may cancel.
 * Returns the updated row, the unchanged row if not pending, or null if not
 * found / not owned.
 */
export async function cancelReminder(reminderId, { privyDid } = {}) {
  if (!reminderId || !privyDid) return null;
  const ownerId = await resolveAmberIdByPrivyDid(privyDid);
  if (!ownerId) return null;
  const row = await _readReminderRow(reminderId);
  if (!row) return null;
  if (row.owner_id !== ownerId) return null; // not owned
  if (row.status !== "pending") return row.data; // return unchanged
  const merged = { ...row.data, status: "cancelled", cancelled_at: nowIso() };
  await query(
    `UPDATE reminders SET status = 'cancelled', data = $2::jsonb WHERE reminder_id = $1`,
    [reminderId, JSON.stringify(merged)],
  );
  return merged;
}

/**
 * Find rows whose due_at has already passed and are still pending, oldest-first,
 * capped at `limit`. Global across owners (the worker fires everyone's due
 * reminders). Clean indexed query on (status, due_at) — the top-level due_at
 * column the Firestore version wished for.
 */
export async function listDueReminders(now = new Date(), limit = 50) {
  const lim = Math.max(1, Math.min(limit, 500));
  try {
    const { rows } = await query(
      `SELECT data FROM reminders
        WHERE status = 'pending' AND due_at IS NOT NULL AND due_at <= $1::timestamptz
        ORDER BY due_at ASC
        LIMIT $2`,
      [now.toISOString(), lim],
    );
    return rows.map((r) => r.data);
  } catch {
    return [];
  }
}

/**
 * Record a successful fire. Sets status=fired and fired_at=now.
 * Returns the updated row, or null if the reminder no longer exists.
 */
export async function markReminderFired(reminderId, { firedAt } = {}) {
  if (!reminderId) return null;
  const row = await _readReminderRow(reminderId);
  if (!row) return null;
  const merged = { ...row.data, status: "fired", fired_at: firedAt || nowIso() };
  await query(
    `UPDATE reminders SET status = 'fired', data = $2::jsonb WHERE reminder_id = $1`,
    [reminderId, JSON.stringify(merged)],
  );
  return merged;
}

/**
 * Persist a resolved recipient onto a reminder row (Tab 31). The whole
 * `recipient` map is replaced; status is unchanged. Returns the updated row,
 * or null if the reminder no longer exists.
 */
export async function markReminderResolved(reminderId, recipient) {
  if (!reminderId || !recipient || typeof recipient !== "object") return null;
  const row = await _readReminderRow(reminderId);
  if (!row) return null;
  const merged = {
    ...row.data,
    recipient,
    recipient_resolved_at: nowIso(),
  };
  await query(
    `UPDATE reminders SET data = $2::jsonb WHERE reminder_id = $1`,
    [reminderId, JSON.stringify(merged)],
  );
  return merged;
}

/**
 * Record a failed fire attempt. Increments attempts; if attempts >= maxAttempts,
 * marks the row `failed` so the worker stops retrying. Otherwise leaves the
 * status unchanged and the worker retries next tick.
 */
export async function markReminderAttemptFailed(
  reminderId,
  { reason, maxAttempts = 5 } = {},
) {
  if (!reminderId) return null;
  const row = await _readReminderRow(reminderId);
  if (!row) return null;
  const data = row.data;
  const attempts = (Number(data.attempts) || 0) + 1;
  const merged = {
    ...data,
    attempts,
    last_error: reason ? String(reason).slice(0, 500) : "unknown",
    last_attempt_at: nowIso(),
  };
  if (attempts >= maxAttempts) {
    merged.status = "failed";
    merged.failed_at = nowIso();
  }
  await query(
    `UPDATE reminders SET status = $2, data = $3::jsonb WHERE reminder_id = $1`,
    [reminderId, merged.status, JSON.stringify(merged)],
  );
  return merged;
}
