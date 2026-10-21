/**
 * gcal/window.js — Normalize user/LLM-supplied time bounds for list_events.
 *
 * The bug this fixes: Google Calendar treats a naked datetime ("2026-05-28T00:00:00")
 * as UTC. Caleb is in PT, so asking "what's on May 28?" with a naked window
 * resolves to PT May 27 5pm → PT May 28 4:59pm, dropping every PT-evening event.
 *
 * What this module does, by case:
 *   - Date only ("YYYY-MM-DD"): expand to start-of-day or end-of-day in PT.
 *   - Naked datetime ("YYYY-MM-DDTHH:MM[:SS]"): append the PT offset for that date.
 *   - Datetime with Z or explicit offset: pass through unchanged.
 *
 * DST is honored via Intl.DateTimeFormat with timeZone: "America/Los_Angeles".
 * That returns -07:00 in PDT (~Mar-Nov) and -08:00 in PST (~Nov-Mar), so the
 * boundary days resolve correctly without hard-coded month math.
 */

const PT_TIMEZONE = "America/Los_Angeles";

const OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TIMEZONE,
  timeZoneName: "longOffset",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Return the PT UTC offset string ("-07:00" or "-08:00") that applies at
 * the given date / datetime. The input can be:
 *   - a Date object (used directly)
 *   - a YYYY-MM-DD string (treated as noon PT that day, to dodge DST edges)
 *   - a YYYY-MM-DDTHH:MM[:SS] naked datetime (treated as that local PT time)
 *
 * For naked inputs we evaluate the offset against a UTC moment that lands
 * inside the same PT calendar day, so spring-forward / fall-back at 2am PT
 * doesn't bounce us to the wrong offset.
 */
export function getPtOffsetForDate(input) {
  let probe;
  if (input instanceof Date) {
    probe = input;
  } else if (typeof input === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
    if (dateOnly) {
      probe = new Date(`${input}T19:00:00Z`);
    } else {
      const isoZ = input.endsWith("Z")
        ? input
        : input.replace(/([+-]\d{2}:?\d{2})$/, "Z");
      const safe = /T\d{2}:\d{2}(:\d{2})?Z?$/.test(isoZ)
        ? isoZ
        : `${input}T12:00:00Z`;
      probe = new Date(safe);
    }
  } else {
    probe = new Date();
  }

  if (Number.isNaN(probe.getTime())) {
    return "-08:00";
  }

  const parts = OFFSET_FORMATTER.formatToParts(probe);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  if (!tzPart || typeof tzPart.value !== "string") return "-08:00";

  const match = tzPart.value.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (!match) return "-08:00";

  const hours = match[1];
  const minutes = match[2] || "00";
  return `${hours}:${minutes}`;
}

/**
 * Detect whether a datetime string already carries an explicit UTC marker
 * (trailing Z) or numeric offset (+HH:MM, -HHMM, etc.). Naked strings
 * (just "YYYY-MM-DDTHH:MM:SS" with nothing after) return false.
 */
export function hasExplicitOffset(s) {
  if (typeof s !== "string") return false;
  return /([Zz]|[+-]\d{2}:?\d{2})$/.test(s.trim());
}

/**
 * Normalize a single time-window bound for Google Calendar's list endpoint.
 *
 * @param {string} value  Raw input from the LLM tool call.
 * @param {"min"|"max"} kind  Which end of the window this is — controls how
 *                            date-only inputs expand (start vs end of day).
 * @returns {string}      ISO 8601 string with explicit offset, ready to send
 *                        to Google Calendar.
 *
 * Behavior:
 *   - undefined / "" → caller falls back to its own default (don't second-guess).
 *   - "YYYY-MM-DD" (date only):
 *       min → "YYYY-MM-DDT00:00:00<pt-offset>"
 *       max → "YYYY-MM-DDT23:59:59<pt-offset>"
 *   - "YYYY-MM-DDTHH:MM[:SS]" (naked datetime, no offset):
 *       append the PT offset for that PT calendar day.
 *   - Anything with Z or an explicit offset: returned unchanged (the LLM
 *     intentionally specified a non-PT zone, respect it).
 */
export function normalizeWindowBound(value, kind) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  if (hasExplicitOffset(trimmed)) return trimmed;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (dateOnly) {
    const offset = getPtOffsetForDate(trimmed);
    const time = kind === "max" ? "23:59:59" : "00:00:00";
    return `${trimmed}T${time}${offset}`;
  }

  const nakedDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(
    trimmed,
  );
  if (nakedDatetime) {
    const offset = getPtOffsetForDate(trimmed);
    return `${trimmed}${offset}`;
  }

  return trimmed;
}
