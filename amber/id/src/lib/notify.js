/**
 * The one place a remote push gets sent.
 *
 * WHY IT EXISTS. `sendExpoPush` has been in this repo the whole time, and exactly
 * two things called it: a one-to-one contact share, and an internal questions
 * endpoint that nothing anywhere invokes. So "notifications aren't working" was not
 * a broken sender — it was a sender with almost nothing wired to it. Every social
 * event that should reach a phone (added to a circle, a note shared with you, a
 * connection request) emitted nothing at all.
 *
 * Everything funnels through here so that three things are true in one place rather
 * than copied into every route: dead tokens get pruned, failures get logged as
 * failures, and a push can never break the request that triggered it.
 */

import { sendExpoPush } from "./expo-push.js";
import { blockedIdsFor } from "../db/blocks-store.js";
import { getPushTokensForOwner, deletePushTokens } from "../db/push-tokens.js";
import {
  getNotificationPrefs,
  categoryForPushType,
} from "../routes/notification-settings.js";

/**
 * Push to one or more Amber accounts.
 *
 *   notifyAmberUsers({ ownerIds, title, body, data, log })
 *
 * `data.type` is what the app's notification handler routes on when the user taps,
 * so it must be one of the types app/_layout.tsx knows about — a push that opens
 * nothing is worse than no push, because the user learns to ignore them.
 *
 * Never throws. Returns { sent, failed, recipients, optedOut }.
 */
export async function notifyAmberUsers({
  ownerIds,
  title,
  body,
  data = {},
  log,
  /**
   * WHO IT IS FROM, when a person is behind it — the account whose action
   * caused this push. Optional, and only two things read it: the recipient's
   * mute list and the block list. A push with no person behind it (a reminder
   * coming due) leaves it null: unmutable and unblockable by person, which is
   * correct, because there is nobody to mute or block.
   */
  fromAmberId = null,
  // Injectable for tests; defaults to the real per-user settings.
  getPrefs = getNotificationPrefs,
  /**
   * Injectable for the same reason getPrefs is, and it MUST be injected by any
   * test that expects a push to go out.
   *
   * The real one reads the database, and the fail-closed contract says an
   * unreadable block list sends nothing -- so in a test process with no
   * database, every notification is correctly suppressed. That is the safe
   * behavior in production and a confusing one in a test, which is exactly what
   * happened: adding the check turned an existing mute test red because zero
   * pushes went out rather than one.
   */
  getBlockedIds = blockedIdsFor,
} = {}) {
  const out = { sent: 0, failed: 0, recipients: 0, optedOut: 0 };
  try {
    const ids = Array.from(
      new Set((Array.isArray(ownerIds) ? ownerIds : [ownerIds]).filter(Boolean).map(String)),
    );
    if (ids.length === 0 || !title) return out;

    // THE SWITCH IN SETTINGS HAS TO MEAN SOMETHING. The Apple channel toggle only
    // ever gated locally-scheduled reminders, so a user who turned notifications
    // off still received every circle invite, note share and connection request.
    // A setting that does not do what it says is worse than no setting.
    //
    // THREE QUESTIONS NOW, ASKED IN ORDER OF HOW BLUNT THEY ARE: is push on at
    // all, is this KIND of push on, and is the PERSON behind it muted. Each one
    // is a decision the owner made explicitly, and each one is only ever
    // consulted for the owner who made it.
    //
    // Unreadable settings default to SENDING at every step, matching the stored
    // defaults — a settings lookup failing must not silently mute someone.
    const category = categoryForPushType(data?.type);
    const from = fromAmberId ? String(fromAmberId).toLowerCase() : null;

    /**
     * A FOURTH QUESTION, AND IT IS NOT A PREFERENCE.
     *
     * The three above are settings the owner chose and can change. A block is
     * different in kind: it is not "I would rather not hear about this", it is
     * "this person does not get to reach me", and it was being consulted in
     * exactly three places, all of them in routes/dms.js. So blocking somebody
     * stopped their direct messages while still letting a circle add, a shared
     * note or a connection request put their name on the lock screen.
     *
     * Done here rather than at each caller because this is the one funnel every
     * social push already goes through -- ten call sites, one check, and a new
     * eleventh is covered the day it is written.
     *
     * ONE QUERY, NOT ONE PER RECIPIENT. This runs on every share and every
     * circle add; a round trip per person would be a real cost on a fan-out.
     *
     * A NULL LIST MEANS UNKNOWN, AND UNKNOWN SENDS NOTHING. Failing open here
     * would deliver a push from somebody the recipient shut out, which is the
     * exact harm, and it would do it invisibly. Failing closed costs a
     * notification that the app will show in-line anyway.
     */
    let blocked = new Set();
    if (from) {
      const list = await getBlockedIds(from);
      if (list === null) {
        log?.error?.("[notify] block list unreadable; sending nothing rather than reaching a blocked recipient");
        out.optedOut += ids.length;
        return out;
      }
      blocked = list;
    }

    const allowed = [];
    for (const id of ids) {
      // BEFORE THE PREFERENCES, because an unreadable settings row defaults to
      // SENDING -- correct for a preference, catastrophic for a block. Asking in
      // the other order would deliver to a blocked recipient every time their
      // settings failed to load.
      if (blocked.has(String(id).toLowerCase())) {
        out.optedOut += 1;
        continue;
      }
      const prefs = await getPrefs(id).catch(() => null);
      if (!prefs) {
        allowed.push(id);
        continue;
      }
      if (prefs.channels?.apple === false) {
        out.optedOut += 1;
        continue;
      }
      // An UNKNOWN type is never muted by category. A new push type that
      // nobody has taught this table about must still arrive; the alternative
      // is a feature that ships silent.
      if (category && prefs.categories && prefs.categories[category] === false) {
        out.optedOut += 1;
        continue;
      }
      if (from && Array.isArray(prefs.muted) && prefs.muted.includes(from)) {
        out.optedOut += 1;
        continue;
      }
      allowed.push(id);
    }
    if (allowed.length === 0) {
      log?.info?.(
        { optedOut: out.optedOut, category, from },
        "[notify] every recipient has this turned off, or has muted the sender",
      );
      return out;
    }

    const tokenLists = await Promise.all(
      allowed.map((id) => getPushTokensForOwner(id).catch(() => [])),
    );
    const tokens = Array.from(new Set(tokenLists.flat()));
    out.recipients = allowed.length;
    if (tokens.length === 0) {
      // Worth a line: "nobody has a registered device" and "the send failed" are
      // completely different problems and used to look identical from the outside.
      log?.info?.(
        { recipients: allowed.length, optedOut: out.optedOut },
        "[notify] no registered devices for these recipients",
      );
      return out;
    }

    const res = await sendExpoPush(
      tokens.map((to) => ({ to, title, body, data, sound: "default" })),
    );
    out.sent = res?.sent ?? 0;
    out.failed = res?.failed ?? 0;

    // Expo told us these installations are gone. Deleting them is the difference
    // between a table that stays accurate and one that accumulates dead weight and
    // logs the same error forever.
    if (res?.unregistered?.length) {
      await deletePushTokens(res.unregistered).catch(() => {});
    }
    if (out.failed > 0) {
      log?.error?.({ ...out, title }, "[notify] some pushes failed");
    }
    return out;
  } catch (err) {
    log?.warn?.({ err: err?.message }, "[notify] send failed");
    return out;
  }
}
