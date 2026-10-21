# Calendar Runtime Integration

How the first slice of the calendar-first runtime
([`docs/CALENDAR-FIRST-SAMBER.md`](CALENDAR-FIRST-SAMBER.md)) plugs into the
existing iMessage agent loop, and the seams that the iOS surface
(`amber-ios-dev`) will consume once it lands.

This is an integration note for the modules shipped under
`Newton/agent/lib/calendar/` — not a rewrite of the agent loop. None of
the existing tool dispatchers were edited as part of this slice; the new
modules are imported from the upstream classifier when the message handler
is ready to consume them.

## Modules

```
Newton/agent/lib/calendar/
├── intent.js     classifyCalendarIntent(msg) → { intent, destructive, hasExternalAttendee, ... }
├── policy.js     resolveConfirmationPolicy({ intent, context }) → { tier, requireConfirmAction, ... }
├── profile.js    loadCalendarProfile(tenant) → { role, timezone, dimensionWeights, ... }
├── roles.js      ROLE_WEIGHTS, DEFAULT_DIMENSION_WEIGHTS, DIMENSIONS
├── rank.js       rankSlots(slots, weights) → slots[]   (slot-ranker)
├── provider.js   getCalendarProvider(tenant) → { listEvents, freeBusy, create, update, delete }
├── runtime.js    maybeHandleCalendarMessage({ tenant, text, reply }) → { handled, intent, tier }
└── index.js      barrel
```

All modules are pure ESM with no side effects at import time except
`provider.js`, which lazily registers the `gcal`-backed provider on first
use so test environments that select the `mock` provider never load the
real Google Calendar client.

## Lifecycle of a calendar-shaped message

```
inbound iMessage
   ↓
tenant resolution (lib/tenant.js)
   ↓
classifyCalendarIntent(text)                            ← intent.js
   ↓
loadCalendarProfile(tenant)                              ← profile.js
   ↓
resolveConfirmationPolicy({ intent, context })           ← policy.js
   ↓                                                ┌────────────┐
   ├── tier=none  → execute via provider            │ provider.js│
   ├── tier=single → ask user, wait for confirm     │  (gcal,    │
   ├── tier=double → ask user 2x (action + notify?) │   mock,    │
                                                    │   broker)  │
                                                    └────────────┘
   ↓
rankSlots(legalSlots, profile.dimensionWeights)          ← rank.js
   ↓
outbox audit record + reply to user
```

The wiring lives in `Newton/agent/lib/calendar/runtime.js` and is invoked
from `Newton/agent/agent.js` at the top of `handleWebhookMessage`'s `try`
block, after tenant resolution and the early-return safety / opt-out /
retreat checks, before the AI tool loop. The pre-pass is gated by the
`AMBER_CALENDAR_RUNTIME_ENABLED` env flag (or a per-tenant
`preferences.calendar.runtimeEnabled` override) and defaults to OFF, so
no existing tenant sees a behavior change until the flag is flipped.

When the pre-pass returns `handled: true`, the AI loop is skipped for
that turn. When it returns `handled: false` (flag off, unknown intent,
or low confidence), the existing assistant path runs unchanged.

A future PR adds the confirm-token continuation that binds a "yes"/"no"
reply to the queued action and dispatches it through the provider seam.
The contract here is already pinned by tests, so that PR is small and
mechanical.

## Enabling the runtime

The pre-pass is OFF by default. Two ways to turn it on:

| Mechanism | Where it lives | Scope |
|---|---|---|
| `AMBER_CALENDAR_RUNTIME_ENABLED=1` | Railway env on the `amber-agent` service | Process-wide (all tenants) |
| `tenant.preferences.calendar.runtimeEnabled = true` | `amber-id` tenant record | Per tenant |

Per-tenant overrides win in both directions: `runtimeEnabled: false`
keeps a tenant on the old path even when the env flag is on, and
`runtimeEnabled: true` lets a single tenant opt in for testing without
flipping the global.

Accepted truthy values for the env flag: `1`, `true`, `on`, `yes`
(case-insensitive). Anything else is OFF.

## Smoke test messages

Once `AMBER_CALENDAR_RUNTIME_ENABLED=1` is set on the `amber-agent`
Railway service (or the tenant override is on for Camber/Samber), Sagar
or Caleb can iterate by texting Samber/Camber directly. Expected
behavior for the wedge:

| Inbound iMessage | Expected reply | Provider call? |
|---|---|---|
| `"what's on Thursday"` | Short list rendered from the provider, or "Nothing on the books yet." | `listEvents` |
| `"am I free Tuesday at 4"` | "Looks open from what I can see…" or a short conflict summary | `listEvents` |
| `"schedule a 30 with Mira Friday at 3"` | Confirmation prompt: `Want me to put that on the calendar? Reply "yes" to confirm. (policy: none — …)` | None (gated) |
| `"cancel my 2pm with Mira"` | Confirmation prompt: `Want me to cancel that? Reply "yes" to confirm. (policy: single — delete event)` | None (gated) |
| `"move Thursday's 1:1 with mira@acme.io to Friday at 4"` | Confirmation prompt: `Want me to move that? Reply "yes" to confirm. (policy: double — …) I'll ask separately about notifying attendees.` | None (gated) |
| `"how's the weather"` | (Falls through to the existing AI loop unchanged.) | None |

The "yes"/"no" continuation is intentionally not implemented in this PR.
Until the follow-up lands, replying "yes" to a confirmation prompt re-
enters the standard AI loop, which already understands "yes/no" via the
session-pending-action parser.

## How this supports the Perplexity native-connector broker

The native-connector unlock is the second auth path in this repo's
posture (Privy first, Perplexity-connector second, Apple third). The
pre-pass is shaped to make that switch cheap:

- The pre-pass never imports `lib/tools/gcal/*` directly. It only calls
  `getCalendarProvider(tenant)`, which consults
  `tenant.preferences.calendar.provider` and
  `process.env.AMBER_CALENDAR_PROVIDER` in that order before defaulting
  to `gcal`. The broker registers itself as the `perplexity-connector`
  provider at boot in the future PR — no caller in this file changes.
- Credentials never live in this repo. The broker holds the OAuth
  tokens and exposes the same `listEvents / freeBusy / createEvent /
  updateEvent / deleteEvent` shape. The intent + policy decisions in
  this pre-pass are identical regardless of which provider executes.
- The confirmation gate is provider-agnostic: a "cancel my 2pm" message
  hits the same single-confirm tier whether the eventual provider is
  gcal-native or Perplexity-broker. That property is what lets us flip
  the provider without re-auditing the safety model.

## Why a pre-pass instead of editing the agent tool loop

Two reasons:

1. **Reviewability.** The agent.js tool loop is 1900+ lines. Adding
   calendar routing there means touching the system prompt, the tool
   inventory, the dispatch table, and the model-routing logic in one
   PR. The pre-pass is one named function with a test contract.
2. **Reversibility.** The flag is the entire kill-switch. Flip it off
   and the new path is gone — no half-migrated state in the tool loop,
   no orphan tool definitions, no system-prompt drift.

## iOS surface (`amber-ios-dev`)

`amber-ios-dev` does not call this module directly. The iOS client talks to
`amber-id`, which talks to this service over the existing webhook surface.
What changes for iOS once this slice lands:

- The same intent vocabulary (`read_availability`, `list_events`,
  `create_event`, `update_event`, `delete_event`, `reschedule_event`,
  `coordinate_scheduling`, `unknown`) is the only client-facing event shape.
  The iOS UI maps confirmations onto its own affordances (sheet, swipe) but
  the policy tier (`none` / `single` / `double`) is identical to iMessage.
- The slot-ranker output is the same on both surfaces. iOS renders the
  ranked slate; iMessage prints the top three. Same engine, two skins.
- Provider adapter is transparent: iOS does not care whether the underlying
  calls go through native gcal or a future Perplexity connector broker.

## Provider seam: gcal today, broker tomorrow

`provider.js` exposes three concrete bindings:

| Name | Source | Status |
|---|---|---|
| `gcal` | `lib/tools/gcal/{client,provisioner}.js` | Production today. |
| `mock` | in-memory map | Tests only. |
| `perplexity-connector` | future broker | Interface placeholder. Not wired. |

The `perplexity-connector` binding is intentionally **not** implemented in
this PR. Adding it means standing up a credential-holding broker outside
this repo and registering its provider implementation at boot. Per repo
policy, no Perplexity credentials live here — the broker holds them.

Selection is driven by, in order: `tenant.preferences.calendar.provider`,
`process.env.AMBER_CALENDAR_PROVIDER`, then the `gcal` default.

## Auth posture

The auth thesis the runtime is being designed against:

1. **Privy / blockchain-first** — the passport is the person, not the phone.
   `tenant.privyDid` is the only stable identifier the runtime sees.
2. **Perplexity native-connector unlock** — when the connector broker lands,
   it carries OAuth on behalf of the user; this repo never holds those
   tokens.
3. **Apple as the third polished auth path** — Sign in with Apple is the
   user-facing fallback when Privy + Perplexity are insufficient (e.g. an
   iMessage-only user who has not yet signed up via the iOS client).

None of these are decided in this slice. They are recorded here so the
provider seam is shaped to honor them later — specifically, the provider
interface is the only thing in this repo that touches "where the auth comes
from," so each of the three paths plugs in there.

## What the wiring PR does NOT do

- Does not change the agent tool loop. The Claude tool definitions and
  dispatcher are untouched; the pre-pass runs before that loop and
  either short-circuits or falls through to it.
- Does not implement the confirm-token continuation. A "yes" reply to a
  confirmation prompt is currently parsed by the existing
  session-pending-action path, not by a calendar-specific continuation.
  The follow-up PR adds the calendar continuation cleanly.
- Does not introduce the time-expression resolver, conflict detector, or
  Gmail-invite shadow draft (each is its own follow-up per
  `docs/CALENDAR-FIRST-SAMBER.md` §13).
- Does not change the gcal Claude tool surface. Existing tool callers are
  unaffected.
- Does not implement the Perplexity connector broker. Only the seam.

## Test coverage

- `lib/__tests__/calendar-intent.test.mjs` — classifier accuracy + destructive
  tripwire (≥95% on a 20-sample fixture per CALENDAR-FIRST §10).
- `lib/__tests__/calendar-policy.test.mjs` — confirmation tier matrix.
- `lib/__tests__/calendar-profile-and-rank.test.mjs` — shared engine,
  different policy (Camber/hiring vs Samber/selling produce different
  orderings on identical slates; identical weights converge).
- `lib/__tests__/calendar-provider.test.mjs` — provider registry, mock CRUD,
  end-to-end safety: a "cancel my 2pm" message stops at the confirmation
  gate and never reaches the provider.
- `lib/__tests__/calendar-runtime.test.mjs` — pre-pass wiring: flag-off
  preserves existing behavior, flag-on intercepts calendar intents,
  destructive intents are blocked at the confirmation gate, Camber
  (hiring) and Samber (selling) share the same code path with
  different policy profiles, provider errors surface as graceful
  replies.

Run: `cd Newton/agent && node --test lib/__tests__/calendar-*.test.mjs`.

## Required reading

- [`CLAUDE.md`](../CLAUDE.md)
- [`AGENTS.md`](../AGENTS.md)
- [`docs/CALENDAR-FIRST-SAMBER.md`](CALENDAR-FIRST-SAMBER.md)
- [`docs/AMBER-VOICE.md`](AMBER-VOICE.md) — voice register is unchanged by
  the policy profile; `tenant.role` does not affect tone.
