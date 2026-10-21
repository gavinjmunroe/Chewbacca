/**
 * POST /v1/reminders/parse — voice-note → zero or more on-device reminders.
 *
 * v1 of "reminders from voice notes". The app records a voice note, transcribes
 * it (see /v1/voice/transcribe), then sends the transcript here. This route uses
 * Claude (Haiku-tier, the same ROUTER_MODEL pattern as chat.js) to extract ZERO
 * OR MORE reminders and resolve their RELATIVE times ("6pm", "noon tomorrow")
 * into ABSOLUTE ISO-8601 timestamps, using the caller's supplied local `nowISO`
 * and `tzOffsetMinutes`.
 *
 * The app then schedules an iOS LOCAL notification for each returned reminder —
 * NO server push infra is involved. This route is purely a stateless parser; it
 * writes nothing. It is intentionally SEPARATE from reminders.js (server-push
 * reminder CRUD, /v1/me/reminders/*) so neither can affect the other.
 *
 *   Request  : { text: string, nowISO: string, tzOffsetMinutes: number }
 *   Response : { reminders: [{ fireAtISO, title, body, eventAtISO?|null }] }
 *
 * Fail-open: any model / parse / timeout error returns { reminders: [] } (200),
 * so a bad parse never blocks the user's capture flow.
 *
 * Auth mirrors the other authed /v1 routes (voice.js): requireAuth from privy.js.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  persistSelfReminder,
  listRecentSelfReminders,
  updateSelfReminder,
} from "../db/self-reminders.js";
import { findContactByName } from "../db/user-store.js";
import { recordReminderObservation } from "../db/reminder-observations.js";
import { getNotificationChannels } from "./notification-settings.js";
import { randomUUID } from "node:crypto";
import {
  createScheduledEvent,
  createOpenReminder,
  updateScheduledEvent,
  listRecentCorrectableEvents,
  eventIdFromCorrectsId,
  DEFAULT_NOTIFY_MINUTES,
} from "../db/schedule-store.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Cheap/fast Haiku-tier model — same env knob chat.js uses for its router hop.
const REMINDER_MODEL =
  process.env.CHAT_ROUTER_MODEL || "claude-haiku-4-5-20251001";
const PARSE_TIMEOUT_MS = 12000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Build a "+HH:MM" / "-HH:MM" offset string from a signed minute count.
 * tzOffsetMinutes is `-new Date().getTimezoneOffset()` on the client, i.e. the
 * offset FROM UTC (America/Los_Angeles in summer → -420 → "-07:00").
 */
function offsetString(tzOffsetMinutes) {
  const sign = tzOffsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Render the caller's wall-clock "now" as a local ISO string with offset, plus
 * the weekday name — so the model reasons in the user's local time rather than
 * having to juggle a UTC instant + a separate offset. Returns null if nowISO is
 * unparseable.
 */
function localNowContext(nowISO, tzOffsetMinutes) {
  const nowUTC = new Date(nowISO);
  if (Number.isNaN(nowUTC.getTime())) return null;
  const offStr = offsetString(tzOffsetMinutes);
  // Shift the instant by the offset, then READ it with UTC getters — that yields
  // the user's local wall-clock components without a timezone database.
  const shifted = new Date(nowUTC.getTime() + tzOffsetMinutes * 60000);
  const localStr =
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-` +
    `${pad2(shifted.getUTCDate())}T${pad2(shifted.getUTCHours())}:` +
    `${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}${offStr}`;
  return {
    localStr,
    offStr,
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

/**
 * THE ONE RULE THAT DECIDES WHERE A SPOKEN PLAN LANDS.
 *
 *   "Anything with a stated time becomes an event on the calendar. Anything
 *    that's a reminder, like 'remind me to pick up my clothes sometime this
 *    week,' should just be a notification and a reminder that sits at the top of
 *    your notes and journals until it's checked off. It doesn't need to go in
 *    the calendar. ... If they say, 'Remind me to pick up my clothes at 3 pm
 *    today,' then that immediately becomes a scheduled event in the calendar,
 *    even though they said 'remind.'"
 *
 * A CLOCK TIME, NOT THE WORD "REMIND", IS WHAT MAKES SOMETHING AN EVENT. That is
 * the whole rule, and the old prompt could not express it because it was only
 * ever looking for reminders: everything it found got a fireAtISO and became a
 * reminder row, and everything it did not find fell through to the fact
 * extractor and became a journal card.
 *
 * WHAT THAT COST, from one afternoon of real use:
 *
 *   "I have a meeting tomorrow at 10 a.m. in Dumbo"   -> route=self_fact, journal card
 *   "Schedule a workout tomorrow 11am at Equinox"      -> a reminder row
 *   "I have to be at East Village at 3pm for coffee"   -> a reminder row
 *
 * Three explicit appointments, none of them on the calendar. The first one is
 * the clearest: the fact extractor's event route requires a NAMED PERSON -- its
 * prompt asks for "people doing something together" -- so a solo appointment
 * could never become an event no matter how precisely it was stated.
 *
 * ONE EXTRACTOR ANSWERS BOTH QUESTIONS, deliberately. Splitting "is there a
 * time" across the reminder prompt and the fact prompt would put one rule in two
 * models, which is the same mistake as one number in two files and is harder to
 * see. This pass sees the transcript once and says what each thing IS.
 */
const SCHEDULE_SYSTEM = `You extract SCHEDULED THINGS from a short voice-note transcript and resolve their times.

You are given the user's CURRENT LOCAL TIME and UTC offset, and sometimes a list of ITEMS THE USER JUST SET. Extract ZERO OR MORE items.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{"items":[{"kind":"event"|"reminder","title":"<short label>","body":"<short line>","description":"<extra detail or null>","startsAtISO":"<ISO 8601 with offset or null>","endsAtISO":"<ISO 8601 with offset or null>","allDay":true|false,"place":"<place or null>","repeat":"none"|"daily"|"weekdays"|"weekends"|"weekly"|"monthly","repeatDays":[<0=Sunday..6=Saturday>]|null,"startsOnISO":"<the first date it applies to, YYYY-MM-DD, or null>","repeatUntilISO":"<ISO date the repeat stops, or null>","personName":"<name or null>","correctsId":"<id from RECENT ITEMS or null>"}]}

THE ONE RULE THAT DECIDES "kind":
- "event" — the user stated a CLOCK TIME for it. A meeting, a workout, a coffee, a call, an appointment, a flight. It goes on their calendar. THIS IS TRUE EVEN IF THEY SAID "REMIND ME": "remind me to pick up my clothes at 3pm today" is an EVENT at 3pm today, because a time was stated.
- "reminder" — the user wants to be reminded of something and stated NO clock time: "remind me to pick up my clothes sometime this week", "remind me to drink water every day", "remind me to text mom back". These are open items, not appointments. startsAtISO is null.

A DAY IS NOT A TIME. "tomorrow", "this week", "Friday", "sometime soon" on their own do NOT make an event — that is a reminder. "Friday at 2" does.

RULES:
- "startsAtISO" is required for kind "event" and MUST be null for kind "reminder". Absolute ISO 8601 INCLUDING the user's UTC offset (e.g. "2026-08-16T18:00:00-07:00"). Resolve every relative time ("6pm", "tonight", "noon tomorrow", "in an hour", "next Friday at 9") against the given current local time. "tomorrow" = the next calendar day. "noon" = 12:00, "midnight" = 00:00. If a stated time already passed today and no day was given, use today only if it is still in the future; otherwise it is genuinely ambiguous — skip it.
- "endsAtISO": only when the user stated an end or a duration ("10 to 11", "an hour-long call"). Otherwise null.
- "place": the location as the user said it ("Dumbo", "Equinox in Dumbo", "East Village"), or null. Never invent one.
- "title" is a SHORT label with no time in it: "Meeting", "Workout at Equinox", "Coffee", "Pick up clothes".
- "body" is a short natural line the user will see.
- "description": anything the user said ABOUT the thing that is not its title, time or place -- why, what to bring, what it is for ("it's the quarterly review", "bring the deck"). null when they stated only the bare appointment. Never invent detail.
- "allDay": true only for a DATED FACT that occupies a whole day with no clock time ("I'm off on Friday", "Ana's birthday is Tuesday", "the conference is Thursday"). An all-day EVENT is the one event kind with no clock time; everything else with no clock time is a reminder.
- "all day" DESCRIBING HOW LONG THEY WILL BE AT SOMETHING IS NOT AN ALL-DAY EVENT. "remind me to find a place to work all day", "I need to write all day Saturday" is a reminder: they are saying how they will spend it, not putting a dated block on a calendar. If the user said "remind me", allDay is false.
- "repeat": "daily" every day, "weekdays" Mon-Fri, "weekends" Sat-Sun, "weekly" the named days each week, "monthly" the same date each month, "none" otherwise. Recurring things are usually reminders, but a standing meeting is a repeating event.
- "repeatDays": ONLY with repeat "weekly" — the days it falls on, 0=Sunday through 6=Saturday. "every Monday and Wednesday" is repeat "weekly" with [1,3]. null for every other repeat.
- NAMED DAYS ARE A REMINDER'S DAYS, NOT A TIME. A reminder for more than one day ("remind me Saturday and Sunday to...", "remind me tomorrow and Sunday") is ONE item with those days, never one item per day and never an event: use "weekends" for Saturday+Sunday, "weekdays" for Monday-Friday, otherwise "weekly" with repeatDays.
- "startsOnISO": the FIRST date the reminder applies to, as YYYY-MM-DD, whenever the user named a day it starts on ("remind me tomorrow", "starting Monday", "Saturday and Sunday"). Resolve it against the current local time. null only when they named no day at all ("remind me to text mom back") — that one starts today.
- "repeatUntilISO": the date a repeat STOPS. Set it when the user said one ("every day until the end of the month", "every Monday through October") AND when they named a FIXED SET of days rather than a standing habit: "just Saturday and Sunday" ends on that Sunday, and must not come back the following weekend. null for an open-ended habit ("every day", "every Monday") — that runs forever, which is what they mean.
- "personName": if the item is about a specific PERSON NAMED in the transcript ("call Sagar", "coffee with Maggie"), set it EXACTLY as said — first name only if that is all that was said. Otherwise null. NEVER invent, complete or correct a name that was not said, and never put a relationship word ("mom", "my boss") through as a name unless that is literally how the person is referred to.
- "correctsId": a CORRECTION, not a new item. If RECENT ITEMS are listed and the transcript is the user fixing one of them ("no, 7:30 AM", "make that tomorrow instead"), output ONE item that is the CORRECTED VERSION and set correctsId to that item's id EXACTLY as listed, prefix included. Set correctsId to null on every genuinely new item. A transcript asking for something new is NEVER a correction, even when it names the same person or the same hour.
- A TRANSCRIPT CAN CORRECT ITSELF in the same breath: "at 7:30 pm — no, sorry, 7:30 in the morning". The LAST time stated is the one they mean. Emit ONE item at the corrected time, never two.
- Extract MULTIPLE items if the transcript holds more than one. Two different things are two items; one thing said twice with a corrected time is one.
- NEVER invent a time. If something is clearly an appointment but you cannot determine a concrete time, emit it as a "reminder" rather than guessing a clock time.
- REFLECTION IS NOT A SCHEDULE. "I really loved that bar but it was expensive", "I cancelled my trip and Spencer is upset with me", "work has been a lot lately" are the user talking about their life. They are NOT items. Return {"items":[]} for them — something else in the app records those.
- Output ONLY the JSON object.

EXAMPLES (assume current local time 2026-08-16T14:00:00-07:00, Saturday):

Transcript: "I have a meeting tomorrow at 10 a.m. in Dumbo"
{"items":[{"kind":"event","title":"Meeting","body":"Meeting in Dumbo","description":null,"startsAtISO":"2026-08-17T10:00:00-07:00","endsAtISO":null,"allDay":false,"place":"Dumbo","repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Schedule a workout for me tomorrow at 11 a.m. at Equinox in Dumbo"
{"items":[{"kind":"event","title":"Workout at Equinox","body":"Workout at Equinox in Dumbo","description":null,"startsAtISO":"2026-08-17T11:00:00-07:00","endsAtISO":null,"allDay":false,"place":"Equinox in Dumbo","repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "I have to be at East Village at 3 pm today for coffee"
{"items":[{"kind":"event","title":"Coffee","body":"Coffee in the East Village","description":null,"startsAtISO":"2026-08-16T15:00:00-07:00","endsAtISO":null,"allDay":false,"place":"East Village","repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me to pick up my clothes at 3 pm today"
{"items":[{"kind":"event","title":"Pick up clothes","body":"Pick up clothes","description":null,"startsAtISO":"2026-08-16T15:00:00-07:00","endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me to pick up my clothes sometime this week"
{"items":[{"kind":"reminder","title":"Pick up clothes","body":"Reminder: pick up clothes","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me to drink water every day"
{"items":[{"kind":"reminder","title":"Drink water","body":"Reminder: drink water","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"daily","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me tomorrow to call the bank"
{"items":[{"kind":"reminder","title":"Call the bank","body":"Reminder: call the bank","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":"2026-08-17","repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me tomorrow as well to find a good place to do some solid thinking and working all day. I just need to do that for Saturday and Sunday. So set a reminder for tomorrow and Sunday. Just go to a park or something and get really dialed on what the offering is."
{"items":[{"kind":"reminder","title":"Find a place for deep work","body":"Reminder: find a place for deep work","description":"Go to a park or somewhere quiet and get dialed on the offering","startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"weekends","repeatDays":null,"startsOnISO":"2026-08-16","repeatUntilISO":"2026-08-17","personName":null,"correctsId":null}]}

Transcript: "Remind me every Monday and Wednesday to check in with the team"
{"items":[{"kind":"reminder","title":"Check in with the team","body":"Reminder: check in with the team","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"weekly","repeatDays":[1,3],"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me to call Sagar at 7:30 tonight"
{"items":[{"kind":"event","title":"Call Sagar","body":"Call Sagar","description":null,"startsAtISO":"2026-08-16T19:30:00-07:00","endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":"Sagar","correctsId":null}]}

Transcript: "Remind me to text mom back"
{"items":[{"kind":"reminder","title":"Text mom back","body":"Reminder: text mom back","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

RECENT ITEMS: [{"id":"rem_a1","title":"Call Sagar","fireAt":"2026-08-16T19:30:00-07:00"}]
Transcript: "no, 7:30 in the morning, not at night"
{"items":[{"kind":"event","title":"Call Sagar","body":"Call Sagar","description":null,"startsAtISO":"2026-08-17T07:30:00-07:00","endsAtISO":null,"allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":"Sagar","correctsId":"rem_a1"}]}

Transcript: "I've got the quarterly review Thursday at 2, it's an hour, bring the deck"
{"items":[{"kind":"event","title":"Quarterly review","body":"Quarterly review","description":"Bring the deck","startsAtISO":"2026-08-20T14:00:00-07:00","endsAtISO":"2026-08-20T15:00:00-07:00","allDay":false,"place":null,"repeat":"none","repeatDays":null,"startsOnISO":null,"repeatUntilISO":null,"personName":null,"correctsId":null}]}

Transcript: "Remind me to take my vitamins every morning until the end of September"
{"items":[{"kind":"reminder","title":"Take vitamins","body":"Reminder: take vitamins","description":null,"startsAtISO":null,"endsAtISO":null,"allDay":false,"place":null,"repeat":"daily","repeatDays":null,"startsOnISO":null,"repeatUntilISO":"2026-09-30","personName":null,"correctsId":null}]}

Transcript: "I cancelled my trip to the Tetons and Spencer is kind of upset with me"
{"items":[]}

Transcript: "Just thinking out loud about my week, nothing urgent"
{"items":[]}`;


/**
 * Robustly parse the model's JSON: strip fences, slice to the outermost object,
 * try/catch. Returns { items: [...] } or { items: [] } on any failure.
 *
 * READS `reminders` TOO, because that is what the key was called for months and
 * a model handed the old shape by a cached prompt should degrade to "these are
 * all reminders" rather than to silence.
 */
function parseModelJson(raw) {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonStr =
    start !== -1 && end !== -1 && end > start
      ? cleaned.slice(start, end + 1)
      : "{}";
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed?.items)) return { items: parsed.items };
    if (Array.isArray(parsed?.reminders)) return { items: parsed.reminders };
    return { items: [] };
  } catch {
    return { items: [] };
  }
}

/** The repeats the app understands. Anything else the model says is "none". */
const REPEATS = new Set(["none", "daily", "weekdays", "weekends", "weekly", "monthly"]);

/**
 * Validate + normalize one raw item. Returns a clean object or null.
 *
 * AN EVENT NEEDS A TIME; A REMINDER MUST NOT HAVE ONE. That asymmetry is the
 * whole rule of this file and it is enforced here rather than trusted from the
 * model: an "event" whose startsAtISO will not parse is dropped, because a
 * calendar entry at an unknown time is worse than none, and a "reminder" that
 * arrives carrying a clock time is re-read as an event, because the user stating
 * a time is exactly what makes it one.
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const str = (v, max) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  const iso = (v) => {
    const t = str(v, 40);
    if (!t) return null;
    return Number.isNaN(new Date(t).getTime()) ? null : t;
  };

  const startsAtISO = iso(raw.startsAtISO);
  // The model's own label is a starting point, not the answer. A stated time is
  // what decides, in both directions.
  const kind = startsAtISO || raw.allDay === true ? "event" : "reminder";

  const title = str(raw.title, 120) || (kind === "event" ? "Event" : "Reminder");
  const body = str(raw.body, 240) || title;

  let endsAtISO = iso(raw.endsAtISO);
  // An end before its start is not an end. Dropped rather than swapped: guessing
  // which of the two the user meant is how a 9am meeting becomes an overnight.
  if (endsAtISO && startsAtISO && new Date(endsAtISO) < new Date(startsAtISO)) {
    endsAtISO = null;
  }

  const repeat = REPEATS.has(raw.repeat) ? raw.repeat : "none";
  // A stop date is meaningless without something to stop.
  const repeatUntilISO = repeat === "none" ? null : iso(raw.repeatUntilISO);

  /**
   * THE DAYS, AND THE DAY IT STARTS. Both are dates the model resolved, and
   * both are checked here rather than trusted: `reminders_repeat_days_chk`
   * only tolerates days on a WEEKLY repeat, so a stray array on a daily one is
   * not a cosmetic problem -- the database refuses the insert and the user's
   * reminder simply never appears.
   */
  const repeatDays =
    repeat === "weekly" && Array.isArray(raw.repeatDays)
      ? (() => {
          const days = [
            ...new Set(
              raw.repeatDays
                .map((d) => Number(d))
                .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
            ),
          ].sort((a, b) => a - b);
          return days.length > 0 ? days : null;
        })()
      : null;

  // A plain YYYY-MM-DD, because it is a LOCAL day and not an instant. Anything
  // else -- a full timestamp, "tomorrow", a month -- is dropped rather than
  // coerced: a wrong start date hides a reminder on the day it was asked for.
  const startsOnISO =
    typeof raw.startsOnISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.startsOnISO.trim())
      ? raw.startsOnISO.trim()
      : null;

  // WHO IT IS ABOUT, as the transcript said it. Kept as a raw name and nothing
  // more: turning it into a contact is a database question, answered in the
  // route against the caller's own address book, and a model must never be the
  // thing that decides which real person a note lands on.
  const personName = str(raw.personName, 120);

  // THE ID THIS ONE CORRECTS, checked against the list we supplied rather than
  // trusted -- see the route. A hallucinated id would otherwise move a reminder
  // that has nothing to do with what was said.
  const correctsId =
    typeof raw.correctsId === "string" &&
    /^(?:rem|evt)_[a-zA-Z0-9_-]{8,128}$/.test(raw.correctsId.trim())
      ? raw.correctsId.trim()
      : null;

  const item = {
    kind,
    title,
    body,
    description: str(raw.description, 2000),
    place: str(raw.place, 200),
    allDay: raw.allDay === true,
    startsAtISO,
    endsAtISO,
    repeat,
    repeatDays,
    startsOnISO,
    repeatUntilISO,
    personName,
    correctsId,
  };

  if (kind === "event" && !startsAtISO && !item.allDay) return null;
  if (kind === "reminder") {
    item.startsAtISO = null;
    item.endsAtISO = null;
    item.allDay = false;
  }
  return item;
}

/**
 * BACKWARD COMPATIBILITY, and it is load-bearing.
 *
 * jobs/reminder-smoke.test.js and the route's own deps still speak in
 * { fireAtISO, title, body, eventAtISO, personName, correctsId }. Nothing about
 * how a reminder is PERSISTED has changed -- only which utterances become one --
 * so the reminder half of an item is handed on in the shape it has always had.
 */
function asLegacyReminder(item) {
  return {
    fireAtISO: item.startsAtISO,
    title: item.title,
    body: item.body,
    eventAtISO: null,
    personName: item.personName,
    correctsId: item.correctsId,
  };
}

/**
 * Extract reminders via Claude. Network boundary (fetchImpl) injectable for
 * tests. Fail-open to [] on any error.
 */
export async function parseReminders({
  text,
  nowISO,
  tzOffsetMinutes,
  // The reminders this transcript could be CORRECTING: [{ id, title, fireAt }].
  // Empty for almost every call -- see listRecentSelfReminders for why the
  // window is narrow.
  recent = [],
  model = REMINDER_MODEL,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return [];
  if (typeof text !== "string" || !text.trim()) return [];

  const ctx = localNowContext(nowISO, Number(tzOffsetMinutes) || 0);
  if (!ctx) return [];

  // Only sent when there is something to correct, so the common call is the
  // same prompt it has always been.
  const recentBlock =
    Array.isArray(recent) && recent.length > 0
      ? `RECENT REMINDERS: ${JSON.stringify(
          recent.slice(0, 5).map((r) => ({
            id: r.id,
            title: r.title,
            fireAt: r.fireAt,
          })),
        )}\n`
      : "";

  const user =
    `Current local time: ${ctx.localStr} (${ctx.weekday}). ` +
    `UTC offset: ${ctx.offStr}. Output all fireAtISO/eventAtISO values with this offset.\n\n` +
    recentBlock +
    `Transcript:\n"""${text.trim()}"""\n\nJSON:`;

  try {
    const resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        temperature: 0,
        system: SCHEDULE_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const rawText = (data?.content || [])
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .join(" ");
    const { items } = parseModelJson(rawText);
    const out = [];
    for (const r of items) {
      const norm = normalizeItem(r);
      if (norm) out.push(norm);
    }
    return out;
  } catch {
    return []; // fail-open: never block capture on a parse error
  }
}

export function registerRemindersParseRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const parse = deps.parseReminders || parseReminders;
  // Persistence deps (injectable for tests). Persistence is BEST-EFFORT: a
  // failure here never changes the { reminders } response the app relies on.
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const readChannels = deps.getNotificationChannels || getNotificationChannels;
  const persist = deps.persistSelfReminder || persistSelfReminder;
  const listRecent = deps.listRecentSelfReminders || listRecentSelfReminders;
  const updateOne = deps.updateSelfReminder || updateSelfReminder;
  const findContact = deps.findContactByName || findContactByName;
  const recordObservation = deps.recordReminderObservation || recordReminderObservation;
  // The two halves of "a stated time decides where this lands".
  const makeEvent = deps.createScheduledEvent || createScheduledEvent;
  const makeOpenReminder = deps.createOpenReminder || createOpenReminder;
  const moveEvent = deps.updateScheduledEvent || updateScheduledEvent;
  const listRecentEvents = deps.listRecentCorrectableEvents || listRecentCorrectableEvents;

  // ── POST /v1/reminders/parse ──────────────────────────────────────────
  app.post(
    "/v1/reminders/parse",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["text", "nowISO", "tzOffsetMinutes"],
          properties: {
            text: { type: "string", maxLength: 8000 },
            nowISO: { type: "string", maxLength: 40 },
            tzOffsetMinutes: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const did = request.privyUser?.userId || "unknown";
      const phone = request.privyUser?.phone || null;
      const body = request.body || {};

      // ── The owner is resolved BEFORE the parse now ──────────────────────
      //
      // It used to happen afterwards, because persistence was the only thing
      // that needed it. The parse itself needs it too: "no, 7:30 AM" is
      // meaningless without knowing what the user set ninety seconds ago, and
      // that lookup is owner-scoped. A failure to resolve is not fatal —
      // parsing still works, corrections just cannot be recognized.
      const ownerId = phone
        ? await resolveAmber(phone).catch(() => null)
        : null;

      const recentRows = ownerId
        ? await listRecent(ownerId, { withinMinutes: 30, limit: 5 }).catch(() => [])
        : [];
      const recent = recentRows.map((r) => ({
        id: r.reminder_id,
        title: r.title || r.message || "Reminder",
        fireAt:
          (typeof r.when?.iso === "string" ? r.when.iso : null) ||
          (r.due_at instanceof Date ? r.due_at.toISOString() : r.due_at || null),
      }));
      /**
       * WHAT A CORRECTION COULD BE TALKING ABOUT, and it is no longer only
       * reminders. A stated time now makes an EVENT, so "no, 7:30 in the
       * morning" is almost always correcting one -- and without offering them
       * here the model has nothing to point at and emits a new item, which lands
       * as a SECOND appointment. A duplicate on the calendar is a worse failure
       * than the one this feature exists to prevent.
       */
      const recentEvents = ownerId ? await listRecentEvents(ownerId).catch(() => []) : [];
      if (recentEvents.length > 0) recent.push(...recentEvents);
      const correctable = new Set(recent.map((r) => r.id));

      const parsed = await parse({
        text: body.text,
        nowISO: body.nowISO,
        tzOffsetMinutes: body.tzOffsetMinutes,
        recent,
      }).catch(() => []);

      request.log?.info?.(
        // `did` is the person_id, while every other line in the same request logs
        // amber_id — so a single voice note produced two different owner= values in
        // the log and could not be traced end to end. Both, explicitly labeled.
        `REMINDER_PARSE personId=${did} owner=${ownerId ?? "unresolved"} ` +
          `count=${parsed.length} recent=${recent.length}`,
      );

      /**
       * A STATED TIME GOES ON THE CALENDAR; EVERYTHING ELSE WAITS AT THE TOP.
       *
       *   "Anything with a stated time becomes an event on the calendar.
       *    Anything that's a reminder ... should just be a notification and a
       *    reminder that sits at the top of your notes and journals until it's
       *    checked off. It doesn't need to go in the calendar. ... If they say,
       *    'Remind me to pick up my clothes at 3 pm today,' then that
       *    immediately becomes a scheduled event in the calendar, even though
       *    they said 'remind.'"
       *
       * The split is HERE and nowhere else. normalizeItem already decided which
       * each one is -- from whether a clock time survived parsing, not from the
       * word "remind" -- so this loop only has to send each half somewhere.
       */
      const timed = parsed.filter((p) => p.kind === "event");
      const untimed = parsed.filter((p) => p.kind !== "event");

      const events = [];
      if (ownerId) {
        for (const ev of timed) {
          const entry = {
            title: ev.title,
            startsAtISO: ev.startsAtISO,
            endsAtISO: ev.endsAtISO,
            place: ev.place,
            allDay: ev.allDay,
            eventId: null,
            corrected: false,
          };
          try {
            /**
             * A CORRECTION MOVES THE EVENT IT CORRECTS. Falling through to the
             * insert below would leave two appointments an hour apart, one
             * wrong, neither distinguishable from the other -- which is exactly
             * the failure the reminder path has guarded against since it was
             * written.
             */
            const fixing = ev.correctsId && correctable.has(ev.correctsId);
            const targetEventId = fixing ? eventIdFromCorrectsId(ev.correctsId) : null;
            if (targetEventId) {
              const moved = await moveEvent(targetEventId, ownerId, {
                title: ev.title,
                startsAt: ev.startsAtISO,
                endsAt: ev.endsAtISO,
              });
              if (moved) {
                entry.eventId = String(moved);
                entry.corrected = true;
                request.log?.info?.(
                  `EVENT_CORRECTED owner=${ownerId} event=${entry.eventId} at=${ev.startsAtISO}`,
                );
                events.push(entry);
                continue;
              }
              // The row went away between the list and the update. Fall through
              // and insert: the user asked for something at a time, and having
              // nothing at all is the one outcome they did not ask for.
            }

            let contactId = null;
            if (ev.personName) {
              const hit = await findContact(ownerId, ev.personName).catch(() => null);
              if (hit?.id) contactId = String(hit.id);
            }
            const made = await makeEvent({
              ownerId,
              contactId,
              title: ev.title,
              description: ev.description,
              place: ev.place,
              startsAt: ev.startsAtISO,
              endsAt: ev.endsAtISO,
              allDay: ev.allDay,
              repeat: ev.repeat,
              repeatUntil: ev.repeatUntilISO,
            });
            entry.eventId = made?.eventId ?? null;
            request.log?.info?.(
              `EVENT_FROM_SPEECH owner=${ownerId} event=${entry.eventId} at=${ev.startsAtISO}`,
            );

            /**
             * AN EVENT'S NOTIFICATION IS A REMINDER ROW, AND THAT IS DELIBERATE.
             *
             * "Calendar events get a notification 10 minutes before they occur."
             *
             * Moving timed "remind me at 3pm" from the reminder path to the
             * event path would otherwise have SILENTLY REMOVED the notification
             * the user gets today -- the one delivery mechanism that works end
             * to end is jobs/reminder-scheduler.js scanning reminders for a due
             * due_at. Building a second scheduler for events would be two things
             * doing one job, and shipping neither would be a regression dressed
             * up as a feature.
             *
             * So the event owns a delivery row: same table, same scheduler, a
             * due_at of (start - lead). It is tagged `event_notification` so it
             * is never LISTED as a reminder -- see listScheduledReminders, which
             * excludes it, and listOpenReminders, which only reads rows with no
             * due_at at all. The user sees one event; the machine sees one row
             * to send.
             */
            if (entry.eventId && phone && did !== "unknown" && !ev.allDay) {
              const lead = DEFAULT_NOTIFY_MINUTES * 60_000;
              const fireAt = new Date(new Date(ev.startsAtISO).getTime() - lead);
              /**
               * MEASURED AGAINST THE CLIENT'S OWN "NOW", NOT THE SERVER'S.
               *
               * A notification for a time that has already passed is a phone
               * buzzing about something you are already late for -- but the
               * question "has it passed" belongs to the same clock that resolved
               * "5pm" into an instant, which is body.nowISO. The first draft used
               * Date.now(), which is a second clock in a routine whose whole
               * subject is the first one, and it silently drops notifications
               * whenever the two disagree.
               */
              const parsedNow = new Date(body.nowISO);
              const nowMs = Number.isNaN(parsedNow.getTime()) ? Date.now() : parsedNow.getTime();
              if (fireAt.getTime() > nowMs) {
                await persist({
                  tenantDid: did,
                  ownerPhone: phone,
                  fireAtISO: fireAt.toISOString(),
                  title: ev.title,
                  body: `${ev.title} in ${DEFAULT_NOTIFY_MINUTES} minutes`,
                  eventAtISO: ev.startsAtISO,
                  channels: await readChannels(ownerId).catch(() => null),
                  contact: contactId ? { id: contactId, name: ev.personName } : null,
                  kind: "event_notification",
                  eventId: entry.eventId,
                }).catch((err) =>
                  request.log?.warn?.(
                    `EVENT_NOTIFY_FAILED owner=${ownerId} event=${entry.eventId}: ${err?.message || err}`,
                  ),
                );
              }
            }
          } catch (err) {
            // Best-effort, like the reminder path below: a failure to write the
            // row must never cost the user the response.
            request.log?.error?.(
              `EVENT_FROM_SPEECH_FAILED owner=${ownerId}: ${err?.message || err}`,
            );
          }
          events.push(entry);
        }
      }

      const channels =
        ownerId && untimed.length > 0
          ? await readChannels(ownerId).catch(() => null)
          : null;

      // ── Persist EVERY parsed reminder (best-effort) ─────────────────────
      //
      // This used to persist only when the owner had the iMessage channel on,
      // on the reasoning that an Apple-only reminder needs no server row
      // because the phone delivers it. That reasoning was about DELIVERY, and
      // it was right about delivery — but it made the server row a side effect
      // of a notification preference, which meant the app had no list of the
      // user's reminders to show, tick off or open, and a reinstall lost every
      // reminder they had ever set. The row is now written for every parsed
      // reminder and DELIVERY is still decided by the channel:
      // buildSelfReminderRow names the transport after the channel the user
      // chose, and listDueSelfReminders scans only for transport = 'imessage'.
      //
      // THREE THINGS HAPPEN PER REMINDER, and each one is separately
      // best-effort so a failure in the third cannot cost the user the first:
      //
      //   1. WHO IT IS ABOUT. The model returns the name as spoken; the name is
      //      matched against the caller's OWN contacts by exact first/full name
      //      (findContactByName), and no match means no contact. Never phonetic
      //      and never a guess: a wrong match here files a phone call in a real
      //      person's history.
      //   2. THE ROW — updated in place when this is a correction of something
      //      the user set minutes ago, inserted otherwise. A correction that
      //      inserted instead would leave the user with two notifications
      //      twelve hours apart, one wrong, neither distinguishable from the
      //      other. Only ids WE listed are correctable, so a hallucinated id
      //      moves nothing.
      //   3. AN OBSERVATION, when it is about somebody — because an intention
      //      to call someone is evidence about that relationship, and it was
      //      previously thrown away. See db/reminder-observations.js.
      //
      // The response stays backward compatible: the same { reminders } array,
      // with reminderId / contact / corrected added to each entry.
      const out = [];
      for (const item of untimed) {
        // UNTIMED, so there is no fireAtISO. asLegacyReminder keeps the rest of
        // this block -- contact matching, correction, the observation -- in the
        // shape it has always had, because none of that changed.
        const r = asLegacyReminder(item);
        const entry = {
          fireAtISO: r.fireAtISO,
          title: r.title,
          body: r.body,
          eventAtISO: r.eventAtISO ?? null,
          reminderId: null,
          contact: null,
          corrected: false,
        };

        if (ownerId && r.personName) {
          try {
            const hit = await findContact(ownerId, r.personName);
            if (hit?.id) {
              entry.contact = { id: String(hit.id), name: hit.name ?? r.personName };
            }
          } catch (err) {
            request.log?.warn?.(
              `REMINDER_CONTACT_LOOKUP_FAILED owner=${ownerId}: ${err.message}`,
            );
          }
        }

        if (!ownerId || !phone || did === "unknown") {
          out.push(entry);
          continue;
        }

        const correcting = r.correctsId && correctable.has(r.correctsId);
        try {
          if (correcting) {
            const moved = await updateOne(r.correctsId, ownerId, {
              fireAtISO: r.fireAtISO,
              title: r.title,
              body: r.body,
              contact: entry.contact,
              eventAtISO: r.eventAtISO ?? null,
            });
            if (moved) {
              entry.reminderId = moved.reminder_id;
              entry.corrected = true;
              // No second observation. The intention was already recorded when
              // the reminder was first set; a correction to its TIME is not a
              // new thing you know about the person, and writing one per "no,
              // 7:30" would inflate the very number this feeds.
              request.log?.info?.(
                `REMINDER_CORRECTED owner=${ownerId} id=${moved.reminder_id} due=${r.fireAtISO}`,
              );
              out.push(entry);
              continue;
            }
            // The row went away (fired, ticked off, cancelled) between the
            // list and the update. Fall through and insert: the user asked to
            // be reminded at a time, and having no reminder at all is the one
            // outcome they did not ask for.
          }

          /**
           * NO due_at, BECAUSE THERE IS NO TIME.
           *
           * db/self-reminders.js's persist() builds a row for the timed iMessage
           * scheduler and needs a fireAtISO; these have none by definition. They
           * are open items that live at the top of Notes & Journal until they
           * are ticked off, and their notification -- if the user sets one -- is
           * a time of day, not an instant.
           */
          const reminderId = await makeOpenReminder({
            ownerId,
            reminderId: `rem_${randomUUID()}`,
            title: r.title,
            body: r.body,
            description: item.description,
            place: item.place,
            contactId: entry.contact?.id ?? null,
            repeat: item.repeat,
            repeatUntil: item.repeatUntilISO,
            repeatDays: item.repeatDays,
            // WHICH DAY IT STARTS ON, so "remind me tomorrow and Sunday" is not
            // also sitting at the top of today. Null means from now on.
            startsOn: item.startsOnISO,
            data: { origin: "self_reminder" },
          });
          entry.reminderId = reminderId;

          if (entry.contact?.id) {
            await recordObservation({
              ownerId,
              contactId: entry.contact.id,
              contactName: entry.contact.name,
              title: r.title,
              body: r.body,
              fireAtISO: r.fireAtISO,
              log: request.log,
            }).catch(() => null);
          }
        } catch (err) {
          request.log?.warn?.(
            `REMINDER_PERSIST_ITEM_FAILED owner=${ownerId}: ${err.message}`,
          );
        }
        out.push(entry);
      }

      if (out.length > 0) {
        request.log?.info?.(
          `REMINDER_PERSIST owner=${ownerId ?? did} ` +
            `stored=${out.filter((e) => e.reminderId).length} ` +
            `corrected=${out.filter((e) => e.corrected).length} ` +
            `withContact=${out.filter((e) => e.contact).length} ` +
            `imessage=${Boolean(channels?.imessage)}`,
        );
      }

      // BACKWARD COMPATIBLE: `reminders` is the key the app has always read, and
      // it still holds reminders. `events` is additive, so an older client that
      // ignores it still gets a correct (if quieter) answer.
      return reply.send({ reminders: out, events });
    },
  );
}
