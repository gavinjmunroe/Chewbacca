/**
 * checkin-schedule.js — pure helpers for per-tenant check-in scheduling.
 *
 * Schedule shape (stored on tenant.checkInSchedule, set via medha-id metadata):
 *
 *   {
 *     enabled: true,                          // master switch (default OFF on tenant)
 *     timezone: "America/Los_Angeles",        // IANA TZ; all window times resolve here
 *     wakeAlarmTime: "07:00",                 // HH:MM 24-hour, tenant local
 *     morning: { enabled, offsetMinutes, dimensions: [..] },
 *     nightly: { enabled, anchor: "wake_alarm", offsetMinutes, dimensions: [..] },
 *     sunday:  { enabled, time: "HH:MM",    dimensions: [..] },
 *     context: ["environment", "people"],     // what the agent may reason about in follow-ups
 *     format: "plain_text",                   // stage 1; "tapback" reserved for stage 2
 *   }
 *
 * morning.offsetMinutes is added to wakeAlarmTime (e.g. 5 = 5 min after wake).
 * nightly.offsetMinutes is added to the anchor (e.g. -485 = 8h05 before wake).
 * sunday.time is absolute local time and only fires on Sundays.
 *
 * All exports are pure — no I/O, no transport. The scheduler in checkins.js
 * does the side-effecting work.
 */

const DEFAULT_TZ = "America/Los_Angeles";

const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return 0;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + mm;
}

function wrapMinutes(min) {
  return ((min % 1440) + 1440) % 1440;
}

/**
 * Decompose an absolute Date into the wall-clock parts in a given timezone.
 * Returns { year, month, day, hour, minute, dayOfWeek (0=Sun..6=Sat), dateKey }.
 */
export function localPartsAt(date, timezone = DEFAULT_TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = parseInt(parts.hour, 10) % 24; // Intl can render "24" at midnight on some engines
  const minute = parseInt(parts.minute, 10);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
    dayOfWeek: WEEKDAYS[parts.weekday] ?? 0,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Compute the target minute-of-day in tenant local time for a window.
 * Returns null if the window is disabled or unknown.
 */
export function targetMinutesForWindow(windowName, schedule) {
  if (!schedule) return null;
  const wakeMin = parseHHMM(schedule.wakeAlarmTime || "07:00");

  if (windowName === "morning") {
    const w = schedule.morning;
    if (!w?.enabled) return null;
    return wrapMinutes(wakeMin + (w.offsetMinutes ?? 0));
  }
  if (windowName === "nightly") {
    const w = schedule.nightly;
    if (!w?.enabled) return null;
    const anchor = w.anchor === "wake_alarm" ? wakeMin : 0;
    return wrapMinutes(anchor + (w.offsetMinutes ?? 0));
  }
  if (windowName === "sunday") {
    const w = schedule.sunday;
    if (!w?.enabled) return null;
    return wrapMinutes(parseHHMM(w.time || "07:00"));
  }
  return null;
}

/**
 * Is `now` inside this window's fire interval [target, target + windowMin)
 * measured in tenant local time?
 *
 * sunday only returns true on Sundays in tenant local time.
 */
export function shouldFireNow(
  windowName,
  schedule,
  now = new Date(),
  windowMin = 5,
) {
  if (!schedule?.enabled) return false;
  const target = targetMinutesForWindow(windowName, schedule);
  if (target == null) return false;
  const local = localPartsAt(now, schedule.timezone || DEFAULT_TZ);
  if (windowName === "sunday" && local.dayOfWeek !== 0) return false;
  const nowMin = local.hour * 60 + local.minute;
  return nowMin >= target && nowMin < target + windowMin;
}

/**
 * Resolve a given local Y-M-D + minute-of-day into an absolute Date in `tz`.
 * Iteratively corrects for the timezone offset (handles DST transitions).
 */
function absoluteForLocalDay(year, month, day, minutes, tz) {
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, min, 0));
  const localAtGuess = localPartsAt(guess, tz);

  const desiredDateNum = year * 10000 + month * 100 + day;
  const actualDateNum =
    parseInt(localAtGuess.year, 10) * 10000 +
    parseInt(localAtGuess.month, 10) * 100 +
    parseInt(localAtGuess.day, 10);
  const desiredMin = hour * 60 + min;
  const actualMin = localAtGuess.hour * 60 + localAtGuess.minute;

  let diff = desiredMin - actualMin;
  if (actualDateNum > desiredDateNum) diff -= 1440;
  else if (actualDateNum < desiredDateNum) diff += 1440;

  let result = new Date(guess.getTime() + diff * 60_000);

  // One more pass for DST gaps (spring-forward) where the guess lands in a
  // non-existent local hour.
  const final = localPartsAt(result, tz);
  const finalMin = final.hour * 60 + final.minute;
  if (finalMin !== desiredMin) {
    result = new Date(result.getTime() + (desiredMin - finalMin) * 60_000);
  }
  return result;
}

/**
 * Next absolute fire time for a window at or after `now`. Returns null if
 * the window is disabled. Used for diagnostics; the scheduler tick uses
 * shouldFireNow instead.
 */
export function nextFireTimeForWindow(windowName, schedule, now = new Date()) {
  if (!schedule?.enabled) return null;
  const target = targetMinutesForWindow(windowName, schedule);
  if (target == null) return null;
  const tz = schedule.timezone || DEFAULT_TZ;

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const local = localPartsAt(probe, tz);
    if (windowName === "sunday" && local.dayOfWeek !== 0) continue;
    const candidate = absoluteForLocalDay(
      parseInt(local.year, 10),
      parseInt(local.month, 10),
      parseInt(local.day, 10),
      target,
      tz,
    );
    if (candidate > now) return candidate;
  }
  return null;
}

/**
 * Sagar's default schedule: morning emotional 5 min after wake, nightly
 * physical 8h05 before wake (= 22:55 if wake=07:00), Sunday spiritual at
 * 07:00 local. Context limited to environment + people.
 */
export function defaultSagarSchedule(wakeAlarmTime = "07:00") {
  return {
    enabled: true,
    timezone: "America/Los_Angeles",
    wakeAlarmTime,
    morning: { enabled: true, offsetMinutes: 5, dimensions: ["emotional"] },
    nightly: {
      enabled: true,
      anchor: "wake_alarm",
      offsetMinutes: -485,
      dimensions: ["physical"],
    },
    sunday: { enabled: true, time: "07:00", dimensions: ["spiritual"] },
    context: ["environment", "people"],
    format: "plain_text",
  };
}

/**
 * Pull the schedule off a tenant, or null if none configured.
 */
export function resolveSchedule(tenant) {
  const s = tenant?.checkInSchedule;
  if (!s || typeof s !== "object") return null;
  return s;
}
