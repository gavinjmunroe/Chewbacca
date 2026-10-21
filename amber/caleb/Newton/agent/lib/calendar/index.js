/**
 * calendar/index.js — Public surface for the calendar runtime foundation.
 *
 * See docs/CALENDAR-FIRST-SAMBER.md for the doctrine and
 * docs/CALENDAR-RUNTIME-INTEGRATION.md for how this plugs into the iMessage
 * agent loop and the iOS surface.
 */

export {
  classifyCalendarIntent,
  isCalendarIntent,
  CALENDAR_INTENTS,
} from "./intent.js";

export {
  resolveConfirmationPolicy,
  CONFIRMATION_TIERS,
} from "./policy.js";

export {
  getCalendarProvider,
  registerCalendarProvider,
  buildMockCalendarProvider,
  _resetCalendarProviderRegistry,
} from "./provider.js";

export { loadCalendarProfile } from "./profile.js";
export { DIMENSIONS, ROLE_WEIGHTS, DEFAULT_DIMENSION_WEIGHTS, weightSum } from "./roles.js";
export { rankSlots } from "./rank.js";

export {
  maybeHandleCalendarMessage,
  isCalendarRuntimeEnabled,
} from "./runtime.js";
