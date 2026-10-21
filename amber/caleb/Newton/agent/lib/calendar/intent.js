/**
 * calendar/intent.js — Calendar intent classifier.
 *
 * Maps a natural-language message into one of a fixed set of safe intents,
 * with a destructive-verb tripwire that always fires regardless of any
 * downstream classifier confidence.
 *
 * Shared by every Amber tenant. Camber and Samber call the same classifier;
 * personalization happens later in the slot-ranker, not here.
 *
 * Reference: docs/CALENDAR-FIRST-SAMBER.md §5 and §7.
 *
 * Intents (stable contract — referenced by confirmation policy and adapter):
 *   read_availability   — "am I free Tuesday at 4", "is Caleb free…"
 *   list_events         — "what's on Thursday", "what's next"
 *   create_event        — "add", "schedule", "block"
 *   update_event        — "rename", "change location", "add Caleb"
 *   delete_event        — "cancel", "drop", "remove"
 *   reschedule_event    — "move to 4pm", "push to Friday"
 *   coordinate_scheduling — propose-confirm-create with peer / external
 *   unknown             — fallback; caller decides what to do
 */

/**
 * Canonical intent labels. Exported so callers (confirmation policy,
 * dispatcher, tests) reference the same set of strings.
 */
export const CALENDAR_INTENTS = Object.freeze({
  READ_AVAILABILITY: "read_availability",
  LIST_EVENTS: "list_events",
  CREATE_EVENT: "create_event",
  UPDATE_EVENT: "update_event",
  DELETE_EVENT: "delete_event",
  RESCHEDULE_EVENT: "reschedule_event",
  COORDINATE_SCHEDULING: "coordinate_scheduling",
  UNKNOWN: "unknown",
});

const INTENT_VALUES = new Set(Object.values(CALENDAR_INTENTS));

/**
 * Destructive verbs that must never be classified as read/create.
 * Order matters only insofar as the first match wins for the rationale.
 */
const DESTRUCTIVE_VERBS = [
  "cancel",
  "cancelled",
  "delete",
  "deleted",
  "remove",
  "removed",
  "drop",
  "dropped",
  "scrap",
  "kill",
  "wipe",
  "clear",
];

const RESCHEDULE_VERBS = [
  "move",
  "moved",
  "push",
  "pushed",
  "reschedule",
  "rescheduled",
  "shift",
  "shifted",
  "bump",
  "bumped",
  "postpone",
  "postponed",
];

const UPDATE_VERBS = [
  "rename",
  "edit",
  "change",
  "update",
  "set",
  "rename",
  "add",
  "invite",
  "remove from",
];

const CREATE_VERBS = [
  "add",
  "schedule",
  "block",
  "book",
  "set up",
  "put",
  "create",
  "make",
  "new",
];

const COORDINATE_HINTS = [
  "find time",
  "find a time",
  "find me a time",
  "find an hour",
  "find me an hour",
  "find some time",
  "coordinate",
  "set up with",
  "schedule with",
  "meet with",
  "1:1 with",
  "intro with",
  "sync with",
];

const AVAILABILITY_HINTS = [
  "am i free",
  "are you free",
  "is .* free",
  "free on",
  "free at",
  "free this",
  "free next",
  "availability",
];

const LIST_HINTS = [
  "what's on",
  "whats on",
  "what is on",
  "what do i have",
  "what's my",
  "whats my",
  "what is my next",
  "next meeting",
  "what's next",
  "show me my",
  "list my",
];

const CALENDAR_NOUNS = [
  "calendar",
  "meeting",
  "event",
  "appointment",
  "1:1",
  "11",
  "sync",
  "call",
  "coffee",
  "lunch",
  "dinner",
  "interview",
  "block",
];

const ATTENDEE_PUNCTUATION = /[@<>]/;

function normalize(input) {
  if (input == null) return "";
  return String(input).toLowerCase().trim();
}

function containsAny(text, terms) {
  return terms.some((term) => {
    if (term.includes(".*")) {
      try {
        return new RegExp(`\\b${term}\\b`).test(text);
      } catch {
        return false;
      }
    }
    return text.includes(term);
  });
}

function wordBoundaryAny(text, words) {
  return words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text));
}

function hasCalendarContext(text) {
  if (containsAny(text, CALENDAR_NOUNS)) return true;
  // relative-time anchors imply calendar context even without a noun
  if (/\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    return true;
  }
  if (/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b/.test(text)) return true;
  if (/\bnext (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    return true;
  }
  return false;
}

function detectDestructive(text) {
  for (const verb of DESTRUCTIVE_VERBS) {
    if (wordBoundaryAny(text, [verb])) {
      return verb;
    }
  }
  return null;
}

function detectExternalAttendee(text) {
  if (ATTENDEE_PUNCTUATION.test(text)) return true;
  // bare email: foo@bar.tld
  if (/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(text)) return true;
  return false;
}

/**
 * Classify a message into a calendar intent. Pure function; no I/O.
 *
 * @param {string} message - raw inbound text (already de-noised if available)
 * @param {object} [opts]
 * @param {boolean} [opts.requireCalendarContext=true] - if true, returns
 *   `unknown` for messages with no calendar-shaped noun or time anchor.
 * @returns {{
 *   intent: string,
 *   destructive: boolean,
 *   destructiveTripwire: string|null,
 *   hasExternalAttendee: boolean,
 *   rationale: string,
 * }}
 */
export function classifyCalendarIntent(message, opts = {}) {
  const requireCalendarContext = opts.requireCalendarContext !== false;
  const text = normalize(message);

  if (!text) {
    return {
      intent: CALENDAR_INTENTS.UNKNOWN,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee: false,
      rationale: "empty input",
    };
  }

  const hasContext = hasCalendarContext(text);
  const hasExternalAttendee = detectExternalAttendee(text);
  const destructiveTripwire = detectDestructive(text);

  // Destructive tripwire wins. Even a creative classifier upstream cannot
  // silently route "cancel my 2pm" through a non-destructive intent.
  if (destructiveTripwire) {
    return {
      intent: CALENDAR_INTENTS.DELETE_EVENT,
      destructive: true,
      destructiveTripwire,
      hasExternalAttendee,
      rationale: `destructive verb "${destructiveTripwire}" tripwire`,
    };
  }

  if (requireCalendarContext && !hasContext && !hasExternalAttendee) {
    return {
      intent: CALENDAR_INTENTS.UNKNOWN,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee: false,
      rationale: "no calendar noun or time anchor",
    };
  }

  // Reschedule wins over coordinate when the verb is explicit. "reschedule
  // the 1:1 with Sagar" mutates a known event; it is not a propose-new flow.
  if (wordBoundaryAny(text, RESCHEDULE_VERBS)) {
    return {
      intent: CALENDAR_INTENTS.RESCHEDULE_EVENT,
      destructive: true, // state-mutating
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "reschedule verb",
    };
  }

  // Coordinate beats other non-mutating labels when peers / externals appear.
  if (containsAny(text, COORDINATE_HINTS) || (hasExternalAttendee && hasContext)) {
    return {
      intent: CALENDAR_INTENTS.COORDINATE_SCHEDULING,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "coordinate verb or external attendee with calendar context",
    };
  }

  if (containsAny(text, AVAILABILITY_HINTS)) {
    return {
      intent: CALENDAR_INTENTS.READ_AVAILABILITY,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "availability phrasing",
    };
  }

  if (containsAny(text, LIST_HINTS)) {
    return {
      intent: CALENDAR_INTENTS.LIST_EVENTS,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "list/read phrasing",
    };
  }

  if (wordBoundaryAny(text, CREATE_VERBS)) {
    return {
      intent: CALENDAR_INTENTS.CREATE_EVENT,
      destructive: false,
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "create verb",
    };
  }

  if (wordBoundaryAny(text, UPDATE_VERBS)) {
    return {
      intent: CALENDAR_INTENTS.UPDATE_EVENT,
      destructive: true,
      destructiveTripwire: null,
      hasExternalAttendee,
      rationale: "update verb",
    };
  }

  return {
    intent: CALENDAR_INTENTS.UNKNOWN,
    destructive: false,
    destructiveTripwire: null,
    hasExternalAttendee,
    rationale: "no matching verb or hint",
  };
}

/**
 * Type-guard: is `value` a known intent string?
 */
export function isCalendarIntent(value) {
  return INTENT_VALUES.has(value);
}
