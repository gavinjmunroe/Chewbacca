/**
 * calendar/runtime.js — iMessage pre-pass for the calendar runtime.
 *
 * This is the glue between the inbound iMessage handler in `agent.js` and
 * the calendar foundation modules (intent.js, policy.js, profile.js,
 * provider.js). It is intentionally a pure-ish coordinator: it does not
 * own conversation state, it does not talk to Loop directly, and it does
 * not edit the agent's tool loop. Callers pass in `sendMessage` and the
 * runtime returns a `handled` flag the caller can use to short-circuit
 * the normal AI path.
 *
 * Behavior:
 *
 *   - Disabled by default. When `AMBER_CALENDAR_RUNTIME_ENABLED` is not
 *     truthy and the tenant has no per-tenant override, returns
 *     `{ handled: false }` so the existing AI loop runs unchanged.
 *
 *   - When enabled: classify the inbound text. If the intent is `unknown`
 *     or low-confidence (no calendar context), return `{ handled: false }`
 *     and let the AI loop run.
 *
 *   - For read intents (`read_availability`, `list_events`): return a
 *     concise natural-language reply via the provider seam. Today the
 *     reply is a small stub built from `provider.listEvents` because the
 *     time-expression resolver and rendering polish are explicit
 *     follow-ups per docs/CALENDAR-FIRST-SAMBER.md §13.
 *
 *   - For create / update / delete / reschedule / coordinate intents:
 *     reply with a confirmation prompt that names the policy tier and
 *     does NOT execute the destructive or attendee-notifying action. The
 *     confirmation continuation lives in a follow-up PR (see
 *     docs/CALENDAR-RUNTIME-INTEGRATION.md §"What this PR does NOT do").
 *
 * Camber (hiring) and Samber (selling) flow through the same code path —
 * the profile pulled from `loadCalendarProfile(tenant)` is the only thing
 * that differs between them.
 */

import { classifyCalendarIntent, CALENDAR_INTENTS } from "./intent.js";
import { resolveConfirmationPolicy, CONFIRMATION_TIERS } from "./policy.js";
import { loadCalendarProfile } from "./profile.js";
import { getCalendarProvider } from "./provider.js";
import { humanize } from "../voice-guard.js";

/**
 * Truthy: "1", "true", "on", "yes" (case-insensitive). Anything else is
 * disabled. Keeps the flag check identical to how the existing
 * `Newton/agent/lib/constants.js` reads booleans, so operators don't need
 * to learn a new convention.
 */
function envFlagOn(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Decide whether the calendar runtime pre-pass should run for this
 * tenant + this message. Precedence:
 *   1. tenant.preferences.calendar.runtimeEnabled (boolean)
 *   2. process.env.AMBER_CALENDAR_RUNTIME_ENABLED
 *   3. default OFF
 */
export function isCalendarRuntimeEnabled(tenant, env = process.env) {
  const pref = tenant?.preferences?.calendar?.runtimeEnabled;
  if (pref === true) return true;
  if (pref === false) return false;
  return envFlagOn(env.AMBER_CALENDAR_RUNTIME_ENABLED);
}

/**
 * Format a single event line for the iMessage reply. Kept small on
 * purpose — the polished renderer is a follow-up.
 */
function formatEventLine(event) {
  const title = event?.summary || event?.title || "(no title)";
  const start = event?.start?.dateTime || event?.start || "";
  if (start) return `• ${start} — ${title}`;
  return `• ${title}`;
}

/**
 * Build the reply text for a read intent. Concise, no markdown, suitable
 * for a single iMessage bubble. Falls back gracefully if the provider
 * returns nothing.
 */
async function buildReadReply({ tenant, intent, provider }) {
  try {
    const { events = [] } = await provider.listEvents({ tenant });
    if (!events.length) {
      return intent === CALENDAR_INTENTS.READ_AVAILABILITY
        ? "Looks open from what I can see. Want me to lock something in?"
        : "Nothing on the books yet. Want to add anything?";
    }
    const lines = events.slice(0, 5).map(formatEventLine);
    const header =
      intent === CALENDAR_INTENTS.READ_AVAILABILITY
        ? "Here's what's already on:"
        : "Here's what's coming up:";
    return [header, ...lines].join("\n");
  } catch (err) {
    return `Couldn't reach the calendar just now (${err.message}). Try again in a sec?`;
  }
}

/**
 * Build the confirmation prompt for a state-mutating intent. Names the
 * policy tier so the audit trail is greppable in transcripts and so the
 * follow-up PR that adds the confirm-token continuation can pattern-match.
 */
function buildConfirmPrompt({ intent, policy, classification }) {
  const verb = humanizeIntent(intent);
  const tier = policy.tier;
  const notifyHint = policy.requireConfirmAttendeeNotify
    ? " I'll ask separately about notifying attendees."
    : "";
  return (
    `Want me to ${verb}? Reply "yes" to confirm. ` +
    `(policy: ${tier} — ${policy.rationale}.${notifyHint})`
  );
}

function humanizeIntent(intent) {
  switch (intent) {
    case CALENDAR_INTENTS.CREATE_EVENT:
      return "put that on the calendar";
    case CALENDAR_INTENTS.UPDATE_EVENT:
      return "update that event";
    case CALENDAR_INTENTS.DELETE_EVENT:
      return "cancel that";
    case CALENDAR_INTENTS.RESCHEDULE_EVENT:
      return "move that";
    case CALENDAR_INTENTS.COORDINATE_SCHEDULING:
      return "find a time and propose it";
    default:
      return "go ahead";
  }
}

/**
 * Try to handle an inbound iMessage as a calendar message.
 *
 * @param {object} args
 * @param {object} args.tenant - resolved tenant from lib/tenant.js
 * @param {string} args.text - inbound message text (already de-noised)
 * @param {(reply: string) => Promise<void>} args.reply - bound reply fn
 * @param {object} [args.env] - test seam
 * @param {(tenant: object) => Promise<object>} [args.providerLoader] -
 *   test seam; defaults to getCalendarProvider
 * @returns {Promise<{
 *   handled: boolean,
 *   reason: string,
 *   intent?: string,
 *   tier?: string,
 *   destructive?: boolean,
 * }>}
 */
export async function maybeHandleCalendarMessage({
  tenant,
  text,
  reply,
  isOwner = false,
  env = process.env,
  providerLoader = getCalendarProvider,
} = {}) {
  if (!tenant || typeof text !== "string" || !text.trim()) {
    return { handled: false, reason: "missing tenant or text" };
  }

  const enabled = isCalendarRuntimeEnabled(tenant, env);
  const classification = classifyCalendarIntent(text);

  // Production-readiness gate: when the runtime is OFF but the inbound
  // message is unambiguously a calendar request from the tenant OWNER,
  // reply deterministically that the feature flag is off. The previous
  // behavior let the message fall through to the generic LLM, which then
  // confidently fabricated calendar answers (the user's smoke-test
  // observation: "calendar stuff is not working"). The flag-off reply
  // says exactly what's needed to turn it on.
  //
  // We ONLY fire this branch for the tenant owner. Contacts and group
  // participants must never see internal feature-flag state.
  if (!enabled) {
    if (isOwner && classification.intent !== CALENDAR_INTENTS.UNKNOWN) {
      await reply(
        humanize(
          [
            "Calendar handling is off in this build.",
            "To turn it on: set AMBER_CALENDAR_RUNTIME_ENABLED=1 on the amber-agent service (or set tenant.preferences.calendar.runtimeEnabled = true).",
            "Until then I won't try to read or write your calendar from here.",
          ].join(" "),
        ),
      );
      return {
        handled: true,
        reason: "runtime disabled, owner notified",
        intent: classification.intent,
        enabled: false,
      };
    }
    return { handled: false, reason: "runtime flag off" };
  }

  if (classification.intent === CALENDAR_INTENTS.UNKNOWN) {
    return { handled: false, reason: "non-calendar intent" };
  }

  // Profile load runs even on the read path so both surfaces (this and
  // the iOS client later) see identical timezone/dimension behavior.
  const profile = loadCalendarProfile(tenant);

  const policy = resolveConfirmationPolicy({
    intent: classification.intent,
    context: {
      hasExternalAttendees: classification.hasExternalAttendee,
    },
  });

  // Read path: fall through to the LLM tool path. The runtime's
  // buildReadReply calls provider.listEvents({ tenant }) with no date
  // range — that returned empty for "What's on my calendar May 28?"
  // and the user saw the hardcoded "Nothing on the books yet" stub
  // even when real events existed for the asked-about day. The
  // LLM-driven list_events tool already parses dates from natural
  // language (e.g. "May 28", "tomorrow", "next week"), enumerates
  // every accessible calendar (PR #187), and renders the result —
  // so let it run instead of returning a wrong-but-deterministic
  // stub. Re-enable this branch when buildReadReply is taught to
  // resolve dates and pass a proper time-window into the provider.
  const isRead =
    classification.intent === CALENDAR_INTENTS.READ_AVAILABILITY ||
    classification.intent === CALENDAR_INTENTS.LIST_EVENTS;

  if (isRead) {
    return {
      handled: false,
      reason: "read intent passed through to LLM tool path",
      intent: classification.intent,
      tier: policy.tier,
      destructive: false,
      profileRole: profile.role,
    };
  }

  // Mutating path. If the resolved policy tier is NONE (e.g., "create
  // event for tenant only", "coordinate proposal only", "explicitly
  // safe create"), the user has already authorized — don't ask again.
  // Hand the message back to the LLM tool path, which will call
  // schedule_event / reschedule_event / cancel_event directly via the
  // already-armed gcal tools. The previous behavior asked for
  // confirmation and the queued-action continuation was never wired up,
  // so "yes" replies did nothing and the user saw stale list_events
  // output instead of their newly-created meeting.
  if (policy.tier === CONFIRMATION_TIERS.NONE) {
    return {
      handled: false,
      reason: "tier-NONE mutation — pass through to LLM tool path",
      intent: classification.intent,
      tier: policy.tier,
      destructive: classification.destructive,
      profileRole: profile.role,
    };
  }

  // Higher-tier mutations (anything that needs explicit confirmation)
  // still gate at the prompt. The confirm-token continuation is the
  // next PR; for now this branch sits behind tiers that actually need
  // it (multi-party invites, deletes with attendees, etc).
  await reply(
    humanize(
      buildConfirmPrompt({
        intent: classification.intent,
        policy,
        classification,
      }),
    ),
  );
  return {
    handled: true,
    reason: "mutating intent stopped at confirmation gate",
    intent: classification.intent,
    tier: policy.tier,
    destructive: classification.destructive,
    profileRole: profile.role,
  };
}
