/**
 * @togari/core/identity — Deterministic date/time phrase resolver
 *
 * Replaces natural-language date and time phrases in user text with
 * machine-resolved [date: YYYY-MM-DD] / [time: HH:MM] markers BEFORE
 * the LLM parser sees the message. This eliminates LLM date-math
 * hallucination ("next Tuesday" off by one, etc.).
 *
 * All date math is anchored to the requester's timezone via
 * Intl.DateTimeFormat. Server-local Date.getDay() / Date.getDate()
 * are intentionally NOT used — they return UTC values on Railway and
 * silently shift around midnight.
 *
 * Patterns are processed in priority order (longest / most specific
 * first). Each pattern's matches are added to a range list; later
 * patterns skip ranges that overlap an already-resolved match. This
 * prevents "wednesday the 23rd" from being double-resolved as bare
 * "wednesday" + "the 23rd".
 */

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const WEEKDAY_PATTERN = WEEKDAY_NAMES.join('|');

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_PATTERN = MONTH_NAMES.join('|');

const TZ_ABBR_PATTERN = '(?:est|edt|et|cst|cdt|ct|mst|mdt|mt|pst|pdt|pt|gmt|utc)';

/**
 * Period-of-day → wall-clock defaults. Used both by the compound
 * "Monday morning" patterns and (transitively) by the EOD/EOW/BOD
 * shorthand handlers below.
 *
 * The "am" / "pm" entries cover the case where those words appear as
 * standalone period markers (e.g. "Monday AM"). Numeric forms like
 * "3pm" / "11:45 am" are still handled by the existing 5b pattern.
 */
const TIME_OF_DAY_MARKERS: Record<string, { hour: number; minute: number }> = {
  am: { hour: 9, minute: 0 },
  pm: { hour: 13, minute: 0 },
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 13, minute: 0 },
  evening: { hour: 18, minute: 0 },
  tonight: { hour: 20, minute: 0 },
  noon: { hour: 12, minute: 0 },
  midnight: { hour: 0, minute: 0 },
};

const TIME_OF_DAY_WORDS = ['am', 'pm', 'morning', 'afternoon', 'evening', 'tonight'].join('|');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timeMarkerFor(word: string): string {
  const m = TIME_OF_DAY_MARKERS[word.toLowerCase()];
  if (!m) return '';
  return `[time: ${pad(m.hour)}:${pad(m.minute)}]`;
}

/** Current wall-clock hour (0–23) in the given IANA timezone. */
function nowLocalHour(now: Date, timezone: string): number {
  const v = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const n = parseInt(v, 10);
  // Some Node versions return "24" at midnight; normalize.
  if (isNaN(n)) return 0;
  return n === 24 ? 0 : n;
}

function isWeekend(d: Date): boolean {
  const dow = dayOfWeekUTC(d);
  return dow === 0 || dow === 6;
}

/**
 * Last business day of the given month (US-style: Mon-Fri). If the
 * month's final day lands on Sat/Sun, walks back to the prior Friday.
 * `monthIdx` is 0-indexed (Jan = 0) to match Date semantics.
 */
function lastBusinessDayOfMonth(year: number, monthIdx: number): Date {
  // Day 0 of (monthIdx + 1) = last day of monthIdx.
  const last = new Date(Date.UTC(year, monthIdx + 1, 0, 12, 0, 0));
  let d = makeUTCDate(
    last.getUTCFullYear(),
    last.getUTCMonth() + 1,
    last.getUTCDate(),
  );
  while (isWeekend(d)) {
    d = addDays(d, -1);
  }
  return d;
}

function makeUTCDate(year: number, month: number, day: number): Date {
  // Anchor at noon UTC so format / dow operations are immune to
  // timezone offsets — the wall-clock components are what matter.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function getTodayInTz(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
  return makeUTCDate(get('year'), get('month'), get('day'));
}

function dayOfWeekUTC(d: Date): number {
  return d.getUTCDay();
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Soonest occurrence of `targetDow` from `today`. If today is the
 * target day-of-week and `includeToday` is true, returns today.
 */
function nextWeekday(today: Date, targetDow: number, includeToday: boolean): Date {
  const todayDow = dayOfWeekUTC(today);
  let diff = targetDow - todayDow;
  if (diff < 0) diff += 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(today, diff);
}

/**
 * Find the soonest future occurrence of `dayOfMonth` whose weekday
 * matches `targetDow`, walking forward up to 12 months. If no match
 * is found, falls back to the soonest upcoming `dayOfMonth` and
 * flags the weekday mismatch so the caller can warn.
 */
function findWeekdayOnDate(
  today: Date,
  targetDow: number,
  dayOfMonth: number,
): { date: Date; mismatch: boolean } {
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1; // 1-indexed
  if (dayOfMonth < today.getUTCDate()) {
    month++;
    if (month > 12) { month = 1; year++; }
  }
  for (let i = 0; i < 12; i++) {
    const candidate = makeUTCDate(year, month, dayOfMonth);
    // Validate (e.g. Feb 30 rolls over to Mar 2 — reject)
    if (candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === dayOfMonth) {
      if (dayOfWeekUTC(candidate) === targetDow) {
        // Skip if the match is in the past relative to today
        if (candidate.getTime() >= today.getTime()) {
          return { date: candidate, mismatch: false };
        }
      }
    }
    month++;
    if (month > 12) { month = 1; year++; }
  }
  // No weekday match in 12 months — fall back to next valid dayOfMonth
  const fallback = nextDayOfMonth(today, dayOfMonth);
  return { date: fallback ?? today, mismatch: true };
}

/**
 * Soonest upcoming day-of-month: this month's if still in the future,
 * else next month's. Returns null for invalid days (Feb 30 etc).
 */
function nextDayOfMonth(today: Date, dayOfMonth: number): Date | null {
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1;
  if (dayOfMonth <= today.getUTCDate()) {
    month++;
    if (month > 12) { month = 1; year++; }
  }
  for (let i = 0; i < 12; i++) {
    const candidate = makeUTCDate(year, month, dayOfMonth);
    if (candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === dayOfMonth) {
      return candidate;
    }
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return null;
}

/**
 * MONTH + DAY: this year if still future, next year otherwise.
 * Returns null for invalid combos (Feb 30 etc).
 */
function nextMonthDay(today: Date, monthIdx: number, day: number): Date | null {
  let year = today.getUTCFullYear();
  let candidate = makeUTCDate(year, monthIdx + 1, day);
  if (candidate.getUTCMonth() !== monthIdx || candidate.getUTCDate() !== day) {
    return null;
  }
  if (candidate.getTime() < today.getTime()) {
    year++;
    candidate = makeUTCDate(year, monthIdx + 1, day);
    if (candidate.getUTCMonth() !== monthIdx || candidate.getUTCDate() !== day) {
      return null;
    }
  }
  return candidate;
}

interface Range {
  start: number;
  end: number;
  replacement: string;
  original: string;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function resolveDatePhrases(
  text: string,
  timezone: string,
  now: Date = new Date(),
): { rewritten: string; replacements: Array<{ original: string; resolved: string }> } {
  const today = getTodayInTz(now, timezone);
  const ranges: Range[] = [];

  function tryAddMatches(re: RegExp, makeReplacement: (match: RegExpExecArray) => string | null): void {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (ranges.some(r => rangesOverlap(r, { start, end }))) continue;
      const replacement = makeReplacement(m);
      if (replacement) {
        ranges.push({ start, end, replacement, original: m[0] });
      }
    }
  }

  // ── Priority 1a: "next week's WEEKDAY"
  tryAddMatches(
    new RegExp(`\\bnext\\s+week['\u2019]?s\\s+(${WEEKDAY_PATTERN})\\b`, 'gi'),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = addDays(nextWeekday(today, dow, true), 7);
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 1b: "WEEKDAY (of)? next week"
  tryAddMatches(
    new RegExp(`\\b(${WEEKDAY_PATTERN})(?:\\s+of)?\\s+next\\s+week\\b`, 'gi'),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = addDays(nextWeekday(today, dow, true), 7);
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 1c: "WEEKDAY the Nth"
  tryAddMatches(
    new RegExp(`\\b(${WEEKDAY_PATTERN})\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'),
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
      return `[date: ${formatISODate(date)}]`;
    },
  );

  // ── Priority 1d: "(next )? WEEKDAY (AM|PM|morning|afternoon|evening|tonight)"
  // Emits BOTH date + time markers in a single replacement so the LLM
  // sees a fully-resolved point in time without having to invent a
  // default for "morning"/"afternoon"/etc.
  tryAddMatches(
    new RegExp(`\\b(next\\s+)?(${WEEKDAY_PATTERN})\\s+(${TIME_OF_DAY_WORDS})\\b`, 'gi'),
    (m) => {
      const isExplicitNext = !!m[1];
      const dow = WEEKDAY_NAMES.indexOf(m[2].toLowerCase());
      let d: Date;
      if (isExplicitNext) {
        // "next Monday morning" → always 7+ days out.
        d = nextWeekday(today, dow, false);
      } else {
        // Apply the afternoon-rule used by bare WEEKDAY: if today IS the
        // named day and we're already past noon, hop to next week.
        const includeToday = !(dayOfWeekUTC(today) === dow && nowLocalHour(now, timezone) >= 12);
        d = nextWeekday(today, dow, includeToday);
      }
      const time = timeMarkerFor(m[3]);
      return time ? `[date: ${formatISODate(d)}] ${time}` : `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 2a: "(next|this|this coming|coming) WEEKDAY"
  // "next WEEKDAY" → 7+ days out (even when today IS that weekday); the
  // other prefixes preserve the existing soonest-occurrence behaviour.
  tryAddMatches(
    new RegExp(`\\b(next|this\\s+coming|this|coming)\\s+(${WEEKDAY_PATTERN})\\b`, 'gi'),
    (m) => {
      const prefix = m[1].toLowerCase().trim();
      const dow = WEEKDAY_NAMES.indexOf(m[2].toLowerCase());
      const includeToday = prefix !== 'next';
      const d = nextWeekday(today, dow, includeToday);
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 2b: "by WEEKDAY" (treated as deadline; preserve "by")
  tryAddMatches(
    new RegExp(`\\bby\\s+(${WEEKDAY_PATTERN})\\b`, 'gi'),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const d = nextWeekday(today, dow, true);
      return `by [date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 2c: bare WEEKDAY
  // Sales-team convention: if today IS the named day AND we're already
  // past noon in the requester's TZ, the user almost always means *next*
  // week — the current day's slots are mostly gone.
  tryAddMatches(
    new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, 'gi'),
    (m) => {
      const dow = WEEKDAY_NAMES.indexOf(m[1].toLowerCase());
      const localHour = nowLocalHour(now, timezone);
      const includeToday = !(dayOfWeekUTC(today) === dow && localHour >= 12);
      const d = nextWeekday(today, dow, includeToday);
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 3a: MONTH DAY [year]
  tryAddMatches(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, 'gi'),
    (m) => {
      const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
      const day = parseInt(m[2], 10);
      if (day < 1 || day > 31) return null;
      const year = m[3] ? parseInt(m[3], 10) : null;
      let d: Date | null;
      if (year) {
        d = makeUTCDate(year, monthIdx + 1, day);
        if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return null;
      } else {
        d = nextMonthDay(today, monthIdx, day);
      }
      if (!d) return null;
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 3b: DAY[ordinal] MONTH (e.g. "13 may")
  tryAddMatches(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\b`, 'gi'),
    (m) => {
      const day = parseInt(m[1], 10);
      const monthIdx = MONTH_NAMES.indexOf(m[2].toLowerCase());
      if (day < 1 || day > 31) return null;
      const d = nextMonthDay(today, monthIdx, day);
      if (!d) return null;
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 3c: "the Nth" alone
  tryAddMatches(
    /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi,
    (m) => {
      const dayOfMonth = parseInt(m[1], 10);
      if (dayOfMonth < 1 || dayOfMonth > 31) return null;
      const d = nextDayOfMonth(today, dayOfMonth);
      if (!d) return null;
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 3d: EOW / end of week / end of the week → Friday 17:00.
  // On Friday-or-later, hop to next Friday so Saturday/Sunday don't
  // silently mean "yesterday".
  tryAddMatches(
    /\b(?:eow|end\s+of\s+(?:the\s+)?week)\b/gi,
    () => {
      const fridayDow = 5;
      const todayDow = dayOfWeekUTC(today);
      const includeToday = todayDow < fridayDow;
      const d = nextWeekday(today, fridayDow, includeToday);
      return `[date: ${formatISODate(d)}] [time: 17:00]`;
    },
  );

  // ── Priority 3e: EOD / EOB / COB / end of day / close of business
  // → today 17:00, or tomorrow 09:00 if current local hour is already >= 17.
  tryAddMatches(
    /\b(?:eod|eob|cob|end\s+of\s+(?:the\s+)?day|close\s+of\s+business)\b/gi,
    () => {
      const hour = nowLocalHour(now, timezone);
      if (hour < 17) {
        return `[date: ${formatISODate(today)}] [time: 17:00]`;
      }
      return `[date: ${formatISODate(addDays(today, 1))}] [time: 09:00]`;
    },
  );

  // ── Priority 3f: BOD / beginning of day / start of day → 09:00.
  // If already past 9am locally, target tomorrow's 9am.
  tryAddMatches(
    /\b(?:bod|(?:beginning|start)\s+of\s+(?:the\s+)?day)\b/gi,
    () => {
      const hour = nowLocalHour(now, timezone);
      const d = hour < 9 ? today : addDays(today, 1);
      return `[date: ${formatISODate(d)}] [time: 09:00]`;
    },
  );

  // ── Priority 3g: EOM / end of month → last business day of the
  // current month, 17:00. Sat/Sun roll back to the prior Friday.
  tryAddMatches(
    /\b(?:eom|end\s+of\s+(?:the\s+)?month)\b/gi,
    () => {
      const d = lastBusinessDayOfMonth(today.getUTCFullYear(), today.getUTCMonth());
      return `[date: ${formatISODate(d)}] [time: 17:00]`;
    },
  );

  // ── Priority 3h: "(today|tomorrow) (AM|PM|morning|afternoon|evening|tonight)"
  // Compound form that emits both date + time markers in one go. Must
  // run before Priority 4 below so "today" / "tomorrow" aren't claimed
  // by the bare-token handler first.
  tryAddMatches(
    new RegExp(`\\b(today|tomorrow)\\s+(${TIME_OF_DAY_WORDS})\\b`, 'gi'),
    (m) => {
      const word = m[1].toLowerCase();
      const d = word === 'tomorrow' ? addDays(today, 1) : today;
      const time = timeMarkerFor(m[2]);
      return time ? `[date: ${formatISODate(d)}] ${time}` : `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 4: today / tomorrow / yesterday / tonight
  // "tonight" carries an implicit ~8pm time-of-day, so it emits BOTH
  // date and time markers (unlike the other bare day words).
  tryAddMatches(
    /\b(today|tomorrow|yesterday|tonight)\b/gi,
    (m) => {
      const word = m[1].toLowerCase();
      let d: Date;
      switch (word) {
        case 'today':
          d = today; break;
        case 'tonight':
          return `[date: ${formatISODate(today)}] [time: 20:00]`;
        case 'tomorrow':
          d = addDays(today, 1); break;
        case 'yesterday':
          d = addDays(today, -1); break;
        default:
          return null;
      }
      return `[date: ${formatISODate(d)}]`;
    },
  );

  // ── Priority 5a: noon / midnight
  tryAddMatches(
    /\b(noon|midnight)\b/gi,
    (m) => (m[1].toLowerCase() === 'noon' ? '[time: 12:00]' : '[time: 00:00]'),
  );

  // ── Priority 5b: "3pm" / "3:30pm" / "11:45 am" with optional TZ abbr
  tryAddMatches(
    new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)(?:\\s+${TZ_ABBR_PATTERN})?\\b`, 'gi'),
    (m) => {
      let hours = parseInt(m[1], 10);
      const minutes = m[2] ? parseInt(m[2], 10) : 0;
      const meridiem = m[3].toLowerCase();
      if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      return `[time: ${pad(hours)}:${pad(minutes)}]`;
    },
  );

  // ── Priority 5c: 24h "HH:MM" not consumed by 5b
  tryAddMatches(
    /\b(\d{1,2}):(\d{2})\b/g,
    (m) => {
      const hours = parseInt(m[1], 10);
      const minutes = parseInt(m[2], 10);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return `[time: ${pad(hours)}:${pad(minutes)}]`;
    },
  );

  ranges.sort((a, b) => a.start - b.start);

  let rewritten = '';
  let cursor = 0;
  for (const r of ranges) {
    rewritten += text.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  rewritten += text.slice(cursor);

  const replacements = ranges.map(r => ({ original: r.original, resolved: r.replacement }));
  return { rewritten, replacements };
}

// ── Duration phrase resolution ───────────────────────────────────
// Used by the schedule_meeting clarification flow to interpret a
// reply like "30 min", "an hour", or "1.5 hours" without going
// through the LLM. Returns minutes, or null if no phrase matched.
//
// Phrases are checked longest-first so "1 hour 30" is consumed by
// the combined h+m pattern before the bare "1 hour" matcher gets to
// it. Bare integers are accepted as a last-resort minute count, but
// only when they sit alone or alongside the word "min" / "minutes",
// to keep the function safe to call on arbitrary user text.

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, ninety: 90,
};

function wordToNumber(token: string): number | null {
  const t = token.toLowerCase().trim();
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  // "twenty five", "forty five" etc.
  const parts = t.split(/\s+/);
  if (parts.length === 2 && parts[0] in NUMBER_WORDS && parts[1] in NUMBER_WORDS) {
    const a = NUMBER_WORDS[parts[0]];
    const b = NUMBER_WORDS[parts[1]];
    if (a >= 20 && a % 10 === 0 && b >= 1 && b <= 9) return a + b;
  }
  return null;
}

export function resolveDurationPhrase(text: string): number | null {
  if (!text) return null;
  const s = text.toLowerCase().trim();

  // ── Combined hours + minutes ("1h 30m", "1 hour 30 minutes") ──
  let m = s.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)\s*(?:m|min|mins|minute|minutes)?\b/);
  if (m) {
    const h = parseFloat(m[1]);
    const mm = parseInt(m[2], 10);
    if (!Number.isNaN(h) && !Number.isNaN(mm)) return Math.round(h * 60 + mm);
  }

  // ── Half hour / half an hour / a half hour ──
  if (/\b(?:a\s+)?half\s+(?:an?\s+)?hour\b/.test(s)) return 30;
  if (/\bhalf\s+hour\b/.test(s)) return 30;

  // ── Quarter hour ──
  if (/\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b/.test(s)) return 15;

  // ── "an hour" / "a hour" ──
  if (/\ban?\s+hour\b/.test(s)) return 60;

  // ── Numeric hours: "1 hour", "1.5 hours", "2 hrs", "1hr", "2h" ──
  m = s.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (m) {
    const h = parseFloat(m[1]);
    if (!Number.isNaN(h)) return Math.round(h * 60);
  }

  // ── Numeric minutes: "30 min", "45 minutes", "30m" ──
  m = s.match(/\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (m) {
    const mm = parseInt(m[1], 10);
    if (!Number.isNaN(mm)) return mm;
  }

  // ── Word numbers + unit: "thirty min", "ninety minutes", "forty five minutes" ──
  m = s.match(/\b((?:[a-z]+\s+)?[a-z]+)\s+(?:m|min|mins|minute|minutes)\b/);
  if (m) {
    const n = wordToNumber(m[1]);
    if (n !== null) return n;
  }
  // Word hours: "one hour", "two hours"
  m = s.match(/\b([a-z]+)\s+(?:h|hr|hrs|hour|hours)\b/);
  if (m) {
    const n = wordToNumber(m[1]);
    if (n !== null) return n * 60;
  }

  // ── "ninety minutes" → already covered by word+min above; standalone
  //    "ninety" / "thirty" is too ambiguous to accept on its own ──

  // ── Bare number — only when it's the entire trimmed message ──
  //    Treat as minutes. This is the last resort so we don't grab
  //    numeric tokens that belong to another concept (years, counts).
  m = s.match(/^(\d{1,3})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 480) return n;
  }

  return null;
}

// ── Implied-duration keyword detection ───────────────────────────
// Used by schedule_meeting to skip the duration prompt when the user
// said something like "quick call" or "1:1". Returns the implied
// duration in minutes, or null if no keyword matched. Order-of-checks
// matters: "discovery" beats "intro" if both appear, and longer
// multi-word keywords are checked before single words.

const IMPLIED_DURATION_RULES: Array<{ pattern: RegExp; minutes: number }> = [
  // 60-minute defaults
  { pattern: /\bdiscovery\s+call\b/i, minutes: 60 },
  { pattern: /\bdeep\s+dive\b/i, minutes: 60 },
  { pattern: /\bdiscovery\b/i, minutes: 60 },
  { pattern: /\bdemo\b/i, minutes: 60 },
  { pattern: /\bkickoff\b/i, minutes: 60 },
  { pattern: /\breview\b/i, minutes: 60 },
  // 30-minute defaults
  { pattern: /\bone\s+on\s+one\b/i, minutes: 30 },
  { pattern: /\bintro\s+call\b/i, minutes: 30 },
  { pattern: /\bintro\b/i, minutes: 30 },
  { pattern: /\bcoffee\b/i, minutes: 30 },
  { pattern: /\b1:1\b/, minutes: 30 },
  // 15-minute defaults
  { pattern: /\bquick\s+call\b/i, minutes: 15 },
  { pattern: /\bquick\s+chat\b/i, minutes: 15 },
  { pattern: /\bquick\s+sync\b/i, minutes: 15 },
  { pattern: /\bquick\b/i, minutes: 15 },
];

export function resolveImpliedDuration(text: string): number | null {
  if (!text) return null;
  for (const rule of IMPLIED_DURATION_RULES) {
    if (rule.pattern.test(text)) return rule.minutes;
  }
  return null;
}
