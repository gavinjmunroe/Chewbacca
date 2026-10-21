/**
 * Reminder delivery worker.
 *
 * Tab 16 of the 2026-05-28 dispatch. Runs every REMINDER_TICK_MS milliseconds
 * (default 60000) and:
 *
 *   1. Pulls pending reminders whose when.iso has elapsed via
 *      listDueReminders (db/reminders.js).
 *   2. For each, if the recipient is an unresolved "@handle" (Tab 31), looks
 *      the handle up in the tenant's address book and rewrites the row to a
 *      concrete contact phone before delivery. Unknown handles fail terminally.
 *   3. Dispatches the message via the appropriate transport. Today: iMessage
 *      via medha-platform's POST /admin/send-message endpoint. Slack and email
 *      are recognized but mark the row terminal (instead of silently dropping)
 *      until their delivery paths land.
 *   4. On a successful non-self delivery, if cc_requester is set, sends the
 *      requester a short fyi so they know the reminder went out (Tab 31).
 *   5. Marks the row fired (success) or records the attempt (failure). After
 *      MAX_ATTEMPTS the row flips to `failed` so the worker stops retrying.
 *
 * The worker is gated by ENABLE_REMINDER_WORKER === "1" so it only ticks in
 * the Railway production env where MEDHA_PLATFORM_URL +
 * MEDHA_PLATFORM_ADMIN_TOKEN are configured. In dev, leave the flag unset
 * and exercise the underlying db helpers directly in tests.
 *
 * Failure semantics:
 *   - Network / 5xx errors from the platform → markReminderAttemptFailed.
 *     The worker retries on the next tick until MAX_ATTEMPTS is exhausted.
 *   - 4xx from the platform (validation errors) → markReminderAttemptFailed
 *     with the platform's error body recorded; eventually flips to `failed`.
 *   - Unsupported transport → single attempt with explicit reason, then
 *     terminal `failed` so we don't loop forever on a known-unsupported row.
 *   - Unknown handle (no matching contact) or a matched contact with no phone
 *     → terminal `failed` (failed_unknown_handle / unresolvable_handle_no_phone).
 *   - A transient resolver error (Firestore blip) → retry on the next tick.
 *   - The cc fyi is best-effort: a failed cc never fails the reminder itself.
 *   - The worker never throws. One bad row never blocks the others.
 */

import {
  listDueReminders,
  markReminderFired,
  markReminderAttemptFailed,
  markReminderResolved,
} from "../db/reminders.js";
import { findContactByHandle, normalizePhoneList } from "../db/user-store.js";
import { resolveAmberIdByPrivyDid } from "../db/store.js";

const DEFAULT_TICK_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;

function getConfig() {
  return {
    platformUrl: (process.env.MEDHA_PLATFORM_URL || "").replace(/\/$/, ""),
    adminToken: process.env.MEDHA_PLATFORM_ADMIN_TOKEN || "",
    tickMs: Number(process.env.REMINDER_TICK_MS) || DEFAULT_TICK_MS,
  };
}

/**
 * Send one text to one address via medha-platform's POST /admin/send-message.
 * Shared by both the primary reminder delivery and the cc_requester fyi.
 * Returns { ok } on success, or { ok:false, terminal, reason } so the caller
 * decides whether to retry. Never throws.
 */
async function sendViaPlatform(
  { to, text },
  { platformUrl, adminToken, fetchImpl },
) {
  if (!platformUrl || !adminToken) {
    return { ok: false, terminal: false, reason: "platform_unconfigured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await (fetchImpl || fetch)(
      `${platformUrl}/admin/send-message`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ to, text }),
        signal: controller.signal,
      },
    );
    const body = await resp.text().catch(() => "");
    if (!resp.ok) {
      const terminal = resp.status >= 400 && resp.status < 500;
      return {
        ok: false,
        terminal,
        reason: `platform_${resp.status}:${body.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const code = err?.code || err?.cause?.code || err?.name || "unknown";
    return {
      ok: false,
      terminal: false,
      reason: `fetch_failed:${code}:${(err.message || "").slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire one reminder via medha-platform's /admin/send-message. iMessage only;
 * Slack/email return { ok: false, reason: "unsupported_transport" }.
 */
async function deliverReminder(
  reminder,
  { platformUrl, adminToken, fetchImpl },
) {
  const transport = reminder?.recipient?.transport;
  const address = reminder?.recipient?.address;
  const message = reminder?.message;
  if (!transport || !address || !message) {
    return {
      ok: false,
      terminal: true,
      reason: "malformed_reminder_row",
    };
  }

  if (transport !== "imessage") {
    // Slack and email require their own delivery endpoints. Mark terminal so
    // the worker stops retrying — landing those transports is a separate PR.
    return {
      ok: false,
      terminal: true,
      reason: `unsupported_transport:${transport}`,
    };
  }

  return sendViaPlatform(
    { to: address, text: message },
    { platformUrl, adminToken, fetchImpl },
  );
}

/**
 * Pick a deliverable E.164 phone from a resolved contact row. Prefers the
 * pre-normalized list written on upsert; falls back to normalizing the raw
 * phoneNumbers at read time for legacy contact docs. Returns null when the
 * contact has no usable phone.
 */
function pickContactPhone(contact) {
  const normalized = Array.isArray(contact?.phoneNumbersNormalized)
    ? contact.phoneNumbersNormalized.filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized[0];
  const fallback = normalizePhoneList(contact?.phoneNumbers || []);
  return fallback.length > 0 ? fallback[0] : null;
}

/**
 * Resolve a reminder whose recipient is an unresolved "@handle" into a
 * concrete imessage phone (Tab 31). Returns:
 *   { ok: true, recipient }            — rewritten recipient, ready to deliver
 *   { ok: false, terminal, reason }    — unknown handle / no phone / blip
 * Never throws.
 */
async function resolveHandleRecipient(reminder, { resolveHandle }) {
  const tenantDid = reminder?.tenant_did;
  const handle = reminder?.recipient?.address;
  if (!tenantDid || !handle) {
    return {
      ok: false,
      terminal: true,
      reason: "handle_resolution_missing_inputs",
    };
  }

  let contact;
  try {
    contact = await resolveHandle(tenantDid, handle);
  } catch (err) {
    // Treat a resolver error (e.g. Firestore blip) as transient so the row
    // retries on the next tick rather than dying on a one-off outage.
    return {
      ok: false,
      terminal: false,
      reason: `handle_resolution_error:${(err?.message || "unknown").slice(0, 160)}`,
    };
  }

  if (!contact) {
    return {
      ok: false,
      terminal: true,
      reason: `failed_unknown_handle:${handle}`,
    };
  }

  const phone = pickContactPhone(contact);
  if (!phone) {
    return {
      ok: false,
      terminal: true,
      reason: `unresolvable_handle_no_phone:${handle}`,
    };
  }

  return {
    ok: true,
    recipient: {
      transport: "imessage",
      address: phone,
      kind: "contact_phone",
      needs_resolution: false,
      resolved_from_handle: handle,
      resolved_contact_id: contact.id ?? null,
    },
  };
}

/**
 * Build the short fyi sent to the requester after a successful cross-person
 * delivery. Names the recipient by the friendliest label available.
 */
function buildCcText(reminder) {
  const r = reminder?.recipient || {};
  const label =
    reminder?.recipient_input || r.resolved_from_handle || r.address || "them";
  return `Done — I just reminded ${label}: "${reminder.message}"`;
}

/**
 * Run one worker tick. Pulls due reminders and attempts delivery for each.
 * Returns a summary the caller can log; never throws.
 */
export async function tickReminderWorker(deps = {}) {
  const config = deps.config || getConfig();
  const log = deps.log || console;
  const fetchImpl = deps.fetch || globalThis.fetch;
  const dbListDue = deps.listDueReminders || listDueReminders;
  const dbMarkFired = deps.markReminderFired || markReminderFired;
  const dbMarkFailed =
    deps.markReminderAttemptFailed || markReminderAttemptFailed;
  const dbMarkResolved = deps.markReminderResolved || markReminderResolved;
  const resolveHandle =
    deps.resolveHandle ||
    (async (tenantDid, handle) => {
      const amberId = await resolveAmberIdByPrivyDid(tenantDid).catch(
        () => null,
      );
      if (!amberId) return null;
      return findContactByHandle(amberId, handle);
    });

  let due = [];
  try {
    due = await dbListDue(deps.now || new Date(), 25);
  } catch (err) {
    log.warn?.(`[reminder-worker] listDueReminders failed: ${err.message}`);
    return { ok: false, fetched: 0, fired: 0, failed: 0 };
  }
  if (due.length === 0) return { ok: true, fetched: 0, fired: 0, failed: 0 };

  let fired = 0;
  let failed = 0;
  for (const reminder of due) {
    // Work against a local copy so an in-flight recipient rewrite (handle
    // resolution) doesn't mutate the row the next iteration reads.
    let active = reminder;

    // Tab 31: resolve an unresolved "@handle" into a concrete contact phone
    // before delivery. Unknown handles fail terminally; a transient resolver
    // error retries. On success the rewrite is persisted so a later retry
    // skips resolution and delivers straight to the phone.
    if (
      active.recipient?.kind === "handle" &&
      active.recipient?.needs_resolution
    ) {
      const resolution = await resolveHandleRecipient(active, {
        resolveHandle,
      });
      if (!resolution.ok) {
        failed += 1;
        try {
          await dbMarkFailed(active.reminder_id, {
            reason: resolution.reason,
            maxAttempts: resolution.terminal ? 1 : MAX_ATTEMPTS,
          });
        } catch (err) {
          log.warn?.(
            `[reminder-worker] mark-failed (handle) failed for ${active.reminder_id}: ${err.message}`,
          );
        }
        log.warn?.(
          `[reminder-worker] handle resolution failed ${active.reminder_id}: ${resolution.reason}`,
        );
        continue;
      }
      active = { ...active, recipient: resolution.recipient };
      try {
        await dbMarkResolved(active.reminder_id, resolution.recipient);
      } catch (err) {
        // Non-fatal: delivery still proceeds with the in-memory rewrite. The
        // only cost of a failed persist is re-resolving on a future retry.
        log.warn?.(
          `[reminder-worker] mark-resolved failed for ${active.reminder_id}: ${err.message}`,
        );
      }
      log.info?.(
        `[reminder-worker] resolved handle ${resolution.recipient.resolved_from_handle} -> ${resolution.recipient.address} for ${active.reminder_id}`,
      );
    }

    const result = await deliverReminder(active, {
      ...config,
      fetchImpl,
    });
    if (result.ok) {
      try {
        await dbMarkFired(active.reminder_id);
        fired += 1;
        log.info?.(
          `[reminder-worker] fired ${active.reminder_id} to ${active.recipient?.address} via ${active.recipient?.transport}`,
        );
      } catch (err) {
        log.warn?.(
          `[reminder-worker] mark-fired failed for ${active.reminder_id}: ${err.message}`,
        );
      }
      // Tab 31: cc the requester after a successful non-self delivery. Best-
      // effort — a failed fyi never un-fires the reminder. Skip when the
      // requester would be texting themselves (self reminder, or requester
      // phone equals the delivered recipient).
      await maybeCcRequester(active, {
        ...config,
        fetchImpl,
        log,
      });
      continue;
    }
    failed += 1;
    try {
      await dbMarkFailed(active.reminder_id, {
        reason: result.reason,
        maxAttempts: result.terminal ? 1 : MAX_ATTEMPTS,
      });
    } catch (err) {
      log.warn?.(
        `[reminder-worker] mark-failed failed for ${active.reminder_id}: ${err.message}`,
      );
    }
    log.warn?.(
      `[reminder-worker] delivery failed ${active.reminder_id}: ${result.reason}`,
    );
  }
  return { ok: true, fetched: due.length, fired, failed };
}

/**
 * Tab 31: after a successful cross-person delivery, send the requester a
 * short fyi. Best-effort — logs and swallows any failure so a flaky cc never
 * un-fires the reminder. No-ops for self reminders, rows without
 * cc_requester / requester_phone, or when the requester is the recipient.
 */
async function maybeCcRequester(
  reminder,
  { platformUrl, adminToken, fetchImpl, log },
) {
  if (!reminder?.cc_requester) return;
  const requesterPhone = reminder.requester_phone;
  if (!requesterPhone) return;
  if (reminder.recipient?.kind === "self") return;
  if (requesterPhone === reminder.recipient?.address) return;

  const ccResult = await sendViaPlatform(
    { to: requesterPhone, text: buildCcText(reminder) },
    { platformUrl, adminToken, fetchImpl },
  );
  if (ccResult.ok) {
    log?.info?.(
      `[reminder-worker] cc'd requester ${requesterPhone} for ${reminder.reminder_id}`,
    );
  } else {
    log?.warn?.(
      `[reminder-worker] cc to requester failed for ${reminder.reminder_id}: ${ccResult.reason}`,
    );
  }
}

let timer = null;
let running = false;

/**
 * Start the recurring worker. Idempotent — calling start() twice is a no-op.
 * Gated by ENABLE_REMINDER_WORKER === "1" so dev / test boots don't tick.
 */
export function startReminderWorker(deps = {}) {
  if (timer) return false;
  if (process.env.ENABLE_REMINDER_WORKER !== "1") return false;
  const config = deps.config || getConfig();
  const log = deps.log || console;
  log.info?.(
    `[reminder-worker] starting (tick=${config.tickMs}ms platform=${
      config.platformUrl ? "set" : "unset"
    })`,
  );

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await tickReminderWorker({ ...deps, config });
    } finally {
      running = false;
    }
  };
  // Don't fire immediately on boot — let the rest of the app finish starting.
  timer = setInterval(tick, config.tickMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  return true;
}

export function stopReminderWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
}
