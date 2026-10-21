/**
 * THE DAY WINDOW AND THE BLOCK IT FILLS.
 *
 * Two things are being pinned, and only one of them is about words.
 *
 * The window is timezone arithmetic, which this codebase has already got wrong
 * three times in one week: a UTC date used as a local one, a Date parsed from
 * "2026-09-13" landing on the 12th, a created_at compared against a local day.
 * Every one of those was a one-liner that read correctly. So the window is
 * tested in zones that break the shortcuts: half-hour offsets, a DST boundary,
 * and the side of Greenwich where the UTC date is already tomorrow.
 *
 * The block is prompt text, and the temptation with prompt text is to assert
 * nothing because "the model will figure it out". What is asserted here is only
 * what would silently ruin an answer: the times must be in the USER'S zone, an
 * empty calendar must not read as a free day, and there must not be an em-dash
 * in it, because CHAT_SYSTEM forbids them in the reply and a model writes like
 * its context.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dayWindow, localDateKey, renderDayBrief } from "./day-brief.js";

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const KOLKATA = "Asia/Kolkata";
const SYDNEY = "Australia/Sydney";

test("the window starts at LOCAL midnight, not at the server's", () => {
  // 4:04am UTC on the 12th is 9:04pm on the 11th in Los Angeles. The window has
  // to be the 11th there, and it has to start at 07:00Z, which is that day's
  // midnight. A server that used its own date would hand back the 12th and the
  // user would be told their evening is over.
  const now = new Date("2026-09-12T04:04:00Z");
  const win = dayWindow({ now, timeZone: LA, days: 1 });
  assert.equal(win.todayKey, "2026-09-11");
  assert.equal(win.fromISO, "2026-09-11T07:00:00.000Z");
  assert.equal(win.toISO, "2026-09-12T07:00:00.000Z");
});

test("east of Greenwich the local day is already the next one", () => {
  // The mirror image, and the case a UTC fallback gets wrong by a whole day.
  const now = new Date("2026-09-11T22:30:00Z");
  const win = dayWindow({ now, timeZone: SYDNEY, days: 1 });
  assert.equal(win.todayKey, "2026-09-12");
  assert.equal(win.fromISO, "2026-09-11T14:00:00.000Z");
});

test("a half-hour offset is not rounded to an hour", () => {
  // Asia/Kolkata is +05:30. Any implementation that multiplies whole hours puts
  // midnight thirty minutes into the wrong day, which loses a 12:15am item and
  // gains an 11:45pm one.
  const win = dayWindow({ now: new Date("2026-09-11T10:00:00Z"), timeZone: KOLKATA, days: 1 });
  assert.equal(win.todayKey, "2026-09-11");
  assert.equal(win.fromISO, "2026-09-10T18:30:00.000Z");
  assert.equal(win.toISO, "2026-09-11T18:30:00.000Z");
});

test("a day that is 23 hours long is still one day", () => {
  /**
   * DST, and the reason the offset is measured twice.
   *
   * On 2026-03-08 New York springs forward, so the offset at midnight (-05:00)
   * is not the offset at the end of the day (-04:00). Computing the boundary
   * with one offset for both puts the start an hour off, which silently drops
   * anything scheduled in the first hour.
   */
  const win = dayWindow({ now: new Date("2026-03-08T12:00:00Z"), timeZone: NY, days: 1 });
  assert.equal(win.todayKey, "2026-03-08");
  assert.equal(win.fromISO, "2026-03-08T05:00:00.000Z");
  assert.equal(win.toISO, "2026-03-09T04:00:00.000Z");
});

test("and a day that is 25 hours long is also one day", () => {
  // The other direction: 2026-11-01 falls back.
  const win = dayWindow({ now: new Date("2026-11-01T12:00:00Z"), timeZone: NY, days: 1 });
  assert.equal(win.fromISO, "2026-11-01T04:00:00.000Z");
  assert.equal(win.toISO, "2026-11-02T05:00:00.000Z");
});

test("a day whose midnight does not exist still starts somewhere", () => {
  /**
   * America/Havana springs forward AT midnight: on 2026-03-08 the clock goes
   * 23:59 straight to 01:00, so there is no 00:00 to convert. The first instant
   * of that local day is 05:00Z.
   *
   * The single-measurement version of this returns 04:00Z, which is 23:00 on
   * the SEVENTH: an hour of the previous evening filed under today, and the
   * window starting before the day it claims to cover.
   */
  const win = dayWindow({ now: new Date("2026-03-08T12:00:00Z"), timeZone: "America/Havana", days: 1 });
  assert.equal(win.todayKey, "2026-03-08");
  assert.equal(win.fromISO, "2026-03-08T05:00:00.000Z");
  assert.equal(localDateKey(new Date(win.fromISO), "America/Havana"), "2026-03-08");
});

test("a day whose midnight happens twice starts at the first one", () => {
  // Havana falls back at 01:00 -> 00:00 on 2026-11-01, so 00:00 local is both
  // 04:00Z and 05:00Z. Starting at the second loses the hour between them.
  const win = dayWindow({ now: new Date("2026-11-01T12:00:00Z"), timeZone: "America/Havana", days: 1 });
  assert.equal(win.fromISO, "2026-11-01T04:00:00.000Z");
});

test("east of Greenwich, one measurement is taken on the wrong side of the change", () => {
  /**
   * THE CASE THAT MAKES THE SECOND MEASUREMENT LOAD-BEARING, and it is not
   * America: in a positive-offset zone, UTC midnight is the middle of the local
   * day, so a change that happens in the small hours falls BETWEEN the local
   * midnight we want and the instant the offset was measured at.
   *
   * Pacific/Auckland ends daylight time on 2026-04-05 at 03:00 local. Measuring
   * the offset at 2026-04-05T00:00Z reads +12 (after the change) and puts the
   * start of the day at 12:00Z, which is 01:00 local: the first hour of the
   * user's Sunday, dropped. The day actually starts at 11:00Z.
   */
  const win = dayWindow({ now: new Date("2026-04-05T02:00:00Z"), timeZone: "Pacific/Auckland", days: 1 });
  assert.equal(win.todayKey, "2026-04-05");
  assert.equal(win.fromISO, "2026-04-04T11:00:00.000Z");
  assert.equal(localDateKey(new Date(win.fromISO), "Pacific/Auckland"), "2026-04-05");
});

test("a timezone the client made up degrades to UTC instead of throwing", () => {
  // The zone comes off a request body. A 500 on a bad string would take out the
  // whole chat turn, not just the calendar half of it.
  for (const bad of ["Mars/Olympus", "", null, undefined, 42, "America/Nowhere"]) {
    const win = dayWindow({ now: new Date("2026-09-11T10:00:00Z"), timeZone: bad, days: 1 });
    assert.equal(win.todayKey, "2026-09-11");
    assert.equal(win.timeZone, "UTC");
  }
});

test("the span is clamped, so a bad `days` cannot ask for a decade", () => {
  const now = new Date("2026-09-11T10:00:00Z");
  assert.equal(dayWindow({ now, timeZone: "UTC", days: 0 }).days, 1);
  assert.equal(dayWindow({ now, timeZone: "UTC", days: -5 }).days, 1);
  assert.equal(dayWindow({ now, timeZone: "UTC", days: 5000 }).days, 62);
  assert.equal(dayWindow({ now, timeZone: "UTC" }).days, 8);
});

test("localDateKey reads the zone, not the machine", () => {
  const evening = new Date("2026-09-12T02:30:00Z");
  assert.equal(localDateKey(evening, NY), "2026-09-11");
  assert.equal(localDateKey(evening, "UTC"), "2026-09-12");
});

// ── the block ────────────────────────────────────────────────────────────────

const EVENT = {
  startsAt: "2026-09-12T14:00:00Z", // 10am in New York
  endsAt: "2026-09-12T15:00:00Z",
  title: "Meeting",
  withPerson: { contactId: "c1", name: "Sagar" },
  place: { name: "Dumbo" },
};

test("times are printed in the USER'S timezone", () => {
  const block = renderDayBrief({
    events: [EVENT],
    timeZone: NY,
    todayKey: "2026-09-11",
    days: 8,
  });
  assert.match(block, /10:00 AM to 11:00 AM: Meeting \(with Sagar, at Dumbo\)/);
  // The same instant, read from Los Angeles.
  const west = renderDayBrief({ events: [EVENT], timeZone: LA, todayKey: "2026-09-11", days: 8 });
  assert.match(west, /7:00 AM to 8:00 AM: Meeting/);
});

test("days are headed, and today and tomorrow are named", () => {
  const block = renderDayBrief({
    events: [EVENT],
    timeZone: NY,
    todayKey: "2026-09-11",
    days: 8,
  });
  assert.match(block, /Saturday, Sep 12 \(tomorrow\):/);

  const sameDay = renderDayBrief({
    events: [EVENT],
    timeZone: NY,
    todayKey: "2026-09-12",
    days: 8,
  });
  assert.match(sameDay, /Saturday, Sep 12 \(today\):/);
});

test("an item lands on the day it happens WHERE THE USER IS", () => {
  /**
   * 11:30pm in Los Angeles is already the next date in UTC. Grouping on the UTC
   * date would file a Friday-night dinner under Saturday, which is the bug that
   * put a note on the wrong day twice before in this codebase.
   */
  const lateNight = { startsAt: "2026-09-12T06:30:00Z", title: "Dinner" };
  const block = renderDayBrief({
    events: [lateNight],
    timeZone: LA,
    todayKey: "2026-09-11",
    days: 8,
  });
  assert.match(block, /Friday, Sep 11 \(today\):/);
  assert.doesNotMatch(block, /Saturday, Sep 12/);
});

test("an empty calendar is never reported as a free day", () => {
  // THE ANSWER THIS EXISTS TO PREVENT. The iPhone's own calendar is read on the
  // device and never reaches the server, so "nothing scheduled" here means
  // "nothing I can see", and the block has to say which.
  const block = renderDayBrief({ timeZone: NY, todayKey: "2026-09-11", days: 8 });
  assert.match(block, /Nothing scheduled in that window\./);
  assert.match(block, /not proof of a free day/);
  assert.match(block, /do not declare them free/);
});

test("no connected calendar is said out loud, and one is counted", () => {
  const none = renderDayBrief({ timeZone: NY, todayKey: "2026-09-11", connectedCalendars: 0 });
  assert.match(none, /NO calendar account connected/);
  assert.match(none, /Settings/);

  const one = renderDayBrief({ timeZone: NY, todayKey: "2026-09-11", connectedCalendars: 1 });
  assert.match(one, /1 connected calendar account,/);
  assert.doesNotMatch(one, /NO calendar account/);

  const two = renderDayBrief({ timeZone: NY, todayKey: "2026-09-11", connectedCalendars: 2 });
  assert.match(two, /2 connected calendar accounts,/);
});

test("untimed reminders are listed apart from the day, and ticked ones are not listed at all", () => {
  const block = renderDayBrief({
    openReminders: [
      { title: "Find a place for deep work", doneToday: false },
      { title: "Drink water", doneToday: true },
    ],
    timeZone: NY,
    todayKey: "2026-09-11",
  });
  assert.match(block, /OPEN REMINDERS TODAY/);
  assert.match(block, /Find a place for deep work/);
  assert.doesNotMatch(block, /Drink water/, "a reminder they already ticked off is not owed");
});

test("a timed reminder carried over from a past day says so", () => {
  const block = renderDayBrief({
    timedReminders: [
      { startsAt: "2026-09-10T17:00:00Z", title: "Call the bank", carriedOver: true, done: false },
    ],
    timeZone: NY,
    todayKey: "2026-09-11",
  });
  assert.match(block, /Call the bank \(reminder, carried over and still open\)/);
});

test("an item with no usable time is dropped rather than printed as Invalid Date", () => {
  const block = renderDayBrief({
    events: [{ startsAt: null, title: "Ghost" }, { startsAt: "not a date", title: "Phantom" }],
    timedReminders: [{ startsAt: undefined, title: "Wisp" }],
    timeZone: NY,
    todayKey: "2026-09-11",
  });
  assert.doesNotMatch(block, /Ghost|Phantom|Wisp|Invalid/);
  assert.match(block, /Nothing scheduled in that window\./);
});

test("THE BLOCK CONTAINS NO EM-DASH OR EN-DASH", () => {
  /**
   * CHAT_SYSTEM: "HARD RULE: NEVER use em-dashes or en-dashes anywhere in your
   * reply." A model treats its context as a sample of the register it is being
   * asked to write in, so a day list punctuated with em-dashes is an instruction
   * fighting an example. The example loses less often than it should.
   */
  const block = renderDayBrief({
    events: [EVENT],
    timedReminders: [{ startsAt: "2026-09-12T20:00:00Z", title: "Call mom", carriedOver: true }],
    openReminders: [{ title: "Deep work" }],
    connectedCalendars: 0,
    timeZone: NY,
    todayKey: "2026-09-11",
  });
  assert.doesNotMatch(block, /[—–]/);
});

test("the block says the day is theirs and forbids the deflection", () => {
  // The literal complaint: "Calendar is something you'd manage through your
  // phone or calendar app directly."
  const block = renderDayBrief({ events: [EVENT], timeZone: NY, todayKey: "2026-09-11" });
  assert.match(block, /THEIR DAY, FROM AMBER'S OWN RECORDS/);
  assert.match(block, /Never tell them to go and look in a calendar app/);
});
