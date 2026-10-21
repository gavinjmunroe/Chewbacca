/**
 * Self-reminder delivery scheduler.
 *
 * Delivers the iMessage channel of reminders a user set FOR THEMSELVES (voice
 * or typed → /v1/reminders/parse). The Apple/lock-screen channel is scheduled
 * ON-DEVICE by the app and is NOT this job's concern; only rows whose
 * recipient.transport is imessage are ever seen here.
 *
 * A server row now exists for EVERY self-reminder, not only the iMessage ones —
 * the app lists them, ticks them off and rebuilds them after a reinstall, and
 * that could not work when the row's existence depended on a notification
 * preference. What the channel decides is the TRANSPORT: an Apple-only reminder
 * is stored with recipient.transport = "apple", which this scan does not match,
 * so it is stored and never texted. Nothing about what this job delivers
 * changed; only the set of rows it declines to look at grew.
 *
 * Each tick (~60s, gated by ENABLE_REMINDER_SCHEDULER, default ON):
 *   1. listDueSelfReminders — pending, due_at <= now, origin=self_reminder,
 *      transport=imessage, ACROSS owners (returns each row's owner_id).
 *   2. For each, resolve THAT owner's OWN iMessage destination FRESH from
 *      owner_id (getUserPhoneByAmberId). We never trust a stored address to
 *      send to another number — the destination is always derived from the
 *      row's own owner, so one tenant's reminder can never reach another.
 *   3. Send the reminder text to the owner's own number over Photon
 *      (lib/photon-sender.js sendIMessage), which is the ONLY iMessage transport
 *      in this service. No dependency on medha-platform.
 *   4. On success DELETE the row (owner wants delete-on-complete) and log
 *      `REMINDER_SENT owner=<amberId> via=imessage`.
 *   5. On failure record the attempt (no delete, no spam); after
 *      SELF_REMINDER_MAX_ATTEMPTS the row is deleted so we never loop forever.
 *
 * This job is INTENTIONALLY SEPARATE from jobs/reminder-worker.js (the
 * teammate's cross-person/Tab-31 delivery worker). It shares the reminders
 * table but scans a DISJOINT slice (origin=self_reminder) and uses its own
 * helpers, so the two do not collide. See residual-risk note in the PR: run
 * only one of ENABLE_REMINDER_SCHEDULER / ENABLE_REMINDER_WORKER against
 * overlapping rows.
 *
 * The worker never throws; one bad row never blocks the others.
 */

import {
  listDueSelfReminders,
  deleteReminderById,
  recordSelfReminderFailure,
  SELF_REMINDER_MAX_ATTEMPTS,
} from "../db/self-reminders.js";
import { getUserPhoneByAmberId } from "../db/store.js";
import { sendIMessage } from "../lib/photon-sender.js";

const DEFAULT_TICK_MS = 60_000;
const BATCH = 25;

// Default ON: only "0" disables. Any other value (unset included) enables.
function isEnabled() {
  return process.env.ENABLE_REMINDER_SCHEDULER !== "0";
}

/**
 * Run one scheduler tick. Injectable deps for tests. Never throws; returns a
 * summary the caller can log.
 */
export async function tickReminderScheduler(deps = {}) {
  const log = deps.log || console;
  const listDue = deps.listDueSelfReminders || listDueSelfReminders;
  const del = deps.deleteReminderById || deleteReminderById;
  const recordFail = deps.recordSelfReminderFailure || recordSelfReminderFailure;
  const resolveOwnerPhone =
    deps.getUserPhoneByAmberId || getUserPhoneByAmberId;
  // Photon is the only iMessage transport in this service. The scheduler passes
  // { to, text }; sendIMessage takes { toPhone, text } and returns the same
  // { ok, reason, detail } shape the loop below already branches on.
  const send =
    deps.send || (({ to, text }) => sendIMessage({ toPhone: to, text }));
  const now = deps.now || new Date();

  let due = [];
  try {
    due = await listDue(now, BATCH);
  } catch (err) {
    log.warn?.(`[reminder-scheduler] listDueSelfReminders failed: ${err.message}`);
    return { ok: false, fetched: 0, sent: 0, failed: 0 };
  }
  if (due.length === 0) return { ok: true, fetched: 0, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const { ownerId, reminder } of due) {
    const reminderId = reminder?.reminder_id;
    if (!reminderId) {
      failed += 1;
      continue;
    }

    // ── Resolve the OWNER'S OWN destination, strictly from the row's owner ──
    // Fresh resolution from owner_id is the isolation guarantee: the number we
    // text is derived from the reminder's owner, not from anything that could
    // point at another tenant. We only fall back to the stored address when it
    // is a self recipient AND we couldn't resolve the owner's phone.
    let to = null;
    if (ownerId) to = await resolveOwnerPhone(ownerId).catch(() => null);
    if (!to && reminder?.recipient?.kind === "self") {
      to = reminder.recipient.address || null;
    }

    if (!to) {
      // Can't establish the owner's own number → do NOT guess / cross tenants.
      const r = await recordFail(reminderId, {
        reason: "no_owner_destination",
        maxAttempts: SELF_REMINDER_MAX_ATTEMPTS,
      }).catch(() => ({ deleted: false }));
      failed += 1;
      log.warn?.(
        `REMINDER_SEND_SKIP owner=${ownerId ?? "unknown"} reminder=${reminderId} reason=no_owner_destination deleted=${r?.deleted === true}`,
      );
      continue;
    }

    const text = String(reminder.message || reminder.title || "Reminder");
    let result;
    try {
      result = await send({ to, text });
    } catch (err) {
      result = { ok: false, reason: "send_threw", detail: err?.message };
    }

    if (result?.ok) {
      await del(reminderId).catch((err) =>
        log.warn?.(
          `[reminder-scheduler] delete-on-success failed for ${reminderId}: ${err.message}`,
        ),
      );
      sent += 1;
      log.info?.(
        `REMINDER_SENT owner=${ownerId ?? "unknown"} via=imessage reminder=${reminderId}`,
      );
      continue;
    }

    const reason = result?.reason || result?.detail || "send_failed";
    const r = await recordFail(reminderId, {
      reason,
      maxAttempts: SELF_REMINDER_MAX_ATTEMPTS,
    }).catch(() => ({ deleted: false }));
    failed += 1;
    log.warn?.(
      `REMINDER_SEND_FAILED owner=${ownerId ?? "unknown"} reminder=${reminderId} reason=${reason} attempts=${r?.attempts ?? "?"} deleted=${r?.deleted === true}`,
    );
  }

  return { ok: true, fetched: due.length, sent, failed };
}

let timer = null;
let running = false;

/**
 * Start the recurring scheduler. Idempotent — a second start() is a no-op.
 * Gated by ENABLE_REMINDER_SCHEDULER (default ON; set to "0" to disable, e.g.
 * in dev/test). Tick interval overridable via REMINDER_SCHEDULER_TICK_MS.
 */
export function startReminderScheduler(deps = {}) {
  if (timer) return false;
  const log = deps.log || console;
  if (!isEnabled()) {
    log.info?.(
      "[reminder-scheduler] disabled (ENABLE_REMINDER_SCHEDULER=0)",
    );
    return false;
  }
  const tickMs = Number(process.env.REMINDER_SCHEDULER_TICK_MS) || DEFAULT_TICK_MS;
  log.info?.(`[reminder-scheduler] starting (tick=${tickMs}ms)`);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Fresh `now` each tick — do not pin deps.now here.
      await tickReminderScheduler({ ...deps, now: undefined });
    } catch (err) {
      log.warn?.(`[reminder-scheduler] tick error: ${err.message}`);
    } finally {
      running = false;
    }
  };

  // Don't fire immediately on boot — let the rest of the app finish starting.
  timer = setInterval(tick, tickMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  return true;
}

export function stopReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
}
