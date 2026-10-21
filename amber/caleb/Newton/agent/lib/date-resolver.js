/**
 * Deterministic date/time phrase resolver — Medha port of Togari's
 * core/identity/date-resolver + the nowInTimezone/resolveDay/parseDateTime
 * helpers from core/tools/calendar-ops.
 *
 * Replaces natural-language date/time phrases in user text with
 * machine-resolved `[date: YYYY-MM-DD]` / `[time: HH:MM]` markers BEFORE
 * the LLM sees the message. This eliminates the silent drift you get when
 * Claude does its own date math against a UTC server clock for a PT user.
 *
 * All math is anchored to the requester's IANA timezone via
 * Intl.DateTimeFormat. Server-local Date.getDay()/Date.getDate() are
 * intentionally NOT used — they return UTC values on Railway and shift
 * around midnight in the user's tz.
 *
 * Patterns are processed in priority order (longest / most specific
 * first). Each pattern's matches are added to a range list; later
 * patterns skip ranges that overlap an already-resolved match. That
 * prevents "wednesday the 23rd" from being double-resolved as bare
 * "wednesday" + "the 23rd".
 *
 * ──────────────────────────────────────────────────────────────────
 * INTEGRATION CALL SITE — DEFERRED
 *
 * Call `injectResolvedMarkers(text, tenant.timezone || 'America/New_York')`
 * on the inbound user text BEFORE building the LLM system prompt, so the
 * resolved markers are what Claude reasons about. Wire-up will happen in
 * a follow-up PR by Caleb to keep this PR's risk surface small (agent.js
 * was touched recently and is the highest-regression file in the repo).
 * Until wired in, these helpers are inert — no behavior change.
 * ──────────────────────────────────────────────────────────────────
 */

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY_PATTERN = WEEKDAY_NAMES.join("|");

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN = MONTH_NAMES.join("|");

const TZ_ABBR_PATTERN =
  "(?:est|edt|et|cst|cdt|ct|mst|mdt|mt|pst|pdt|pt|gmt|utc)";

const SHORT_WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const DEFAULT_TIMEZONE = "America/New_York";

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Anchor at noon UTC so format / dow operations are immune to timezone
 * offsets — the wall-clock components are what matter downstream.
 */
function makeUTCDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatISODate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function getTodayUTCAnchoredFor(tz, now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) =>
    parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return makeUTCDate(get("year"), get("month"), get("day"));
}

function dayOfWeekUTC(d) {
  return d.getUTCDay();
}

function addDays(d, days) {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Soonest occurrence of targetDow from today. If today is the target
 * weekday and includeToday is true, returns today.
 */
function nextWeekday(today, targetDow, includeToday) {
  const todayDow = dayOfWeekUTC(today);
  let diff = targetDow - todayDow;
  if (diff < 0) diff += 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(today, diff);
}

/**
 * Find the soonest future occurrence of dayOfMonth whose weekday
 * matches targetDow, walking forward up to 12 months. Falls back to
 * the soonest upcoming dayOfMonth when no match exists.
 */
function findWeekdayOnDate(today, targetDow, dayOfMonth) {
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1; // 1-indexed
  if (dayOfMonth < today.getUTCDate()) {
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  for (let i = 0; i < 12; i++) {
    const candidate = makeUTCDate(year, month, dayOfMonth);
    if (
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === dayOfMonth
    ) {
      if (dayOfWeekUTC(candidate) === targetDow) {
        if (candidate.getTime() >= today.getTime()) {
          return { date: candidate, mismatch: false };
        }
      }
    }
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  const fallback = nextDayOfMonth(today, dayOfMonth);
  return { date: fallback ?? today, mismatch: true };
}

/**
 * Soonest upcoming day-of-month: this month's if still future, else
 * next month's. Returns null for invalid days (Feb 30, etc).
 */
function nextDayOfMonth(today, dayOfMonth) {
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1;
  if (dayOfMonth <= today.getUTCDate()) {
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  for (let i = 0; i < 12; i++) {
    const candidate = makeUTCDate(year, month, dayOfMonth);
    if (
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === dayOfMonth
    ) {
      return candidate;
    }
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return null;
}

/**
 * MONTH + DAY: this year if still future, next year otherwise.
 * Returns null for invalid combos (Feb 30, etc).
 */
function nextMonthDay(today, monthIdx, day) {
  let year = today.getUTCFullYear();
  let candidate = makeUTCDate(year, monthIdx + 1, day);
  if (candidate.getUTCMonth() !== monthIdx || candidate.getUTCDate() !== day) {
    return null;
  }
  if (candidate.getTime() < today.getTime()) {
    year++;
    candidate = makeUTCDate(year, monthIdx + 1, day);
    if (
      candidate.getUTCMonth() !== monthIdx ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
  }
  return candidate;
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

// ── Public helpers ─────────────────────────────────────────────────

/**
 * Wall-clock components in the given IANA timezone, plus an ISO string
 * representation of the same instant. Use this instead of Date.getXxx()
 * anywhere day-of-week or hour-of-day math depends on the user's
 * timezone (which on Railway is never the server's UTC).
 *
 * @param {string} tz — IANA timezone like "America/Los_Angeles"
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,weekday:number,isoString:string}}
 *   weekday is 0=Sun..6=Sat. month is 1-indexed (matches human reading).
 *   isoString is the UTC-anchored instant for the "today at midnight in tz"
 *   date (useful for downstream serialization that doesn't care about time).
 */
export function nowInTimezone(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  // Intl returns "24" for midnight under hour12:false in some locales —
  // normalize to 0 so downstream arithmetic isn't surprised.
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  const minute = parseInt(get("minute"), 10);
  const weekday = SHORT_WEEKDAY_TO_INDEX[get("weekday")] ?? 0;
  const anchored = makeUTCDate(year, month, day);
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    isoString: anchored.toISOString(),
  };
}

/**
 * Resolve a day-only phrase against the user's timezone. Handles:
 *   "today", "tomorrow", "yesterday"
 *   "<weekday>", "this <weekday>", "next <weekday>"
 *   "in N days", "N days from now", "N weeks from now"
 *   "<month> <day>", "<day> of <month>", "<day>/<month>[/<year>]"
 *   "<weekday> the <ordinal>"
 *
 * @param {string} phrase
 * @param {string} tz
 * @param {Date} [now]
 * @returns {{year:number,month:number,day:number} | null}
 *   month is 1-indexed. null when nothing matched.
 */
export function resolveDay(phrase, tz, now = new Date()) {
  if (!phrase || typeof phrase !== "string") return null;
  const timezone = tz || DEFAULT_TIMEZONE;
  const today = getTodayUTCAnchoredFor(timezone, now);
  const lower = phrase.toLowerCase().trim();

  const toParts = (d) => ({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });

  // today / tomorrow / yesterday / tonight
  if (/^(today|tonight)$/.test(lower)) return toParts(today);
  if (/^tomorrow$/.test(lower)) return toParts(addDays(today, 1));
  if (/^yesterday$/.test(lower)) return toParts(addDays(today, -1));

  // "in N days" / "N days from now"
  const inDaysMatch =
    lower.match(/^in\s+(\d{1,3})\s+days?$/) ||
    lower.match(/^(\d{1,3})\s+days?\s+from\s+now$/);
  if (inDaysMatch) {
    const n = parseInt(inDaysMatch[1], 10);
    if (n >= 0 && n <= 365) return toParts(addDays(today, n));
  }

  // "N weeks from now"
  const inWeeksMatch =
    lower.match(/^in\s+(\d{1,2})\s+weeks?$/) ||
    lower.match(/^(\d{1,2})\s+weeks?\s+from\s+now$/);
  if (inWeeksMatch) {
    const n = parseInt(inWeeksMatch[1], 10);
    if (n >= 0 && n <= 52) return toParts(addDays(today, n * 7));
  }

  // "next week's WEEKDAY"
  let m = lower.match(
    new RegExp(`^next\\s+week['’]?s\\s+(${WEEKDAY_PATTERN})$`),
  );
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    return toParts(addDays(nextWeekday(today, dow, true), 7));
  }

  // "WEEKDAY (of)? next week"
  m = lower.match(
    new RegExp(`^(${WEEKDAY_PATTERN})(?:\\s+of)?\\s+next\\s+week$`),
  );
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    return toParts(addDays(nextWeekday(today, dow, true), 7));
  }

  // "WEEKDAY the Nth"
  m = lower.match(
    new RegExp(`^(${WEEKDAY_PATTERN})\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?$`),
  );
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    const dayOfMonth = parseInt(m[2], 10);
    if (dayOfMonth >= 1 && dayOfMonth <= 31) {
      const { date } = findWeekdayOnDate(today, dow, dayOfMonth);
      return toParts(date);
    }
  }

  // "next WEEKDAY" — explicitly the FOLLOWING week's occurrence.
  // On Tuesday, "next wednesday" means Wed +9 days, not tomorrow.
  // This mirrors core/tools/calendar-ops.ts resolveDay semantics.
  m = lower.match(new RegExp(`^next\\s+(${WEEKDAY_PATTERN})$`));
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    return toParts(addDays(nextWeekday(today, dow, true), 7));
  }

  // "(this|this coming|coming) WEEKDAY" — soonest upcoming, including today
  m = lower.match(
    new RegExp(`^(?:this\\s+coming|this|coming)\\s+(${WEEKDAY_PATTERN})$`),
  );
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    return toParts(nextWeekday(today, dow, true));
  }

  // bare WEEKDAY
  m = lower.match(new RegExp(`^(${WEEKDAY_PATTERN})$`));
  if (m) {
    const dow = WEEKDAY_NAMES.indexOf(m[1]);
    return toParts(nextWeekday(today, dow, true));
  }

  // MONTH DAY [year]
  m = lower.match(
    new RegExp(
      `^(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?$`,
    ),
  );
  if (m) {
    const monthIdx = MONTH_NAMES.indexOf(m[1]);
    const day = parseInt(m[2], 10);
    if (day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3], 10) : null;
      let d = null;
      if (year) {
        d = makeUTCDate(year, monthIdx + 1, day);
        if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) d = null;
      } else {
        d = nextMonthDay(today, monthIdx, day);
      }
      if (d) return toParts(d);
    }
  }

  // "DAY of MONTH"
  m = lower.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(${MONTH_PATTERN})$`),
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIdx = MONTH_NAMES.indexOf(m[2]);
    if (day >= 1 && day <= 31) {
      const d = nextMonthDay(today, monthIdx, day);
      if (d) return toParts(d);
    }
  }

  // "DAY MONTH" e.g. "13 may"
  m = lower.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})$`),
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIdx = MONTH_NAMES.indexOf(m[2]);
    if (day >= 1 && day <= 31) {
      const d = nextMonthDay(today, monthIdx, day);
      if (d) return toParts(d);
    }
  }

  // "D/M" or "D/M/YYYY" (day-first reading to match the spec)
  m = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIdx = parseInt(m[2], 10) - 1;
    const year = m[3] ? parseInt(m[3], 10) : null;
    if (day >= 1 && day <= 31 && monthIdx >= 0 && monthIdx <= 11) {
      let d = null;
      if (year) {
        d = makeUTCDate(year, monthIdx + 1, day);
        if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) d = null;
      } else {
        d = nextMonthDay(today, monthIdx, day);
      }
      if (d) return toParts(d);
    }
  }

  return null;
}

/**
 * Parse a time-only phrase. Handles:
 *   "3pm", "3:30 pm", "11am"
 *   "15:00" (24h)
 *   "noon", "midnight"
 *   "morning"=9am, "afternoon"=2pm, "evening"=7pm, "night"=9pm
 *
 * @param {string} phrase
 * @param {string} [_tz] — unused; accepted for symmetry with resolveDay
 * @returns {{hour:number,minute:number} | null}
 */
export function parseTime(phrase, _tz) {
  if (!phrase || typeof phrase !== "string") return null;
  const lower = phrase.toLowerCase().trim();

  if (lower === "noon") return { hour: 12, minute: 0 };
  if (lower === "midnight") return { hour: 0, minute: 0 };
  if (lower === "morning") return { hour: 9, minute: 0 };
  if (lower === "afternoon") return { hour: 14, minute: 0 };
  if (lower === "evening") return { hour: 19, minute: 0 };
  if (lower === "night") return { hour: 21, minute: 0 };

  // "3pm" / "3:30pm" / "11:45 am" with optional TZ abbreviation
  let m = lower.match(
    new RegExp(
      `^(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)(?:\\s+${TZ_ABBR_PATTERN})?$`,
    ),
  );
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }

  // 24h "HH:MM"
  m = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

/**
 * Resolve a combined date+time phrase like "tomorrow at 3pm" or
 * "next wednesday 10:30". Returns null if either side fails to resolve.
 *
 * @param {string} phrase
 * @param {string} tz
 * @param {Date} [now]
 * @returns {{date:{year:number,month:number,day:number},time:{hour:number,minute:number},iso:string} | null}
 *   iso is a UTC-anchored ISO string for the wall-clock components in
 *   tz. The wall-clock components are what matter to downstream callers
 *   (Google Calendar pairs them with `timeZone: tz`); the underlying
 *   instant is only meaningful as a stable serialization.
 */
export function parseDateTime(phrase, tz, now = new Date()) {
  if (!phrase || typeof phrase !== "string") return null;
  const timezone = tz || DEFAULT_TIMEZONE;

  // Split on " at " when present, else split on the first whitespace
  // boundary that doesn't break a multi-word date phrase. Easiest robust
  // approach: try every split position from longest date-prefix down.
  const lower = phrase.toLowerCase().trim();

  // First try whole-phrase as date-only or time-only (rare but cheap).
  const wholeAsDate = resolveDay(lower, timezone, now);
  if (wholeAsDate) {
    return null; // No time component — caller must require both
  }
  const wholeAsTime = parseTime(lower, timezone);
  if (wholeAsTime) {
    return null; // No date component — caller must require both
  }

  // "DATE at TIME"
  const atSplit = lower.split(/\s+at\s+/);
  if (atSplit.length === 2) {
    const date = resolveDay(atSplit[0].trim(), timezone, now);
    const time = parseTime(atSplit[1].trim(), timezone);
    if (date && time) {
      const iso = makeUTCDate(date.year, date.month, date.day);
      iso.setUTCHours(time.hour, time.minute, 0, 0);
      return { date, time, iso: iso.toISOString() };
    }
  }

  // "DATE TIME" — walk the split point from the right so longer date
  // phrases like "next wednesday" beat bare "wednesday".
  const tokens = lower.split(/\s+/);
  for (let i = tokens.length - 1; i >= 1; i--) {
    const datePart = tokens.slice(0, i).join(" ");
    const timePart = tokens.slice(i).join(" ");
    const date = resolveDay(datePart, timezone, now);
    const time = parseTime(timePart, timezone);
    if (date && time) {
      const iso = makeUTCDate(date.year, date.month, date.day);
      iso.setUTCHours(time.hour, time.minute, 0, 0);
      return { date, time, iso: iso.toISOString() };
    }
  }

  return null;
}

/**
 * Scan free text and inject `[date: YYYY-MM-DD] [time: HH:MM TZ]`
 * markers inline next to every date/time phrase the resolver
 * recognizes. The original phrase is preserved; markers are appended
 * so the LLM still sees the user's words AND the canonical answer.
 *
 * Patterns are tried longest/most-specific first so "wednesday the
 * 23rd" doesn't get double-resolved as bare "wednesday" + "the 23rd".
 *
 * @param {string} text
 * @param {string} tz — IANA timezone for the user
 * @param {Date} [now]
 * @returns {string} the text with markers injected. When `text` is
 *   empty/null/undefined, returns it unchanged.
 */
export function injectResolvedMarkers(text, tz, now = new Date()) {
  if (!text || typeof text !== "string") return text;
  const timezone = tz || DEFAULT_TIMEZONE;
  const today = getTodayUTCAnchoredFor(timezone, now);

  /** @type {Array<{start:number,end:number,replacement:string,original:string}>} */
  const ranges = [];

  function tryAddMatches(re, makeReplacement) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (ranges.some((r) => rangesOverlap(r, { start, end }))) continue;
      const replacement = makeReplacement(m);
      if (replacement) {
        ranges.push({ start, end, replacement, original: m[0] });
      }
    }
  }

  // Priority 1a: "next week's WEEKDAY"
  tryAddMatches(
    new RegExp(`\\bnext\\s+week['’]?s\\s+(${WEEKDAY_PATTERN})\\b`, "gi"),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = addDays(nextWeekday(today, dow, true), 7);
      return `${m[0]} [date: ${formatISODate(d)}]`;
    },
  );

  // Priority 1b: "WEEKDAY (of)? next week"
  tryAddMatches(
    new RegExp(`\\b(${WEEKDAY_PATTERN})(?:\\s+of)?\\s+next\\s+week\\b`, "gi"),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = addDays(nextWeekday(today, dow, true), 7);
      return `${m[0]} [date: ${formatISODate(d)}]`;
    },
  );

  // Priority 1c: "WEEKDAY the Nth"
  tryAddMatches(
    new RegExp(
      `\\b(${WEEKDAY_PATTERN})\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
      "gi",
    ),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const dayOfMonth = parseInt(m[2], 10);
      if (dayOfMonth < 1 || dayOfMonth > 31) return null;
      const { date, mismatch } = findWeekdayOnDate(today, dow, dayOfMonth);
      if (mismatch) {
        console.warn(
          `[date-resolver] "${m[0]}" — no ${m[1]} on the ${dayOfMonth} found within 12 months; using closest upcoming date`,
        );
      }
      return `${m[0]} [date: ${formatISODate(date)}]`;
    },
  );

  // Priority 2a: "next WEEKDAY" — the FOLLOWING week's occurrence.
  // Mirrors core/tools/calendar-ops.ts resolveDay semantics: on a
  // Tuesday, "next wednesday" is Wed+9, not tomorrow.
  tryAddMatches(new RegExp(`\\bnext\\s+(${WEEKDAY_PATTERN})\\b`, "gi"), (m) => {
    const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
    const d = addDays(nextWeekday(today, dow, true), 7);
    return `${m[0]} [date: ${formatISODate(d)}]`;
  });

  // Priority 2a': "(this|this coming|coming) WEEKDAY" — soonest upcoming
  tryAddMatches(
    new RegExp(
      `\\b(?:this\\s+coming|this|coming)\\s+(${WEEKDAY_PATTERN})\\b`,
      "gi",
    ),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = nextWeekday(today, dow, true);
      return `${m[0]} [date: ${formatISODate(d)}]`;
    },
  );

  // Priority 2b: "by WEEKDAY" (treated as deadline; preserve "by")
  tryAddMatches(new RegExp(`\\bby\\s+(${WEEKDAY_PATTERN})\\b`, "gi"), (m) => {
    const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
    const d = nextWeekday(today, dow, true);
    return `${m[0]} [date: ${formatISODate(d)}]`;
  });

  // Priority 2c: bare WEEKDAY
  tryAddMatches(new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, "gi"), (m) => {
    const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
    const d = nextWeekday(today, dow, true);
    return `${m[0]} [date: ${formatISODate(d)}]`;
  });

  // Priority 3a: MONTH DAY [year]
  tryAddMatches(
    new RegExp(
      `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
      "gi",
    ),
    (m) => {
      const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
      const day = parseInt(m[2], 10);
      if (day < 1 || day > 31) return null;
      const year = m[3] ? parseInt(m[3], 10) : null;
      let d;
      if (year) {
        d = makeUTCDate(year, monthIdx + 1, day);
        if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return null;
      } else {
        d = nextMonthDay(today, monthIdx, day);
      }
      if (!d) return null;
      return `${m[0]} [date: ${formatISODate(d)}]`;
    },
  );

  // Priority 3b: DAY[ordinal] MONTH (e.g. "13 may")
  tryAddMatches(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\b`, "gi"),
    (m) => {
      const day = parseInt(m[1], 10);
      const monthIdx = MONTH_NAMES.indexOf(m[2].toLowerCase());
      if (day < 1 || day > 31) return null;
      const d = nextMonthDay(today, monthIdx, day);
      if (!d) return null;
      return `${m[0]} [date: ${formatISODate(d)}]`;
    },
  );

  // Priority 3c: "the Nth" alone
  tryAddMatches(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (m) => {
    const dayOfMonth = parseInt(m[1], 10);
    if (dayOfMonth < 1 || dayOfMonth > 31) return null;
    const d = nextDayOfMonth(today, dayOfMonth);
    if (!d) return null;
    return `${m[0]} [date: ${formatISODate(d)}]`;
  });

  // Priority 4: today / tomorrow / yesterday / tonight
  tryAddMatches(/\b(today|tomorrow|yesterday|tonight)\b/gi, (m) => {
    const word = m[1].toLowerCase();
    let d;
    switch (word) {
      case "today":
      case "tonight":
        d = today;
        break;
      case "tomorrow":
        d = addDays(today, 1);
        break;
      case "yesterday":
        d = addDays(today, -1);
        break;
      default:
        return null;
    }
    return `${m[0]} [date: ${formatISODate(d)}]`;
  });

  // Priority 5a: noon / midnight
  tryAddMatches(/\b(noon|midnight)\b/gi, (m) =>
    m[1].toLowerCase() === "noon"
      ? `${m[0]} [time: 12:00 ${timezone}]`
      : `${m[0]} [time: 00:00 ${timezone}]`,
  );

  // Priority 5b: "3pm" / "3:30pm" / "11:45 am" with optional TZ abbr
  tryAddMatches(
    new RegExp(
      `\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)(?:\\s+${TZ_ABBR_PATTERN})?\\b`,
      "gi",
    ),
    (m) => {
      let hours = parseInt(m[1], 10);
      const minutes = m[2] ? parseInt(m[2], 10) : 0;
      const meridiem = m[3].toLowerCase();
      if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
      return `${m[0]} [time: ${pad(hours)}:${pad(minutes)} ${timezone}]`;
    },
  );

  // Priority 5c: 24h "HH:MM" not consumed by 5b
  tryAddMatches(/\b(\d{1,2}):(\d{2})\b/g, (m) => {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${m[0]} [time: ${pad(hours)}:${pad(minutes)} ${timezone}]`;
  });

  ranges.sort((a, b) => a.start - b.start);

  let rewritten = "";
  let cursor = 0;
  for (const r of ranges) {
    rewritten += text.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  rewritten += text.slice(cursor);
  return rewritten;
}
