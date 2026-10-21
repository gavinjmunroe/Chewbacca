/**
 * WHAT IS ON THEIR DAY, IN WORDS, FOR THE PROMPT.
 *
 *   "What's on my calendar?"
 *   "Calendar is something you'd manage through your phone or calendar app
 *    directly. What I hold is your people..."
 *
 * That answer was given by an app that had the user's events in its own
 * database, on a screen one tab away. Nothing was broken -- the chat turn was
 * simply never handed the day, so the model answered from the only thing it had
 * been told it was, which is a relationship memory. This module is the missing
 * half: the window to ask for, and the block that goes into the prompt.
 *
 * TWO JOBS, ONE FILE, because they are the same fact seen twice. The window is
 * "midnight where the user is standing, for the next N days"; the block is that
 * same window read back to them. Splitting them across two files is how the
 * renderer ends up labeling a day the query never selected.
 *
 * EVERYTHING HERE IS PURE. No database, no clock of its own -- `now` is passed
 * in. The route does the reading; this decides what to ask for and how it reads.
 */

/**
 * THE UTC INSTANT OF LOCAL MIDNIGHT, and it cannot be done with arithmetic.
 *
 * The naive version adds a fixed offset, and there is no fixed offset: the
 * offset is a function of the instant (DST), it is not always a whole number of
 * hours (Asia/Kolkata is +05:30, Australia/Eucla is +08:45), and it is not the
 * server's. So the offset is MEASURED at the instant in question, by formatting
 * it in the target zone and asking how far the answer is from UTC.
 *
 * The measurement is done twice. The offset that applies at midnight is not
 * necessarily the offset that applied at the instant we started from -- on a
 * spring-forward morning those differ by an hour, which is exactly enough to
 * put "today" one hour into yesterday and drop the first event of the day.
 */
function offsetMsAt(instant, timeZone) {
  // en-CA gives YYYY-MM-DD, and `hour12: false` keeps 24-hour parts. Reading the
  // instant AS IF it were UTC and differencing yields the zone's offset.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  // Hour 24 is how some engines spell midnight in this format.
  const hour = get("hour") % 24;
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  // Milliseconds are not in the parts, so compare on the second.
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The local calendar date in a zone, as YYYY-MM-DD. */
export function localDateKey(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    // An unknown zone is the caller's data, not a crash. UTC is the honest
    // fallback: wrong by hours for some users, wrong by a day for none.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/**
 * The window to read: local midnight today, through local midnight `days` later.
 *
 * HALF-OPEN [from, to), matching db/agenda.js -- a closed upper bound shows
 * midnight twice on consecutive days.
 *
 * STARTS AT MIDNIGHT, NOT AT NOW, on purpose. Asked at four in the afternoon,
 * "what's on my calendar" is still a question about the whole day: an answer
 * that silently dropped this morning's meeting would be worse than a late one.
 */
export function dayWindow({ now = new Date(), timeZone = "UTC", days = 8 } = {}) {
  const zone = safeZone(timeZone);
  // `Number(days) || 8` would turn a caller's 0 into eight days, which is the
  // opposite of what asking for zero means. Only a value that is not a number
  // at all falls back.
  const asked = Number(days);
  const span = Math.min(Math.max(Math.trunc(Number.isFinite(asked) ? asked : 8), 1), 62);
  const todayKey = localDateKey(now, zone);

  const from = midnightUTC(todayKey, zone);
  const to = new Date(midnightUTC(addDays(todayKey, span), zone));

  return { fromISO: new Date(from).toISOString(), toISO: to.toISOString(), todayKey, timeZone: zone, days: span };
}

function safeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Milliseconds at the START of a local day, which is not always midnight.
 *
 * TWO GUESSES AND A CHECK, because one measurement can be measured on the wrong
 * side of a transition and there are days when midnight does not exist.
 *
 * The offset is read at the naive instant, which gives a first candidate; the
 * offset at THAT candidate gives a second. On an ordinary day they agree. They
 * disagree exactly when a transition falls between the two, and then the check
 * settles it: keep the candidates that actually land on the day we asked for,
 * and take the earliest of those.
 *
 *   America/Havana, 2026-03-08: the clock goes 23:59 -> 01:00, so there IS no
 *   midnight. One candidate is 01:00 on the 8th and the other is 23:00 on the
 *   7th. The day starts at the first one; taking the second would pull an hour
 *   of the previous evening into it and label it today.
 *
 *   America/Havana, 2026-11-01: midnight happens TWICE. Both candidates are
 *   valid and the earlier one is where the day starts.
 */
function midnightUTC(dateKey, timeZone) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  const first = naive - offsetMsAt(new Date(naive), timeZone);
  const second = naive - offsetMsAt(new Date(first), timeZone);

  const onTheDay = [first, second].filter(
    (ms) => localDateKey(new Date(ms), timeZone) === dateKey,
  );
  if (onTheDay.length > 0) return Math.min(...onTheDay);
  // Neither landed on the day: the zone is stranger than either guess. The
  // first candidate is the one derived from the day itself, so it is the less
  // arbitrary of the two.
  return first;
}

/** YYYY-MM-DD, n days on. Calendar arithmetic, so it is safe across DST. */
function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + n));
  return moved.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Saturday, Sep 12" from a YYYY-MM-DD, with no Date parsing to get wrong. */
function dayHeading(dateKey, todayKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const stamp = `${weekday}, ${MONTHS[m - 1]} ${d}`;
  if (dateKey === todayKey) return `${stamp} (today)`;
  if (dateKey === addDays(todayKey, 1)) return `${stamp} (tomorrow)`;
  return stamp;
}

/** "9:00 AM" in the user's zone, from an instant. */
function clock(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(instant);
  } catch {
    return null;
  }
}

function asDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * The day, as a block of prose for the prompt.
 *
 * WHAT IT SAYS ABOUT ITSELF IS PART OF THE ANSWER. This is everything AMBER
 * holds: what the user said out loud, plus the calendar accounts they connected.
 * A calendar that lives only on the phone -- the iPhone's own Calendar app,
 * which the day view reads on the device and merges there -- never reaches this
 * server. So a quiet block does NOT mean a free day, and the block says so in
 * the words the model will read, because the alternative is Amber telling
 * somebody they have nothing on a morning they are booked solid.
 *
 * @param {object} args
 * @param {Array}  args.events           listAgendaEvents rows
 * @param {Array}  args.timedReminders   listScheduledReminders rows
 * @param {Array}  args.openReminders    listOpenReminders rows (today, untimed)
 * @param {number} args.connectedCalendars how many calendar accounts are synced
 * @returns {string} the block, or "" when there is nothing to say at all
 */
export function renderDayBrief({
  events = [],
  timedReminders = [],
  openReminders = [],
  connectedCalendars = 0,
  timeZone = "UTC",
  todayKey,
  days = 8,
} = {}) {
  const zone = safeZone(timeZone);
  const today = todayKey || localDateKey(new Date(), zone);

  /** Everything with an instant, folded into one list and grouped by local day. */
  const byDay = new Map();
  const add = (dateKey, line) => {
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);
    byDay.get(dateKey).push(line);
  };

  for (const e of events) {
    const start = asDate(e?.startsAt);
    if (!start) continue;
    const end = asDate(e?.endsAt);
    const when = clock(start, zone);
    const span = end ? `${when} to ${clock(end, zone)}` : when;
    /**
     * NO EM-DASHES ANYWHERE IN THIS BLOCK. CHAT_SYSTEM carries a hard rule
     * against them in the reply, and a model reads its context as a sample of
     * how to write: feeding it a list punctuated with em-dashes is the surest
     * way to get one back in the answer.
     */
    const tail = [
      e?.withPerson?.name ? `with ${e.withPerson.name}` : null,
      e?.place?.name ? `at ${e.place.name}` : null,
    ].filter(Boolean);
    const line = `${when ? `${span}: ` : ""}${e?.title || "Untitled"}`;
    add(localDateKey(start, zone), `- ${line}${tail.length ? ` (${tail.join(", ")})` : ""}`);
  }

  for (const r of timedReminders) {
    const start = asDate(r?.startsAt);
    if (!start) continue;
    const done = r?.done === true;
    const late = r?.carriedOver === true ? ", carried over and still open" : "";
    add(
      localDateKey(start, zone),
      `- ${clock(start, zone)}: ${r?.title || "Reminder"} (reminder${done ? ", done" : ""}${late})`,
    );
  }

  const dayKeys = [...byDay.keys()].sort();
  const lines = [];

  lines.push("THEIR DAY, FROM AMBER'S OWN RECORDS. You hold this. They asked for it.");
  lines.push(
    connectedCalendars > 0
      ? `Everything below is what they have told you plus ${connectedCalendars} connected calendar account${connectedCalendars === 1 ? "" : "s"}, covering the next ${days} days.`
      : `Everything below is what they have told you, covering the next ${days} days. They have NO calendar account connected to Amber yet. If they expected to see meetings here, connecting one in Settings is what turns that on.`,
  );

  if (dayKeys.length === 0) {
    lines.push("");
    lines.push("Nothing scheduled in that window.");
  } else {
    for (const key of dayKeys) {
      lines.push("");
      lines.push(`${dayHeading(key, today)}:`);
      // Sorted by the printed time, which is the order they read it in.
      lines.push(...byDay.get(key).sort());
    }
  }

  const open = openReminders.filter((r) => r && r.doneToday !== true);
  if (open.length > 0) {
    lines.push("");
    lines.push("OPEN REMINDERS TODAY (no time on them, waiting to be ticked off):");
    for (const r of open) lines.push(`- ${r.title || "Reminder"}`);
  }

  lines.push("");
  lines.push(
    "ANSWER FROM THIS. Name the actual items, their times and the people in them. Naming " +
      "those people is part of answering a question about the day, not bringing up their " +
      "contacts unprompted. Never tell them to go and look in a calendar app: you are the " +
      "one holding this.",
  );
  lines.push(
    "WHAT YOU CANNOT SEE. Calendars that live only on their phone are read on the device and " +
      "never reach you, so a quiet list is not proof of a free day. Say what you can see, and " +
      "do not declare them free.",
  );
  lines.push(
    "Plain sentences, no em-dashes, no headings, no bulleted agenda dump unless they asked " +
      "for the whole week. Lead with what is next.",
  );

  return lines.join("\n");
}
