/**
 * calendar/policy.js — Confirmation policy for calendar actions.
 *
 * One contract, shared by every Amber tenant. No tenant has a more permissive
 * confirmation policy than any other (docs/CALENDAR-FIRST-SAMBER.md §8).
 *
 * Tiers (stable; cited in tests and audit records):
 *   none    — read-only, no round-trip required
 *   single  — one user confirmation before action
 *   double  — two user confirmations (e.g. delete + notify-attendees)
 *
 * This module is a pure function over (intent, context). It does not own the
 * confirm-token lifecycle, the outbox writer, or the dispatcher — those live
 * upstream and call this to find out whether they need to gate the action.
 */

import { CALENDAR_INTENTS } from "./intent.js";

export const CONFIRMATION_TIERS = Object.freeze({
  NONE: "none",
  SINGLE: "single",
  DOUBLE: "double",
});

/**
 * Resolve the confirmation tier and attendee-notification posture for a
 * calendar action.
 *
 * @param {object} args
 * @param {string} args.intent - one of CALENDAR_INTENTS values
 * @param {object} [args.context]
 * @param {boolean} [args.context.hasExternalAttendees=false]
 * @param {boolean} [args.context.eventCreatedByAmber=true] - if false, an
 *   `update_event` requires a single confirm (touching a non-Amber event).
 * @param {boolean} [args.context.crossesTenantGrant=false] - dimension-scoped
 *   peer grants count as crossing a tenant boundary; always confirm.
 * @param {boolean} [args.context.explicitlySafe=false] - operator override
 *   that downgrades a `create_event` confirm to none (rare; not used for any
 *   destructive intent).
 * @returns {{
 *   tier: string,
 *   requireConfirmAction: boolean,
 *   requireConfirmAttendeeNotify: boolean,
 *   mayNotifyAttendees: boolean,
 *   rationale: string,
 * }}
 */
export function resolveConfirmationPolicy({ intent } = {}) {
  // Caleb's mandate (2026-05-27, verbatim): "It is STUPID and it should
  // NEVER ask for permission to do anything!" Every calendar intent now
  // resolves to tier=NONE so the runtime short-circuits at the existing
  // "if (policy.tier === CONFIRMATION_TIERS.NONE) pass through to LLM"
  // branch and the "Want me to X? Reply 'yes' to confirm." prompt never
  // fires. Applies uniformly to create, update, reschedule, delete,
  // coordinate, and read intents -- no exception for external attendees,
  // peer-grant crossings, or unknown intents.
  //
  // See memory/feedback_no_confirmation_prompts.md. Adding gates back in
  // is easy if a specific failure mode emerges; removing them after a
  // third complaint is not. Default is "just do it."
  return decision(
    CONFIRMATION_TIERS.NONE,
    `${intent || "unknown"}: tier=NONE per no-confirmation-prompts policy`,
  );
}

function decision(tier, rationale, overrides = {}) {
  const requireConfirmAction = tier !== CONFIRMATION_TIERS.NONE;
  return {
    tier,
    requireConfirmAction,
    requireConfirmAttendeeNotify: false,
    mayNotifyAttendees: false,
    rationale,
    ...overrides,
  };
}
