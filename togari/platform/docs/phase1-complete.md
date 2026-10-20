# Phase 1 — Complete

Phase 1 extracted a transport-agnostic `core/` out of the original
Slack-centric implementation, migrated the Slack transport onto it,
confirmed MCP was already thin, retired the back-compat shims, and
installed the Phase 2/3 seams (examples loader, model router, identity,
attachments, transportMetadata, onProgress). 22/22 smoke tests are
green; typecheck and build are clean; no public MCP tool schema
changed.

Related:
- [`phase1-inventory.md`](./phase1-inventory.md) — starting state
- [`phase1-followups.md`](./phase1-followups.md) — deferred items

---

## File-level before/after

### Moved (git mv, history preserved where possible)

| Before                                         | After                                          |
|------------------------------------------------|------------------------------------------------|
| `src/agents/slack-sync/index.ts`               | `src/transports/slack/index.ts` (thinned)      |
| `src/agents/slack-sync/parser.ts`              | `src/transports/slack/parser.ts` (wrapper)     |
| `src/agents/slack-sync/deal-sync.ts`           | `src/transports/slack/deal-sync.ts` (wrapper)  |
| `src/agents/slack-sync/calendar-sync.ts`       | `src/transports/slack/calendar-sync.ts`        |
| `src/agents/slack-sync/query-handler.ts`       | `src/transports/slack/query-handler.ts`        |
| `src/agents/slack-sync/responder.ts`           | `src/transports/slack/responder.ts`            |
| `src/agents/slack-sync/proposal-output.ts`     | `src/transports/slack/proposal-output.ts`      |

### Retired

- `src/agents/slack-sync/deal-context.ts` — logic lives in `core/tools/deal-ops.searchDeal`
- `src/agents/slack-sync/fireflies-client.ts` — logic lives in `core/tools/meeting-intel`
- `src/agents/slack-sync/proposal-generator.ts` — logic lives in `core/tools/proposal-ops`
- `src/core/deal-ops.ts`, `src/core/calendar-ops.ts`, `src/core/email-ops.ts`,
  `src/core/meeting-intel.ts`, `src/core/proposal-ops.ts`,
  `src/core/reminder-ops.ts` — back-compat shims, contents now canonical
  under `src/core/tools/`

### Added

- `src/core/claude-loop.ts` — generalized Claude tool-use loop
- `src/core/prompts/system.ts` — single-source system prompt + examples seam
- `src/core/models/router.ts` — `selectModel()` seam
- `src/core/identity.ts` — `resolveUser()` / `resolveUserContext()` seams
- `src/core/tools/{deal-ops,calendar-ops,email-ops,meeting-intel,proposal-ops,reminder-ops}.ts`
  — canonical, transport-agnostic tool implementations

---

## Public API of `core/`

This is what a new transport needs. Nothing else in `core/` should be
imported from a transport in Phase 2+.

### Entry points

```ts
// src/core/engine.ts
processMessage(request: TogariRequest, onProgress?: OnProgress)
  : Promise<TogariResponse>

executeIntent(intent: ParsedIntent, request: TogariRequest, onProgress?: OnProgress)
  : Promise<TogariResponse>
```

- `processMessage` — classify intents via Claude and dispatch. This is
  the default entry point for freeform user text.
- `executeIntent` — run a single pre-classified intent. Slack uses this
  directly after its parser has already produced the intent; it's also
  the path where `onProgress` is emitted for long-running flows
  (`generate_proposal`, `analyze_meeting`).

### Intent classification

```ts
// src/core/intent-router.ts
classifyIntent(request: TogariRequest): Promise<ParsedIntent[]>
```

Transport-agnostic Claude call; returns an array because one message
may contain multiple actions.

### Identity

```ts
// src/core/identity.ts
resolveUser(transport: Transport, transportId: string): string
resolveUserContext(transport, transportId, overrides?): UserContext
```

Phase 1 passes through. Phase 2 will add the `imessage` case (phone →
hashed lookup → user_id) inside `resolveUser`'s switch.

### Model routing

```ts
// src/core/models/router.ts
selectModel(type: MessageType, complexity?: Complexity): string
```

Currently returns `DEFAULT_MODEL` for everything. Wired into
`core/engine.handleConversation` and `core/claude-loop.ts`. See
**Known deviations** below for call sites that still hardcode the
model id; these are intentional and documented.

### Prompts + examples

```ts
// src/core/prompts/system.ts
buildConversationPrompt(ctx?: PromptContext): string
loadExamples(messageType?: string, ctx?: PromptContext): FewShotExample[]
```

`loadExamples` returns `[]` today. Phase 3 will fill the body with
BigQuery-backed exemplar selection filtered by `messageType`; no call
site changes.

### Tools (for transports that want to bypass intent classification)

```ts
// src/core/tools/deal-ops.ts
searchDeal, createDeal, updateDeal, queryDeals, logActivity

// src/core/tools/calendar-ops.ts
scheduleEvent

// src/core/tools/meeting-intel.ts
findMeeting, searchMeetings, analyzeMeeting

// src/core/tools/proposal-ops.ts
generateProposal

// src/core/tools/email-ops.ts
sendEmail, draftReply

// src/core/tools/reminder-ops.ts
setReminder
```

### Types (all from `src/core/types.ts`)

```ts
TogariRequest, TogariResponse, ParsedIntent,
Attachment, UserContext,
OnProgress, ProgressUpdate,
Deal, MeetingTranscript, ProposalRequest, ProposalResult
```

---

## How to add a new transport (Phase 2 template)

```ts
// src/transports/imessage/webhook.ts
import { processMessage } from '../../core/engine';
import { resolveUserContext } from '../../core/identity';
import type { TogariRequest, OnProgress } from '../../core/types';
import { sendLoopMessage, sendTypingIndicator } from './loop-client';
import { renderImessageReply } from './renderer';

export async function handleLoopWebhook(event: LoopWebhookEvent) {
  // 1. Build the canonical user context.
  //    resolveUser(imessage, phone_hash) currently passes through;
  //    Phase 2 security work will make it consult the user_bindings
  //    table and return a canonical userId.
  const user = resolveUserContext('imessage', event.from_phone_hash, {
    email: event.known_email,   // if previously bound
  });

  // 2. Build the TogariRequest.
  const request: TogariRequest = {
    text: event.text,
    userId: user.userId,
    platform: 'imessage',
    transport: 'imessage',
    transportMetadata: {
      phone_hash: event.from_phone_hash,
      loop_message_id: event.message_id,
      conversation_id: event.conversation_id,
      tapback_of_message_id: event.tapback_of,
    },
    attachments: (event.attachments ?? []).map(a => ({
      kind: a.kind,
      mimeType: a.mime_type,
      url: a.url,
      size_bytes: a.size_bytes,
      transcript: a.transcript,   // voice memos pre-transcribed
    })),
    user,
  };

  // 3. Progress → iMessage typing indicator via Loop.
  const onProgress: OnProgress = async (update) => {
    await sendTypingIndicator(event.conversation_id);
    // Optionally: send update.message as a short interstitial reply
    // if the flow is long enough to warrant it.
  };

  // 4. Delegate to core.
  const response = await processMessage(request, onProgress);

  // 5. Render + send.
  const rendered = renderImessageReply(response);
  await sendLoopMessage(event.conversation_id, rendered);
}
```

The same shape works for any new transport:

1. Resolve identity via `resolveUserContext`.
2. Build a `TogariRequest` with `transport`, `transportMetadata`,
   `attachments`.
3. Build an `OnProgress` that maps to the transport's native feedback
   primitive (Slack: post a message; iMessage: typing indicator;
   OpenAI: streaming delta; MCP: no-op).
4. Call `processMessage` (or `executeIntent` if you've already
   classified).
5. Render the `TogariResponse` into the transport's message format.

---

## Phase 2/3 seams — audit results

| Seam                                   | Status   | Notes                                                          |
|----------------------------------------|----------|----------------------------------------------------------------|
| `loadExamples(messageType?, ctx?)`     | OK       | Parameter added, body still returns `[]`                       |
| `selectModel(type, complexity)`        | OK       | Wired into engine + claude-loop; see deviations below          |
| `resolveUser(transport, id)` switch    | OK       | Switch structure present; Phase 2 adds the imessage case body  |
| `Attachment` shape                     | OK       | Added `size_bytes` and `transcript` fields                     |
| `TogariRequest.transport` enum         | OK       | Includes slack/mcp/api/imessage/teams/smartlead/openai         |
| `TogariRequest.transportMetadata`      | OK       | `Record<string, unknown>` — open shape, no type change needed  |
| `OnProgress(update)` callback          | OK       | Transport-agnostic; `update.message` is the renderable string  |

---

## Known deviations — hardcoded model ids that bypass `selectModel()`

These were left intentionally in Phase 1 because they are either
secondary (non-conversational) Claude calls with stable cost profiles,
or they live outside `core/` and their migration belongs to a later
phase. Documented here so they aren't accidentally "normalized" without
thought.

| Call site                                          | Reason                                            |
|----------------------------------------------------|---------------------------------------------------|
| `src/core/intent-router.ts`                        | Intent classifier — Phase 3 may route it via `selectModel('intent_classify')`; leaving stable for now |
| `src/core/tools/deal-ops.ts` (`queryDeals` format) | `core/tools/*` off-limits in Steps 3-4 per refactor rules |
| `src/core/tools/meeting-intel.ts` (3 call sites)   | Same — tool logic untouched                       |
| `src/core/tools/proposal-ops.ts`                   | Same                                              |
| `src/core/tools/email-ops.ts`                      | Same                                              |
| `src/bigquery/sql-generator.ts`                    | Swapped SDK → direct fetch in Step 3; see `phase1-followups.md` |
| `src/email-engine/classifier.ts`                   | Smartlead classifier — separate agent; migrates when Smartlead transport lands |
| `src/agents/smartlead-responder/classifier.ts`     | Same                                              |

When Phase 3 introduces the Haiku/Sonnet routing, the call sites under
`core/tools/*` should be swapped to `selectModel(messageType, complexity)`
in a dedicated pass with regression tests; the outside-of-core call
sites should migrate with their transport/agent.

---

## Exported-for-tests symbols

Future refactors must not privatize these without updating the smoke
tests:

| Symbol                                                    | Used by                                          |
|-----------------------------------------------------------|--------------------------------------------------|
| `parseSlackMessage` from `transports/slack/parser`        | `tests/smoke/slack.test.ts` parser block         |
| `syncDeal` from `transports/slack/deal-sync`              | `tests/smoke/slack.test.ts` deal sync block      |
| `syncCalendar` from `transports/slack/calendar-sync`      | `tests/smoke/slack.test.ts` calendar block       |
| `handleQuery` from `transports/slack/query-handler`       | `tests/smoke/slack.test.ts` query block          |
| `processSingleAction` from `transports/slack/index`       | `tests/smoke/slack.test.ts` progress + notes + transportMetadata blocks |
| `executeIntent`, `processMessage` from `core/engine`      | Both slack + mcp smoke suites                    |
| `handleToolCall` from `transports/mcp/handlers`           | `tests/smoke/mcp.test.ts`                        |
| `queueBqRows`, `onFetch`, `onAnthropic`, `anthropicText`, `getMockState` from `tests/smoke/helpers` | Shared across all smoke suites |

---

## Verification

- `npm test` → **22/22 passing** (`parser`×3, `deal sync`×4, `calendar sync`×1, `query handler`×2, `progress`×1, `notes`×1, `transportMetadata`×1, `mcp handleToolCall`×7, `smartlead`×2)
- `npm run typecheck` → clean
- `npm run build` → clean (build.mjs warning about `googleapis` package.json `sideEffects` is upstream and pre-existing)
- `src/agents/slack-sync/` removed
- `src/transports/mcp/` contains zero direct `@anthropic-ai/sdk` / `@google-cloud/bigquery` / `googleapis` / Fireflies calls
- MCP tool schemas unchanged since pre-Phase-1 (`git diff 2966a7b..HEAD -- src/transports/mcp/tools.ts` is empty)

---

## Ready for Phase 2

Phase 2 can:

- Add `src/transports/imessage/` following the template above without
  touching `core/`
- Fill in `resolveUser`'s `imessage` case to add phone hashing + OTP
  binding lookup without changing the signature
- Populate `Attachment.transcript` from Loop's audio decoder
- Add `phone_hash`, `loop_message_id`, `conversation_id`,
  `tapback_of_message_id` to `transportMetadata` with no type change

Phase 3 can:

- Fill in `loadExamples(messageType)` to return 5-10 curated examples
  per type without changing any call site
- Fill in `selectModel()` to route low-complexity chat to Haiku and
  leave high-complexity flows on Sonnet without call-site changes (for
  the sites that already go through it; see deviations above)
