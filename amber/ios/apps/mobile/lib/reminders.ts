import * as Notifications from 'expo-notifications';
import { callMedhaId } from './medhaId';
import { queryClient } from './queryClient';
import { appleChannelEnabled, imessageChannelEnabled } from './notificationSettings';

// Reminders from a transcript — the APP handles Apple LOCAL notifications only.
//
// After a voice note is transcribed (or a chat message is typed), we ask
// medha-id to parse ZERO OR MORE reminders out of the text
// (POST /v1/reminders/parse). The server ALSO persists those reminders and, when
// the user's iMessage channel is on, texts them at fire time — that path is
// entirely server-side and the app plays no part in it. The app's only job is to
// schedule an iOS LOCAL notification for each future reminder, and ONLY when the
// user's Apple channel is enabled (see appleChannelEnabled). This whole module is
// a best-effort SIDE-EFFECT on the text — every path is defensive and never
// throws into the caller's capture/chat flow.

// The parsed reminder shape returned by the backend.
//
// The last three fields are what make a reminder something you can OPEN rather
// than only receive. `reminderId` is the server row, so the notification can
// carry it and a tap can land on the reminder itself; `contact` is who it is
// about when the transcript named somebody in the address book; `corrected` is
// the server telling us this sentence MOVED a reminder that already exists,
// which is the difference between "set" and "moved" in the toast and between
// one notification and two on the lock screen.
export type ParsedReminder = {
  fireAtISO: string;
  title: string;
  body: string;
  eventAtISO?: string | null;
  reminderId?: string | null;
  contact?: { id: string; name: string | null } | null;
  corrected?: boolean;
};

// A reminder that is going to arrive, handed back so the caller can confirm it.
//
// `via` matters because there are two delivery paths and only one of them is this
// app's. 'apple' means we scheduled a local notification, so notificationId is
// real. 'imessage' means we scheduled nothing — the server persisted the reminder
// and jobs/reminder-scheduler.js will text it — and notificationId is null. 'none'
// means it parsed and NOTHING will deliver it, because both channels are off.
export type ScheduledReminder = {
  title: string;
  body: string;
  fireAtISO: string;
  fireAt: Date;
  notificationId: string | null;
  via: 'apple' | 'imessage' | 'none';
  /** The server row, so a tap on the banner can open the reminder. */
  reminderId: string | null;
  contact: { id: string; name: string | null } | null;
  /** True when this replaced a reminder the user had just set. */
  corrected: boolean;
};

/**
 * WHY THIS IS NOT JUST AN ARRAY ANY MORE.
 *
 * It used to be, and "catches everything and returns [] on any error" made two
 * completely different outcomes identical at the call site:
 *
 *   []  the sentence had no reminder in it        -> silence is correct
 *   []  the server refused to save the reminder   -> silence is a lie
 *
 * On the morning migrations 049 and 050 were found unapplied, every single
 * INSERT INTO reminders threw on a column that did not exist. This function
 * returned [], every caller did `.catch(() => {})`, no toast fired, and chat --
 * which is never told whether a write landed -- printed a tidy confirmation of
 * a reminder that was never created. Three layers of silence stacked into a
 * confident lie, and the only way to notice was to read Railway logs.
 *
 * So a failure is now a value, and the caller has to look at it.
 */
export type ScheduleOutcome = {
  scheduled: ScheduledReminder[];
  /** null means nothing needed scheduling. Non-null means the write failed. */
  failure: { code: string; message: string } | null;
};

const NO_REMINDERS: ScheduleOutcome = { scheduled: [], failure: null };
const ok = (scheduled: ScheduledReminder[]): ScheduleOutcome => ({ scheduled, failure: null });

/**
 * What the user is told when a reminder did not save.
 *
 * Names the failure rather than the mechanism. "Column does not exist" is true
 * and useless; what they need to know is that the thing they just asked for did
 * not happen, so they can ask again or write it down.
 */
export function scheduleFailureText(failure: { code: string; message: string }): string {
  return failure.message || 'Amber could not save it. Try again in a moment.';
}

// Set the foreground presentation handler exactly once. Without this, iOS
// suppresses a notification whose app is foregrounded; we want it to show as a
// banner (+ list + sound) even while Amber is open.
let handlerSet = false;
function ensureHandler(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ensure we have iOS notification permission, prompting only when we don't
 * already have a decision. Returns true if we can post notifications. Never
 * throws — any failure resolves to false so the caller degrades silently.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    ensureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    // Only prompt if iOS hasn't already made a permanent decision — matches the
    // "prompt when first needed" guidance and avoids re-nagging a user who said no.
    if (current.canAskAgain === false) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted === true;
  } catch {
    return false;
  }
}

/**
 * Parse reminders out of a transcript and schedule an on-device notification for
 * each future one. Returns the reminders that were actually scheduled (possibly
 * empty). Fire-and-forget safe: catches everything and returns [] on any error.
 */
export async function parseAndScheduleReminders(transcript: string): Promise<ScheduleOutcome> {
  try {
    const text = (transcript ?? '').trim();
    if (!text) return NO_REMINDERS;

    const res = await callMedhaId<{ reminders: ParsedReminder[] }>({
      path: '/v1/reminders/parse',
      method: 'POST',
      body: {
        text,
        nowISO: new Date().toISOString(),
        // Offset FROM UTC in minutes (getTimezoneOffset is the inverse sign).
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      },
      requireAuth: true,
      // A retried POST is safe here (stateless parse), but keep it single-shot to
      // avoid duplicate scheduling if a slow response is retried mid-flight.
      retries: 0,
    });

    // THE BRANCH THAT WAS THE BUG. `res.ok && ...` collapsed a refused write
    // into the same empty array as a sentence with no reminder in it.
    if (!res.ok) {
      return {
        scheduled: [],
        failure: {
          code: String((res as { error?: unknown }).error ?? 'parse_failed'),
          message: 'Amber could not save that reminder. Nothing was scheduled.',
        },
      };
    }
    const reminders = Array.isArray(res.data?.reminders) ? res.data.reminders : [];
    if (reminders.length === 0) return NO_REMINDERS;

    // THE LIST ON TODAY IS NOW WRONG, whichever way this went. The server has
    // either stored a new reminder or moved an existing one, and Home's
    // reminders query has a 60s staleTime -- so without this, saying "remind me
    // to call Sagar at 7:30" left Today showing nothing for a minute, and
    // correcting the time left the OLD time on the card. Fire-and-forget: the
    // refetch is not what this function promises.
    queryClient.invalidateQueries({ queryKey: ['reminders', 'self'] });

    // Gate on the user's Apple channel. The parse call above already ran, so the
    // server has persisted these reminders and will deliver them over iMessage if
    // that channel is on — the app never touches iMessage. Local notifications
    // are the app's responsibility, and only when Apple is enabled.
    const appleOn = await appleChannelEnabled();

    // ACKNOWLEDGE IT EVEN WHEN WE ARE NOT THE ONE DELIVERING IT.
    //
    // This used to `return []` when Apple was off, which made the caller's
    // confirmation toast null — so a user with Apple off and iMessage on said
    // "remind me to call Sagar at 5", got complete silence, and then a text
    // arrived hours later. Silence after an instruction reads as the instruction
    // being ignored. The reminder IS set; it is just Messages that will deliver
    // it, so say that.
    if (!appleOn) {
      const imessageOn = await imessageChannelEnabled();
      return ok(validFuture(reminders).map((r) => ({
        title: r.title,
        body: r.body,
        fireAtISO: r.fireAtISO,
        fireAt: new Date(r.fireAtISO),
        notificationId: null,
        via: imessageOn ? ('imessage' as const) : ('none' as const),
        reminderId: r.reminderId ?? null,
        contact: r.contact ?? null,
        corrected: r.corrected === true,
      })));
    }

    // Only ask for permission once we actually have something to schedule.
    // NOT A FAILURE: the server row exists, iOS just will not show a banner.
    // Telling somebody their reminder failed when it did not is its own lie.
    const granted = await ensureNotificationPermission();
    if (!granted) return NO_REMINDERS;

    const now = Date.now();
    const scheduled: ScheduledReminder[] = [];
    for (const r of reminders) {
      const fireAt = new Date(r?.fireAtISO ?? '');
      // Guard: skip anything unparseable or already in the past.
      if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= now) continue;
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Reminder';
      const body = typeof r.body === 'string' && r.body.trim() ? r.body.trim() : title;
      const reminderId = typeof r.reminderId === 'string' ? r.reminderId : null;
      const contact = r.contact?.id ? r.contact : null;
      try {
        // A CORRECTION REPLACES ITS NOTIFICATION.
        //
        // "Remind me to call Sagar at 7:30" then "no, 7:30 AM" moves ONE server
        // row, so scheduling the new time without canceling the old one leaves
        // two banners twelve hours apart — and the wrong one arrives first.
        // Keyed on the reminder id carried in the payload, so this needs no
        // local bookkeeping and survives the app being killed in between.
        if (reminderId) await cancelScheduledFor(reminderId);

        const notificationId = await Notifications.scheduleNotificationAsync({
          // data.type is what the tap handler routes on. Without it,
          // destinationForNotification returns null and tapping a reminder opened
          // the app onto whatever screen happened to be last — which reads as the
          // notification doing nothing at all.
          //
          // AND THE IDS, which is the rest of that same bug: type alone routed
          // every reminder to "Today" and no further, so tapping "call Sagar at
          // 7:30" opened the app onto a day view and left the user to go find
          // both the reminder and the person. reminderId opens the reminder;
          // contactId opens their card. See destinationForNotification.
          content: {
            title,
            body,
            data: {
              type: 'reminder',
              ...(reminderId ? { reminderId } : {}),
              ...(contact ? { contactId: contact.id } : {}),
              ...(contact?.name ? { contactName: contact.name } : {}),
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: fireAt,
          },
        });
        scheduled.push({
          title,
          body,
          fireAtISO: r.fireAtISO,
          fireAt,
          notificationId,
          via: 'apple',
          reminderId,
          contact,
          corrected: r.corrected === true,
        });
      } catch {
        // One failed schedule must not drop the rest.
      }
    }
    return ok(scheduled);
  } catch {
    return {
      scheduled: [],
      failure: {
        code: 'unreachable',
        message: 'Amber could not reach the server, so nothing was scheduled.',
      },
    };
  }
}

/**
 * Cancel whatever is already scheduled for one server reminder.
 *
 * The scheduled list is the only durable record of what this device has queued
 * — the notification ids themselves are not stored anywhere — so the reminder
 * id in the payload is what identifies it. Cheap: this list is a handful of
 * entries, and iOS caps it at 64.
 *
 * Never throws. Failing to cancel a stale banner is worth less than failing to
 * set the corrected one.
 */
async function cancelScheduledFor(reminderId: string): Promise<number> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    let cancelled = 0;
    for (const n of all) {
      const data = n.content?.data as Record<string, unknown> | undefined;
      if (data?.type !== 'reminder' || data?.reminderId !== reminderId) continue;
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
      cancelled += 1;
    }
    return cancelled;
  } catch {
    return 0;
  }
}

// The reminders in a parse response that are usable: a real future time. Shared by
// both delivery paths so "what counts as a reminder" is decided in one place.
function validFuture(reminders: ParsedReminder[]): ParsedReminder[] {
  const now = Date.now();
  return reminders.filter((r) => {
    const t = new Date(r?.fireAtISO ?? '').getTime();
    return !Number.isNaN(t) && t > now;
  });
}

/**
 * Short toast copy for a batch of reminders that are going to arrive, e.g.
 * "Reminder set for 6:00 PM". Returns null for an empty batch so the caller can
 * skip the toast entirely.
 *
 * The wording names the channel when it is not the lock screen, because "reminder
 * set" next to a silent lock screen is indistinguishable from a bug, and because a
 * reminder nothing will deliver has to say so rather than claiming it is set.
 */
export function reminderConfirmationText(scheduled: ScheduledReminder[]): string | null {
  if (!scheduled || scheduled.length === 0) return null;
  const via = scheduled[0].via;
  // "MOVED", NOT "SET". He corrected 7:30 pm to 7:30 am, Amber replied as if it
  // had understood, and a toast reading "Reminder set for 7:30 AM" is
  // indistinguishable from a second reminder having been added. Saying it moved
  // is the confirmation that the first one is gone.
  if (scheduled.length === 1 && scheduled[0].corrected && via !== 'none') {
    const when = scheduled[0].fireAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day =
      scheduled[0].fireAt.toDateString() === new Date().toDateString()
        ? ''
        : ` ${scheduled[0].fireAt.toLocaleDateString('en-US', { weekday: 'short' })}`;
    return `Reminder moved to${day} ${when}`;
  }
  if (via === 'none') {
    return scheduled.length === 1
      ? 'Reminder saved, but notifications are off'
      : `${scheduled.length} reminders saved, but notifications are off`;
  }
  const suffix = via === 'imessage' ? " — I'll text you" : '';
  if (scheduled.length === 1) {
    const when = scheduled[0].fireAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `Reminder set for ${when}${suffix}`;
  }
  return `${scheduled.length} reminders set${suffix}`;
}

// ── The list the app shows ───────────────────────────────────────────────
//
// Everything above is the CAPTURE side: text goes in, an iOS local notification
// comes out. It is a side effect on a transcript and it deliberately returns
// nothing durable. This is the other half — the reminders that exist on the
// server, which is what Home renders, what a tick-off writes to, and what
// survives a reinstall.
//
// Three routes, all owner-scoped server-side from the caller's own session:
//   GET   /v1/me/reminders/self
//   POST  /v1/me/reminders/self
//   PATCH /v1/me/reminders/self/:id

/** One stored reminder, in the narrow shape the server hands the client. */
export type Reminder = {
  reminderId: string;
  title: string;
  body: string | null;
  /** ISO instant. Never null in practice — the server refuses a timeless reminder. */
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string | null;
  /**
   * Who it is about, when Amber knew. null for most reminders, because most
   * reminders are about nobody in your contact graph — and a guessed contact
   * would put a note in a real person's file that they have nothing to do with.
   */
  contact: { id: string; name: string | null } | null;
};

/**
 * The caller's own reminders: pending soonest-first, then whatever they have
 * ticked off in the last day (so an undo has something to undo). Returns [] on
 * any failure rather than throwing — an empty reminder list renders correctly,
 * and Home's whole personal section must not go down with this one call.
 */
export async function listReminders(): Promise<Reminder[]> {
  const res = await callMedhaId<{ reminders: Reminder[] }>({
    path: '/v1/me/reminders/self',
    method: 'GET',
    requireAuth: true,
  });
  return res.ok && Array.isArray(res.data?.reminders) ? res.data.reminders : [];
}

/** Tick one off, or put it back. Returns whether the server accepted it. */
export async function setReminderDone(reminderId: string, done: boolean): Promise<boolean> {
  const res = await callMedhaId<{ reminder: Reminder }>({
    path: `/v1/me/reminders/self/${encodeURIComponent(reminderId)}`,
    method: 'PATCH',
    body: { done },
    requireAuth: true,
    retries: 0,
  });
  return res.ok;
}

/**
 * Add a reminder by hand. `dueAt` must be a real instant: the server refuses a
 * reminder with no time, because a reminder with no time is a note and this app
 * already has a very good place to put notes.
 */
export async function createReminder(input: {
  title: string;
  dueAt: Date;
  body?: string;
  contactId?: string;
  contactName?: string;
}): Promise<Reminder | null> {
  const res = await callMedhaId<{ reminder: Reminder }>({
    path: '/v1/me/reminders/self',
    method: 'POST',
    body: {
      title: input.title.slice(0, 120),
      dueAt: input.dueAt.toISOString(),
      ...(input.body ? { body: input.body.slice(0, 4000) } : {}),
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.contactName ? { contactName: input.contactName } : {}),
    },
    requireAuth: true,
    retries: 0,
  });
  return res.ok ? (res.data?.reminder ?? null) : null;
}
