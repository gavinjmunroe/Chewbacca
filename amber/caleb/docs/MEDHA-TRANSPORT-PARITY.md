# Medha Transport Parity

Scope: Medha tenant only (`did:privy:cmobxrpvr00ml0cjp5gq5mdyd`, Loop sender
`+1 555 010 0005`). Togari tenant (`did:privy:cmo0ay9oy001u0cl7h1wb7thy`,
`+1 555 010 0003`) is intentionally out of scope for this PR.

Goal: the same Medha agent should behave identically across iMessage DM,
iMessage group chat, and Slack. No per-transport code paths for tool surface
or owner doctrine. Differences live only in the transport-policy block of
the prompt (how to address users, where attachments come out, threading).

## Part 1 — Findings (pre-fix)

### 1a. `Newton/agent/lib/prompts.js` `buildSystemPromptForSender`

Three branches today:

1. Owner DM (`isCaleb && !isGroup`, ~line 608): has the FULL doctrine —
   PDF GENERATION, FILE GENERATION, PARTNERSHIPS + INVESTORS, REMINDERS,
   RETREAT PLANNING, LINKEDIN ORG ANALYTICS, TRAINING DATA EXTRACTION,
   SLACK INBOUND IDENTITY, YOUR INTERFACES, YOUR MEMORY, PRODUCT KNOWLEDGE
   vs CHANNEL SKILL SET, SAGAR'S TRAINING CORPUS, CONTENT SEEDS, BRAND
   DECISIONS, etc.
2. Group (`isGroup`, ~line 934): contains ownership + lane-guardrail, a
   GROUP SOCIAL GOVERNOR block, image generation, and a PDF/FILE
   GENERATION block — BUT missing PARTNERSHIPS + INVESTORS, REMINDERS,
   RETREAT PLANNING, LINKEDIN ORG ANALYTICS, TRAINING DATA EXTRACTION,
   SLACK INBOUND IDENTITY, YOUR INTERFACES, YOUR MEMORY, PRODUCT KNOWLEDGE
   vs CHANNEL SKILL SET, SAGAR'S TRAINING CORPUS, CONTENT SEEDS, BRAND
   DECISIONS. A group with the owner present should get the same surface
   as the owner DM.
3. Contact DM (`!isCaleb && !isGroup`, ~line 1089): personality-focused
   prompt for a stranger talking to the owner's agent. Intentionally
   stripped — no owner doctrine. Correct as-is.

The public-expert short-circuit (`buildMedhaExpertPrompt`) is a separate
fourth branch and already contains a superset of the owner doctrine since
Medha-the-product is the same agent. Out of scope here.

### 1b. `Newton/agent/lib/tool-arming.js` and `isExpert`

`armTools({ allTools, text, toolsEnabled, isExpert, detectedIntent })` —
correctly does NOT take `isGroup`. The DM-vs-group parity invariant is
locked by `tool-arming-parity.test.mjs`.

Today `isExpert` is set in `agent.js` as `tenant?.expertMode === true`.
That means:

- Caleb's Camber DM: `isExpert = false` even though Caleb is the owner.
- Public Medha sender (the +1 555 010 0005 expert tenant): `isExpert = true`.
- Caleb's Camber group chats: `isExpert = false`.
- Slack inbound to Medha: `isExpert = true` because the expert tenant
  carries `expertMode = true`.

That is wrong on its face for the owner of a non-expert tenant in a group
or DM. The right gate is "sender is the owner". The four PRIVATE
always-armed banks (CALENDAR, PARTNERSHIP, PERSONAL_LIFE) should be
available to any owner-sender regardless of transport or chat type.

`toolsEnabled = isCaleb || tenant?.expertMode === true` — already gates
the LLM's tool surface visibility for owner senders. The fix is to keep
the same intent inside `isExpert` so the always-armed banks light up.

### 1c. Slack outbound — `Newton/agent/lib/transports/slack/responder.js`

Today `sendSlackReply` is a thin wrapper over `chat.postMessage`. It does
not check `sendOpts.attachments` at all. `lib/transport.js` line 235
calls `sendSlackReply({ channel, thread_ts, text })` — passes ZERO of the
attachment URLs. So when `generate_image` / `generate_pdf` etc fires on
Slack today, the URL is either embedded in the text reply or stripped
entirely (the prompt tells the model not to paste URLs). Outcome: Slack
users see text that says "i made you a PDF" with NO file attached.

### 1d. Loop webhook `nonAudioAttachments` extraction

`server.js` line 1122 builds `nonAudioAttachments` from `payload.attachments`
unconditionally. Group_id is not checked. This path already works for
groups. Line 1211 short-circuits only when there is NO text AND NO
attachments — attachments alone are sufficient to dispatch.

Confirmed: no fix needed here. Groups already ingest attachments the same
way DMs do.

### 1e. Loop outbound — `Newton/agent/lib/transport.js` `sendToLoop`

Lines 380-392: Loop request body sets both `group` (when `opts.group` is
present) AND `attachments` (when `opts.attachments?.length > 0`). They
are independent. Confirmed: Loop outbound carries group + attachments
together.

## Part 2 — Implemented fixes

### 2a. `tool-arming.js`: `senderIsOwner` flag

Added `senderIsOwner` to `armTools` opts. New resolution:

```
isExpert = (senderIsOwner !== undefined)
  ? (senderIsOwner && tenant?.expertMode !== false)
  : tenant?.expertMode === true  // backward-compat
```

Caller (`agent.js`) computes `senderIsOwner` once per turn from the
inbound `from` / Slack senderHints and passes it in.

### 2b. `prompts.js`: `buildOwnerDoctrineBlocks(tenant)` helper

New exported helper that returns the FULL doctrine string: file gen, PDF
gen, partnerships, reminders, retreat planning, linkedin analytics,
training data, Slack inbound identity, interfaces, memory, product
knowledge vs channel skill set, training corpus, content seeds, brand
decisions, partnerships + contact context. This is called from:

- The owner-DM branch (replaces the previously-inline blocks)
- The group branch (when `senderIsOwner === true`, owner-in-group)
- The contact-DM branch never includes it (contact is not the owner)

This is the "same Medha across windows" guarantee — when the owner is
the human typing, Medha's surface is identical regardless of window.

### 2c. Transport-policy block per branch

Separate from doctrine. Tells Medha:

- iMessage DM: no special block.
- iMessage GROUP: "address users by first name, only reply when @-mentioned
  / 'Medha' is named / continuing your own thread, outbound attachments
  ride alongside group_id on Loop the same way they do in DM."
- SLACK: "address users by Slack display name, reply in-thread if the
  inbound was in a thread, only respond when @-mentioned / 'Medha' is
  named / continuing your own thread, file attachments are delivered as
  real Slack file uploads via files.uploadV2, NOT URL pastes."

### 2d. `agent.js` wiring

`handleWebhookMessage` computes `senderIsOwner` once and threads it to:

- `buildSystemPromptForSender(..., senderIsOwner)` so the prompt branches
  route to the owner doctrine.
- `armTools({ ..., senderIsOwner })` so the always-armed banks light up
  for owner senders in any window.

`sendOpts.group` already gets `groupId`; outbound attachments already
ride on `sendOpts.attachments` (line 2417). No change needed there.

### 2e. Slack outbound `files.uploadV2`

New helper `Newton/agent/lib/transports/slack/files-upload.js` implements
Slack's 3-step external upload:

1. `POST files.getUploadURLExternal` with `filename` + `length` (form
   data, Bearer bot token) → `{ upload_url, file_id }`.
2. `POST {upload_url}` with raw binary body fetched from the own-domain
   image-host URL.
3. `POST files.completeUploadExternal` with `{ files: [{ id, title }],
channel_id, thread_ts, initial_comment }`.

Updated `responder.js` `sendSlackReply` so when `attachments?.length`,
it calls `uploadFilesToSlack` instead of `chat.postMessage` and passes
the reply text as `initial_comment`. Returns the same `{ ok, ts? }`
shape so `lib/transport.js` doesn't need to change its return-flow
expectations. The text-only path (`chat.postMessage`) is unchanged.

### 2f. `server.js` group attachment ingest

Confirmed not gated on group_id; no code change.

### 2g. `transport.js` Loop body

Confirmed Loop body includes both `group` and `attachments` keys
independently when set. No code change.

## Part 3 — Tests

New file: `Newton/agent/lib/__tests__/transport-parity.test.mjs`

- `senderIsOwner=true, isGroup=false` → owner DM surface includes
  partnership + personal-life always-armed banks.
- `senderIsOwner=true, isGroup=true` → SAME surface.
- `senderIsOwner=false, isGroup=true` → surface does NOT include
  partnership + personal-life always-armed banks (non-owner author in a
  group should not be granted the owner's tool reach).
- Prompt assembly: `buildSystemPromptForSender({ senderIsOwner: true,
isGroup: true })` contains the same doctrine substrings as
  `senderIsOwner: true, isGroup: false`. String-contains assertions on
  5+ owner-doctrine markers (PARTNERSHIPS, REMINDERS, RETREAT, LINKEDIN
  ORG ANALYTICS, TRAINING DATA EXTRACTION, PRODUCT KNOWLEDGE).
- Slack outbound: mocked `files.uploadV2` 3-step flow; assert the URLs
  hit in order and `initial_comment` == text. No separate
  `chat.postMessage` call when attachments present.
- Loop outbound with group + attachments: body includes both keys.

## Out of scope

- Togari tenant (`did:privy:cmo0ay9oy001u0cl7h1wb7thy`, +1 555 010 0003).
  Caleb 2026-05-28: only the Medha tenant is in scope for this PR.
- Reworking the public-expert (`tenant.expertMode === true`) prompt —
  the `buildMedhaExpertPrompt` branch is its own thing.
- Slack Block Kit upgrades for richer message rendering.
