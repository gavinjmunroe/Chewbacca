# Medha Trip Planning — Master Plan (v2, decisions locked)

> Branch: `feat/trip-planning`
> Companion dashboard repo: [`amber-organization/medha-trip-planning`](https://github.com/amber-organization/medha-trip-planning)
> Multi-tenant note: this repo powers Camber, Samber, AND Medha. Trip planning is a feature of the **shared agent surface** in `Newton/agent/lib/`, branded for Medha in the dashboard. All tools must be tenant-scoped per `CLAUDE.md`.
>
> References:
>
> - TREK self-hosted travel planner (AGPL): [`github.com/mauriceboe/TREK`](https://github.com/mauriceboe/TREK), vendored at [Newton/trek/](Newton/trek/), fresh clone at `../references/TREK/`
> - togari PDW: `/Users/joelnewton/togari-platform/src/pdw/`
> - Vision: [[project_amber_vision]], [[project_medha_togari_split]], [[project_rave_master_needs_togari_migration]]

---

## 0. What this is

Group trips and group events are the hardest coordination problem in the average person's life. Group chat is where decisions actually happen but nothing structured comes out of it. Spreadsheets, Notion, Splitwise, and TREK are structured but dead. Calendar invites freeze one moment in time. The "one organized friend" burns out.

The future is the agent who already lives in the chat, plans the trip _with_ you, remembers each person individually, and reaches out privately when private follow-up is the right tool.

This branch builds that. Trip planning is the wedge. The same primitives generalize to **any** group chat coordination: fantasy leagues, weddings, Bible studies, study sessions, watch parties, retreats. Decision 1 below.

---

## 1. Locked decisions (32)

This product is now fully scoped. Every decision below is **final** unless we explicitly revisit it.

### Surface area + product shape

| #   | Decision                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Universal group coordinator.** Trip planning is the wedge. All primitives generic from day one. Trips ship first as killer demo.                                                                                                  |
| 2   | **Two-level data model: Group + Event.** Group is the durable container (a chat). Events come and go inside it. URL: `/group/<id>/event/<id>`.                                                                                      |
| 3   | **Centralized ownership.** amber-organization is the steward. Per-person rows live in BQ. Users see only their own view via auth scope.                                                                                             |
| 4   | **Group identity = chatGuid + human alias.** Medha learns the alias organically ("EDC squad") and stores it in `group_memories`. Auto-suggested, user-confirmable.                                                                  |
| 5   | **Event type = open string + curated starter set.** Seed: trip, rave, festival, wedding, retreat, party, study, fantasy_draft, weekly_recurring, dinner, roadtrip, hike, watch_party. UI overlays per-type with `general` fallback. |
| 6   | **Proactive in DMs, reactive in group.** Medha can DM individuals on her own. In groups she speaks only when addressed or tool-called. Existing social governor stays.                                                              |
| 7   | **Universal phone + OTP sign-in.** One auth, see all your groups/events. Phone is the key. OTP delivered via Medha DM. JWT scoped to person_id.                                                                                     |
| 8   | **One Medha number for v1.** Schema doesn't include `medha_instance_id` (decision 32). Future multi-number support is a deliberate refactor.                                                                                        |

### Commitments, money, memory

| #   | Decision                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **Commitments = concrete + vague + voice/photo.** "Speakers" (concrete), "I got the hotel" (vague), photo of a ticket (visual), "I'll handle drinks" (action). All tracked.                                                           |
| 10  | **Money: track and remind, don't move.** Budgets, who paid what, who owes. DM reminders. NO Venmo/Cash App API integration. Splitwise-level utility, zero financial regulation surface.                                               |
| 11  | **Cross-event memory: profile + commitments + preferences.** Per-person: dietary, allergies, fitness/sleep, music taste, past-trip learnings, kept-vs-missed commitment history (private). Carries everywhere. The compounding asset. |
| 12  | **Bootstrapping: add-the-number + 2-sentence intro.** Someone adds Medha to a group. Her first message: warm intro, asks for group name, offers a "plan something" nudge. Conversion is best when intro is human-sized.               |

### Multimodality, consent, identity, lifecycle

| #   | Decision                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | **Full multimodal in/out.** Inbound: photo OCR (tickets → confirmation numbers), screenshot parsing (itineraries → structured events), voice transcription. Outbound: text + occasional voice notes. Files attached to events.                          |
| 14  | **STRICT opt-IN per group.** Medha NEVER DMs proactively until the person replies 👍 (or "YES") to her group handshake DM. Group-chat replies don't require opt-in. Opt-out via "STOP" reply universal mute. Per-event mute via "MUTE <event>".         |
| 15  | **Auto-merge identity on strong signals.** Same contact name + iCloud email → auto-merge into one `person_id`. Uncertain matches surface as dashboard prompts. `person_id` stable, `handles[]` is a list.                                               |
| 16  | **Post-event = recap + archive + persistent memory.** Day-after, Medha DMs each opted-in participant: "wanna do an EDC recap? top 3 moments?" Generates one-page journal in dashboard. Event moves to `past` status. Per-person learnings stay forever. |

### Integrations, errors, identity, sync

| #   | Decision                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 17  | **Calendar sync = LATER PHASE.** Not in v1 phases 1–7. Phase 8+ adds Google + Apple. v1 ships without.                                                                                                       |
| 18  | **Error correction = natural language + tapback.** "medha, sarah isn't bringing speakers anymore" patches the field. Tapback-thumbs-down on Medha's confirmation undoes the action. No commands.             |
| 19  | **Shared amber-id across products.** `person_id = sha256(E.164 phone)` is identical in `medha_pdw.persons` AND `togari_pdw.persons`. Each product owns its data. Future amber-id service joins them cleanly. |
| 20  | **Near-real-time dashboard via SSE/Supabase Realtime.** When chat updates, dashboard refreshes within ~2s. Lightweight infra; Supabase already supports it.                                                  |

### Conflicts, roles, dashboard-to-chat, safety

| #   | Decision                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | **Commitment conflicts: surface to humans, don't decide.** Two people commit to speakers → Medha posts one line: "heads up: Sarah AND Tom both said speakers — one of you wanna swap?" Status: `conflicted` until resolved.                                                                                                                   |
| 22  | **Soft organizer role; everyone-can-edit.** Event creator is organizer (badge). Anyone can edit. Destructive changes (deleting the event, removing a participant) trigger Medha to ping the organizer first.                                                                                                                                  |
| 23  | **"Tell Medha" dashboard button = synthetic group message AS user.** Whatever the user types posts to the agent's inbound endpoint with their JWT, as if they had texted Medha in the group. Medha responds in the group. Bidirectional symmetry.                                                                                             |
| 24  | **Safety: educate, never prescribe; route to experts.** Harm reduction info shared freely (hydration, earplugs, meetup points, sanctuary locations, knowing your limits). Specifics like "is this combo dangerous?" → "I'm not the right tool for this; check DanceSafe / a friend / a medical professional." Real care without overstepping. |

### Coverage, scale, branding, cadence

| #   | Decision                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 25  | **Plan with everyone in group; DM only the opted-in.** Group memory tracks ALL participants. Events list ALL participants. `dm_each_in_group` and reminders silently skip non-opted-in. Non-opted-in see Medha only in group.  |
| 26  | **Optimize for 4-12, support up to 30, graceful degrade above.** Defaults tuned for 4-12. Above 30, Medha says once "this group is large; want me to mostly stay quiet?" and goes mostly silent unless tagged.                 |
| 27  | **Brand: "Medha by Amber."** Dashboard header: "Medha" large, "by Amber" small. Footer: "part of the Amber family." Lets Amber appear without taking center stage in v1.                                                       |
| 28  | **Cadence: T-24h commitment check + 1 follow-up + cap.** ONE DM 24h before event for each open commitment. ONE follow-up 12h before if no reply. Then silent on that item. Per-event hard cap: 3 outbound DMs per participant. |

### Pragmatic v1 shape

| #   | Decision                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 29  | **No external deadline.** Build the right thing. Phases as designed.                                                                                                                                                                                                                             |
| 30  | **Fresh start on data.** Old trip JSON in context repo stays archived. New schema (eventId, BQ, commitments) starts clean. No migration script.                                                                                                                                                  |
| 31  | **Open from day one.** Anyone can text Medha and trigger the bootstrap flow. Rate-limit + cost-control infra is required at v1 launch (see §11 operational concerns).                                                                                                                            |
| 32  | **Build v1 cleanly, refactor for Amber later.** Don't add `medha_instance_id` everywhere. Don't pre-extract `@amber/pdw` package. Ship Medha-only and clean. Amber roll-up is a deliberate Phase 9 refactor. `person_id` stays consistent with Togari (decision 19) to make that refactor cheap. |

---

## 2. North star (in one walkthrough)

```
[Someone adds Medha (+1 555 010 0005) to a 6-person iMessage group]

Medha (group, first touch):
  hey, I'm Medha. I can help this group plan trips, events, or just
  coordinate the boring stuff. what should I call this chat?
  also — if any of you reply 👍 in this thread, that's your opt-in
  for me to DM you individually for reminders. (no opt-in = group-
  only.)

[Caleb 👍, Sarah 👍, Tom 👍, Maya 👍 — Jay and Leo don't react]

Medha (group):
  cool — let's call this "EDC squad" if that fits? say so if not.
  Caleb, Sarah, Tom, Maya — DMs are unlocked for you.
  Jay, Leo — you can still plan with me in here anytime.

[Three days later]

Caleb (group):
  yo medha let's plan EDC vegas may 16-18

Medha (group):
  locked. event MED-7K2A. who's in?
  dashboard: medha-trip-planning.vercel.app
    (sign in with that code + your phone)

[Sarah, Tom, Maya, Jay all confirm. Leo's a maybe.]

Sarah (group):
  I'll bring the speakers

Medha (group):
  noted, Sarah — you've got speakers

Tom (group):
  oh wait I was gonna bring my soundbar

Medha (group):
  heads up — Sarah AND Tom both said speakers. one of you wanna swap?
  Tom, want to take portable chargers instead?

Tom (group):
  yeah ill take chargers

Medha (group):
  done. Sarah on speakers, Tom on chargers.

[Two days before EDC]

Medha → Sarah (DM):
  heads up on EDC Friday — you said you'd bring speakers. still good?

Sarah → Medha (DM):
  yes still got em

Medha → Sarah (DM):
  nice, will let the group know you're locked in

Medha (group):
  Sarah confirmed she's still bringing speakers.
  Tom, Maya, Caleb — checking in with you next.

[Day after EDC]

Medha → each opted-in person (DM):
  EDC recap — wanna share your top 3 moments?
  whatever you send becomes the group journal.
```

The unique angle in one sentence: **Medha is the only group coordinator that lives in the chat, remembers each person individually, and DMs people privately when private follow-up is the right tool.**

---

## 3. What's already built (do NOT re-build)

| Capability                     | Where                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Native trip CRUD (JSON-backed) | [Newton/agent/lib/tools/travel.js](Newton/agent/lib/tools/travel.js) — itinerary, reservations, expenses, packing. Will be EXTENDED in Phase 2. |
| Group-chat router              | [Newton/agent/lib/groups.js](Newton/agent/lib/groups.js) — social governor + "reading the room" LLM. Trip-intent hot path goes here.            |
| Per-group memory (Supabase)    | [Newton/agent/lib/group-memory.js](Newton/agent/lib/group-memory.js) — has `participants[]`. Extended to include `opt_in_status` map.           |
| Outbound iMessage              | [Newton/agent/lib/transport.js:55](Newton/agent/lib/transport.js#L55) — `sendMessage(contact, body)`                                            |
| Tapback / typing / read        | `lib/transport.js` lines 248–334                                                                                                                |
| Tool dispatcher                | [Newton/agent/lib/tool-dispatcher.js](Newton/agent/lib/tool-dispatcher.js) — already routes `add_trip_item`                                     |
| Proactive runner               | [Newton/agent/lib/proactive-runner.js](Newton/agent/lib/proactive-runner.js) — hourly cron                                                      |
| Tenant isolation               | [Newton/agent/lib/tenant.js](Newton/agent/lib/tenant.js) — every tool call must be tenant-scoped                                                |
| Voice notes (out)              | [Newton/agent/lib/voice.js](Newton/agent/lib/voice.js) — TTS + send                                                                             |
| Voice notes (in) + URL fetch   | This branch's parent (`feat/medha-url-fetch-and-voice`). Already merged on main.                                                                |
| TREK vendor (UX reference)     | [Newton/trek/](Newton/trek/)                                                                                                                    |
| amber-id integration           | `lib/secrets.js`, `lib/tenant.js` — Privy + Firestore secrets bag, Pinecone namespaces                                                          |

---

## 4. Phase plan (v2, post-decisions)

### Phase 0 — Wired into Phase 1 (the handshake)

Originally I considered Phase 0 separately, but because decision 14 (strict opt-IN) gates `dm_each_in_group`, the handshake machinery MUST ship with the tool or the tool DMs no one. So Phase 1 includes:

- The handshake DM (group first-touch + group rename prompt)
- The `opt_in_status` map in group memory (`{handle: "pending"|"opted_in"|"opted_out"|"stopped"}`)
- The opt-in detection (tapback 👍 or "YES" reply in group) → flip status to `opted_in`
- The "STOP" universal mute (any DM reply of "STOP") → flip status to `stopped`
- The `dm_each_in_group` tool (gated by opt-in status)
- The one-line group echo after fan-out

### Phase 1 — Handshake + `dm_each_in_group`

The single most-leveraged change. Smoke test:

> 1. Caleb adds Medha to a group with 5 friends
> 2. Medha does the handshake intro
> 3. 4 of them 👍 (opt-in), one doesn't
> 4. Caleb texts: _"Medha remind everyone in this groupchat individually to exercise today"_
> 5. The 3 non-Caleb opted-in friends receive an iMessage DM
> 6. The non-opted-in friend receives NOTHING
> 7. Group sees one line: "DM'd 3 people."

Files added:

```
Newton/agent/lib/bootstrapping.js          — handshake intro, opt-in state machine
Newton/agent/lib/tools/dm-each.js          — fan-out tool, opt-in gated
Newton/agent/lib/__tests__/dm-each.test.js
Newton/agent/lib/__tests__/bootstrapping.test.js
```

Files modified:

```
Newton/agent/lib/group-memory.js           — add opt_in_status map
Newton/agent/lib/groups.js                 — detect first-touch, route to handshake
Newton/agent/lib/tools/index.js            — register dm_each_in_group schema
Newton/agent/lib/tool-dispatcher.js        — route dm_each_in_group
```

Tool schema:

```js
{
  name: "dm_each_in_group",
  description:
    "Send an individual iMessage DM to each opted-in participant of the CURRENT group chat. " +
    "Use when the user asks Medha to remind / message / ping / follow up with everyone individually. " +
    "Does NOT post the body in the group. Silently skips participants who haven't opted in.",
  input_schema: {
    type: "object",
    properties: {
      message:        { type: "string", description: "Body each person receives. May include {{name}} or {{first_name}}." },
      exclude:        { type: "array", items: { type: "string" }, description: "Handles to skip (sender and Medha excluded by default)." },
      include_sender: { type: "boolean", description: "Default false." },
      personalize:    { type: "boolean", description: "If true, cheap LLM pass to tailor per recipient. Default false." },
      group_echo:     { type: "string", enum: ["confirm","silent","tapback"], description: "Default 'confirm'." }
    },
    required: ["message"]
  }
}
```

**Acceptance:** smoke test passes end-to-end. No double-sends. Non-opted-in skipped. Group echo posted exactly once.

---

### Phase 2 — Group/Event schema + Event IDs

Two-level data model (decision 2). New entities in JSON-context-repo (hot path) AND BQ (cold path).

Schema (BQ; Supabase mirror for SSE):

```sql
CREATE TABLE medha_pdw.groups (
  tenant_id     STRING NOT NULL,        -- "medha"
  group_id      STRING NOT NULL,        -- chatGuid
  alias         STRING,                 -- "EDC squad"
  participants  ARRAY<STRUCT<handle STRING, name STRING, opt_in STRING>>,
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL
);

CREATE TABLE medha_pdw.events (
  tenant_id      STRING NOT NULL,
  event_id       STRING NOT NULL,       -- "MED-7K2A"
  group_id       STRING,                -- nullable for events outside a chat
  type           STRING NOT NULL,       -- "trip" | "rave" | "wedding" | ...
  title          STRING,
  start_date     DATE,
  end_date       DATE,
  status         STRING NOT NULL,       -- "planning" | "active" | "past" | "cancelled"
  organizer      STRING NOT NULL,       -- person_id of creator (decision 22)
  participants   ARRAY<STRUCT<person_id STRING, role STRING, rsvp STRING>>,
  itinerary      JSON,
  reservations   JSON,
  expenses       JSON,
  packing        JSON,
  commitments    ARRAY<STRUCT<commitment_id STRING, person_id STRING, item STRING,
                              status STRING, committed_at TIMESTAMP,
                              reminded_at TIMESTAMP, completed_at TIMESTAMP>>,
  created_at     TIMESTAMP NOT NULL,
  updated_at     TIMESTAMP NOT NULL
);
```

Event ID format: `MED-` + 4 chars from base32 alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/I/L/1). Re-roll on collision.

New helpers in `Newton/agent/lib/events.js`:

- `createEvent({groupId, type, title, ...}) → {eventId, ...}`
- `getEventByEventId(eventId)`
- `getEventsForGroup(groupId)`
- `addCommitment(eventId, {personId, item, source})`
- `updateCommitment(commitmentId, patch)`

`lib/tools/travel.js` becomes a THIN WRAPPER calling into `events.js` with `type: "trip"`.

**Acceptance:** creating a trip returns an Event ID. Lookup by Event ID returns the trip. Existing tests pass.

---

### Phase 3 — BigQuery PDW (medha)

Same shape as togari's [`src/pdw/`](/Users/joelnewton/togari-platform/src/pdw/). Phone-keyed, single tenant.

**Tables** (dataset: `medha_pdw`):

```sql
CREATE TABLE medha_pdw.persons (
  tenant_id       STRING NOT NULL,
  person_id       STRING NOT NULL,        -- sha256(lowercase E.164)
  primary_phone   STRING NOT NULL,
  phones          ARRAY<STRING>,
  emails          ARRAY<STRING>,          -- for future identity merging
  full_name       STRING,
  first_name      STRING,
  imessage_handle STRING,
  preferences     JSON,                   -- dietary, allergies, music, sleep, etc.
  commitment_stats STRUCT<kept INT64, missed INT64, total INT64>,
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL
);

CREATE TABLE medha_pdw.event_messages (
  tenant_id        STRING NOT NULL,
  event_id         STRING NOT NULL,
  message_id       STRING NOT NULL,
  group_id         STRING,
  from_person_id   STRING,
  direction        STRING,                -- 'inbound' | 'outbound'
  body             STRING,
  attachments      JSON,                  -- photos, voice
  sent_at          TIMESTAMP NOT NULL
);
```

Plus `groups` and `events` from Phase 2.

**Hot-path / cold-path** (per Caleb's reaffirmed BQ-from-day-one call):

- Hot path: JSON files in context repo (existing pattern). Agent runtime is synchronous, no BQ round-trip.
- Cold path: `Newton/agent/lib/pdw/ingest-orchestrator.js` flushes mutations to BQ every 60 seconds via the existing proactive-runner. Failures don't block the agent.
- Supabase mirror for the dashboard's Realtime needs (subset: `events`, `event_messages`).

Secrets needed:

- `GCP_PROJECT_ID` (shared with Togari is fine)
- `GCP_SERVICE_ACCOUNT_KEY` (separate SA for Medha — keep blast radius small)
- `MEDHA_BQ_DATASET=medha_pdw`

Files:

```
Newton/agent/lib/pdw/
├── phone.js                              — E.164 normalize, single source of truth
├── person-resolver.js                    — sha256(phone) → person_id
├── bq-client.js                          — singleton BigQuery client
├── ingest-orchestrator.js                — flush mutations to BQ
├── supabase-mirror.js                    — events + event_messages subset for SSE
└── types.js
sql/medha_pdw_init.sql                    — DDL for all tables
```

**Acceptance:** create event → BQ row appears within 90s. DM out → `event_messages` row. `SELECT * FROM persons WHERE primary_phone = '+1...'` returns the participant.

---

### Phase 4 — Conversational planner + event-type overlays

Two pieces.

**a) Intent + handshake routing** (`Newton/agent/lib/groups.js`):

Add a hot path before the LLM router:

- If group hasn't done handshake → route to `bootstrapping.handshake()`.
- If `dm_each_in_group` lexical pattern present → still goes through tool layer, but ensure prompt is set up.
- If trip-planning lexical intent (regex below) → set `tripPlanning: true` flag for the system prompt.

Trigger regexes (conservative; LLM is the final arbiter):

- `/\b(?:plan(?:ning)?|book|organize)\s+(?:a\s+)?(?:trip|getaway|vacation|fest(?:ival)?|rave|wedding|retreat|weekend|hike|roadtrip|event)\b/i`
- `/\blet'?s\s+(?:plan|go|do)\b/i` (broad — LLM decides)
- Explicit `"@medha"` or `"medha,"` followed by any of the above.

**b) Sub-prompt** in `Newton/agent/lib/prompts.js`:

When `tripPlanning: true`, inject:

```
GROUP COORDINATION MODE

You are driving a group conversation toward a complete plan. Move at the
group's pace. Don't dump the whole checklist. Ask one or two things at a
time. When you learn a fact, call `add_trip_item`. When someone commits,
call `add_commitment`. When two commitments conflict, surface to the
group with ONE line and let humans pick.

Event-type checklists live in /trip-overlays/<type>.js. Use the overlay
that matches event.type. Default to general.

Conversation rules:
- DM is for follow-up, group is for decisions.
- Confirm don't ask. "Noted, you've got speakers" beats "Should I add..."
- Tapback is a sentence. A heart-react is a complete acknowledgment.
- Default to silence. One reply per turn, often shorter than the trigger.
- For safety/harm-reduction: educate, never prescribe. Route specifics to
  experts (DanceSafe, medical pro). See decision 24.
```

**c) Event-type overlays** (`Newton/agent/lib/trip-overlays/`):

One module per type. Each exports:

```js
export const overlay = {
  type: "rave",
  starterQuestions: [
    "which festival/event + when?",
    "who's in (let's get RSVPs)?",
    "budget per person?",
  ],
  checklist: [
    {
      category: "tickets",
      items: ["official channel", "resale plan", "ID/passport"],
    },
    {
      category: "travel",
      items: ["rideshare/shuttle", "lodging near transit"],
    },
    {
      category: "gear",
      items: [
        "clear bag (check dimensions)",
        "earplugs (Eargasm/Loop)",
        "hydration",
        "charger",
        "cash",
      ],
    },
    {
      category: "safety",
      items: [
        "meetup point + time inside venue",
        "sanctuary location",
        "harm reduction basics",
      ],
    },
  ],
  defaultPackingTemplate: [
    /* ... */
  ],
};
```

Initial overlays to ship: `rave`, `wedding`, `retreat`, `wellness`, `roadtrip`, `general`. Adding new ones is trivial.

**Acceptance:** "let's plan EDC May 16" → Medha asks one clarifying question, not the whole checklist. Creates event. Subsequent messages incrementally populate via `add_trip_item`.

---

### Phase 5 — Commitment extraction + reminders

**Extractor** (`Newton/agent/lib/commitment-extractor.js`):

On every inbound group message during an active event, run Claude Haiku:

```
System: Extract commitments from group chat.
Context: last 6 messages
New message from <handle>: "I'll bring the speakers"

Output JSON:
  { commitment: true, item: "speakers", certainty: "concrete"|"vague",
    speaker: "<handle>" }
or
  { commitment: false }
```

Cheap (~$0.0001/msg). Only runs when event is `planning` or `active`. Idempotent on `(event_id, person_id, normalized_item)`.

**Conflict detection** (decision 21): after a new commitment is added, if another open commitment exists with the same `normalized_item` from a different person, post the one-line "heads up: X and Y both said speakers" in the group.

**Reminder schedule** (`Newton/agent/lib/proactive-runner.js`, extended):

Hourly tick. For each open commitment whose event starts within next 24h and which has `reminded_at IS NULL` AND the committer is `opted_in`:

- DM the committer.
- Set `reminded_at`.

12 hours later, if no reply, ONE follow-up. Hard cap: 3 outbound DMs to any person per event total (decision 28).

**Acceptance:** "I'll bring X" → commitment row in BQ within 30s. T-24h: DM arrives. Reply "yes" → group sees confirmation; commitment moves to `confirmed`.

---

### Phase 6 — Dashboard MVP (read-only)

Repo: [`amber-organization/medha-trip-planning`](https://github.com/amber-organization/medha-trip-planning).

Branding (decision 27): "Medha" big, "by Amber" small, "part of the Amber family" footer.

Stack (per global `CLAUDE.md`):

- Next.js 16 (App Router, TypeScript)
- Tailwind 4 + shadcn/ui + Lucide + Framer Motion 12
- Geist or Inter via `next/font`
- Slate/zinc-950 base + indigo accent
- Scroll-aware navbar (mandatory)
- iMessage bubble UI for transcript (outgoing = blue, incoming = zinc-800)

Routes:

```
/                              landing
/sign-in                       phone + send OTP
/sign-in/verify                OTP code
/home                          all groups + all events you're part of (decision 7)
/group/[groupId]               group view (members, alias, event list)
/group/[groupId]/event/[eventId]
  ├── (default)                overview: itinerary, participants, transcript
  ├── /packing                  packing list
  ├── /budget                   budget + who paid what
  ├── /people                   participants + roles + commitments per-person
  └── /transcript               full iMessage-bubble chat log
```

Auth flow:

1. User enters phone on `/sign-in`.
2. API issues 6-digit OTP, stores with 5-min TTL.
3. OTP delivered via Medha DM (uses `sendMessage`).
4. User enters OTP → JWT signed, scoped to `person_id`.
5. JWT verified on every API route. Returns only groups/events where `participants` includes this `person_id`.

Realtime (decision 20): subscribe to Supabase channel `events:<eventId>`. Pushes update the UI within ~2s.

**Acceptance:** Caleb visits the dashboard, signs in with his phone, sees all his events, opens one, sees the live chat transcript and itinerary.

---

### Phase 7 — Dashboard write + "Tell Medha"

Write surfaces:

- Drag-drop itinerary → `PATCH /api/event/<eventId>/itinerary`
- Packing checkboxes → flips commitment status to `completed`
- Per-participant page → edit display name, RSVP, dietary
- "Tell Medha" textarea (decision 23): posts to `/api/say-to-medha` with the user's JWT. The server constructs a synthetic message envelope `{ from: <phone>, group_id, body, source: "dashboard" }` and POSTs to the agent's inbound webhook. Agent processes as if it had come from iMessage. Medha replies in the group. Dashboard transcript updates via SSE.

JWT validation on every mutation. `person_id` must match the row being mutated for personal fields; organizer-only for event-level destructive ops.

**Acceptance:** Caleb drags an itinerary item earlier; persists across refresh; next group reply from Medha references new time.

---

### Phase 8 — Polish + the moat

Where Medha becomes inevitable. Each item is small once Phases 1–7 are in.

- **Cold-start brief** for new participants added mid-event.
- **Drift detection** — if group goes silent for 5 days with unresolved decisions, ONE nudge.
- **Cross-event memory** — "last EDC you forgot your charger" — surfaces during planning.
- **Photo journal recap** — post-event, collect "top 3 moments" per opted-in person.
- **Weather + venue enrichment** via existing Exa/Perplexity tools.
- **Health-dimension tagging** — itinerary items get `healthDimension` (existing six-dimension ontology per CLAUDE.md): sleep, joy, social, etc.
- **Calendar sync (decision 17)** — Google Calendar OAuth, Apple via CalDAV. Per-person opt-in.
- **Multimodal pipelines** (decision 13) — OCR for ticket photos, parser for screenshot itineraries, transcribe for voice.

---

## 5. File map (full branch)

New (agent):

```
Newton/agent/lib/
├── bootstrapping.js                       Phase 1
├── events.js                              Phase 2
├── commitment-extractor.js                Phase 5
├── trip-overlays/
│   ├── rave.js                            Phase 4
│   ├── wedding.js
│   ├── retreat.js
│   ├── wellness.js
│   ├── roadtrip.js
│   └── general.js
├── tools/dm-each.js                       Phase 1
├── pdw/
│   ├── phone.js                           Phase 3
│   ├── person-resolver.js                 Phase 3
│   ├── bq-client.js                       Phase 3
│   ├── ingest-orchestrator.js             Phase 3
│   ├── supabase-mirror.js                 Phase 3
│   └── types.js
└── __tests__/
    ├── dm-each.test.js
    ├── bootstrapping.test.js
    ├── events.test.js
    ├── commitment-extractor.test.js
    ├── person-resolver.test.js
    └── pdw-orchestrator.test.js
sql/medha_pdw_init.sql                     Phase 3
```

Modified (agent):

```
Newton/agent/lib/groups.js                 Phases 1 + 4
Newton/agent/lib/group-memory.js           Phase 1
Newton/agent/lib/tools/index.js            Phase 1 + 2
Newton/agent/lib/tool-dispatcher.js        Phase 1
Newton/agent/lib/prompts.js                Phase 4
Newton/agent/lib/proactive-runner.js       Phases 3 + 5
Newton/agent/lib/tools/travel.js           Phase 2 (now thin wrapper)
```

Dashboard repo (`amber-organization/medha-trip-planning`, Phases 6+7):

```
app/
├── page.tsx                                landing
├── sign-in/page.tsx
├── sign-in/verify/page.tsx
├── home/page.tsx
├── group/[groupId]/page.tsx
├── group/[groupId]/event/[eventId]/
│   ├── page.tsx                            overview
│   ├── packing/page.tsx
│   ├── budget/page.tsx
│   ├── people/page.tsx
│   └── transcript/page.tsx
└── api/
    ├── sign-in/route.ts
    ├── sign-in/verify/route.ts
    ├── event/[eventId]/route.ts
    ├── event/[eventId]/itinerary/route.ts
    ├── event/[eventId]/commitment/[id]/route.ts
    └── say-to-medha/route.ts
components/
├── EventHeader.tsx
├── Itinerary.tsx                           (dnd-kit drag-drop)
├── ParticipantList.tsx
├── Transcript.tsx                          (iMessage bubbles)
├── PackingList.tsx
├── BudgetView.tsx
├── SayToMedha.tsx
└── ScrollNav.tsx                           (mandatory scroll-aware)
lib/
├── bq.ts                                   (BigQuery client, read-only)
├── supabase.ts                             (Realtime subscriptions)
├── auth.ts                                 (JWT)
└── medha.ts                                (outbound webhook to agent)
hooks/
└── useScrollNav.ts                         (per CLAUDE.md pattern)
```

---

## 6. Storage architecture

**Hot path (synchronous):** JSON in context repo. Agent reads/writes during a message turn. Tenant-isolated per existing pattern.

**Cold path (async, every 60s):** BigQuery `medha_pdw`. Mutations flushed by `ingest-orchestrator.js`. If BQ is down, agent runtime unaffected.

**Realtime surface (dashboard only):** Supabase Realtime channels. Mirrors `events` and `event_messages` subsets for SSE. Updates pushed within ~2s of source event.

**person_id is the join key everywhere.** `sha256(E.164(phone))` is identical across `medha_pdw` and `togari_pdw`. When the Amber unification happens (decision 32, Phase 9+), the join is free.

---

## 7. Conversation design principles

These are inviolable. Every prompt-author and every tool-author reads these first.

1. **Default to silence.** The existing `groups.js` social governor is right. Trip planning never pushes Medha to over-speak.
2. **Confirm don't ask.** "Noted, you've got speakers" beats "Should I add..."
3. **DM is for follow-up, group is for decisions.** If the action is a private nag, DM. If it advances the group plan, post.
4. **Tapback is a sentence.** Heart-reacting "I'll bring speakers" is a complete acknowledgment.
5. **No checklists in chat.** Bullet-point dumps in iMessage are an AI tell. Structured stuff lives in the dashboard.
6. **Voice for warmth, sparingly.** Existing voice surface is for emotional moments, not every confirmation.
7. **Educate, never prescribe.** Harm reduction info shared freely. Specifics routed to experts (decision 24).
8. **Strict opt-in.** Never outbound-DM anyone who hasn't 👍'd the handshake (decision 14).
9. **Surface conflicts, don't resolve them.** Humans pick (decision 21).
10. **Group-size aware.** 4-12 = chatty + warm. 13-30 = focused. 30+ = mostly silent (decision 26).

---

## 8. The moat — why this becomes the future

Anyone can build TREK. Anyone can build a Telegram travel bot. The defensible move is:

1. **Medha already lives in iMessage.** Switching cost is zero.
2. **Medha already knows each person** (preferences, past trips, fitness, music, anxiety triggers).
3. **iMessage is Apple's walled garden** — a tailwind for native UX.
4. **DM-individual is a new shape of orchestration.** Group chat tools today are unidirectional. Medha's the first to fan out privately and aggregate back.
5. **Cross-event memory compounds.** Year-3 Medha plans better than Year-1 Medha for the same group, with no code changes.
6. **Embodied logistics is underserved.** Raves, festivals, retreats, weddings — high-coordination/high-emotion categories — are exactly where Medha's positioning is strongest.

Competitive matrix:

| Tool                | Has Medha's edge over it?                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| TREK                | Dashboard is solid, but no chat, no agent, no per-person memory           |
| Notion / Splitwise  | Dead documents, no proactive layer                                        |
| ChatGPT-Trip-GPTs   | No persistent memory across sessions, no group-chat hookup, no DM fan-out |
| Roam Around / Layla | One-off itinerary generation; no group, no commitments                    |
| WhatsApp/iMsg bots  | Group reply only; no per-person model; no dashboard                       |

Nobody on that list does the group ↔ DM pivot, the per-person commitment tracking, AND the dashboard. That's the wedge.

---

## 9. Smoke-test ladder

Every phase has one sentence Caleb can text to prove it works:

1. **Phase 1:** Adds Medha to a new group of 5. Some 👍. Texts "Medha remind everyone individually to exercise" — opted-in folks get DMs, others don't, group sees one-line confirmation.
2. **Phase 2:** "yo medha new trip: EDC Vegas May 16-18" → reply contains an `MED-XXXX` event ID.
3. **Phase 3:** `SELECT count(*) FROM medha_pdw.persons` returns > 0 within 90s of new participant.
4. **Phase 4:** "let's plan a rave this weekend" → planner asks one clarifying question; doesn't dump the whole checklist.
5. **Phase 5:** "I'll bring the speakers" → BQ commitment within 30s; T-24h reminder DM arrives.
6. **Phase 6:** Sign in at the dashboard with phone + OTP, see all events.
7. **Phase 7:** Drag itinerary item; persists; next group reply references new time. "Tell Medha" textarea posts a synthetic group message.
8. **Phase 8:** Add new participant mid-event → cold-start brief DM arrives within 60s.

---

## 10. Build order + estimated effort

| #   | Phase                                | Effort   | Unblocks                       |
| --- | ------------------------------------ | -------- | ------------------------------ |
| 1   | Handshake + `dm_each_in_group`       | 1 day    | the smoke test                 |
| 2   | Group/Event schema + Event IDs       | half day | dashboard, commitments         |
| 3   | BigQuery PDW                         | 1-2 days | dashboard analytics            |
| 4   | Conversational planner + overlays    | 1 day    | the killer demo                |
| 5   | Commitment extractor + reminders     | 1 day    | "future of trip planning" feel |
| 6   | Dashboard read + OTP                 | 2 days   | shareable artifact             |
| 7   | Dashboard write + "Tell Medha" + SSE | 1 day    | full loop                      |
| 8   | Polish + moat features               | rolling  | the moat                       |

About 8 focused build days for Phases 1-7. Phase 8 is rolling.

---

## 11. Operational concerns

### Cost (per active group of 8, per month)

- Claude Haiku for commitment extraction: ~$0.05
- BQ storage + queries: < $0.01 at this scale
- iMessage outbound (Loop): existing cost, unchanged
- Net: trip planning adds < $1/group/month at v1 scale

### Privacy

- Phone numbers are PII. Stored raw in `persons.primary_phone`, gated by service account. Person_id is the public-ish surface.
- Dashboard never exposes other participants' raw phone numbers. Names only.
- "STOP" reply universal mute (decision 14). User can text "delete me" → trigger deletion flow (manual review for v1, automated later).

### Rate limits + abuse (decision 31: open from day one)

- Per-phone outbound rate limit: max 10 DMs/hour, 50/day. Configurable.
- New group bootstrap: max 5 new groups/phone/day. Beyond that, Medha asks "you're starting a lot of new groups, want me to slow down?"
- LLM spend cap: per-tenant daily budget. Soft-degrade to silence when exceeded.

### Failure modes

- **BQ down:** agent runtime unaffected. Mutations queued to local disk, flushed on recovery.
- **iMessage send fails:** `dm_each_in_group` returns `failed[]`; LLM tells group "couldn't reach Tom, want me to try again?"
- **Commitment extractor false positive:** validator gate against item-vocab; tapback-thumbs-down on confirmation un-commits.
- **Two AI agents in same group (Camber + Samber):** existing social governor handles. New planner respects governor's silence verdicts.

### Telemetry

- `tool_calls` table (existing) gets `dm_each_in_group` rows.
- Custom metric: `commitments_open / commitments_closed` per active event.
- Dashboard view: per-phase smoke-test pass/fail history.

---

## 12. Open operational questions (NOT blocking build)

These are launch/marketing questions for later, not architecture:

1. Where do we publish the Medha phone number? Dashboard landing only? medha-trip-planning.vercel.app footer? A separate medha.ai landing?
2. Initial rate-limit thresholds: tuned conservatively or generously?
3. Manual review queue for "delete me" requests in v1, then automated?
4. Should we have a dedicated `support@medha` email for issues?

---

## 13. Glossary

- **Event ID** — short human-shareable code (`MED-7K2A`). Used for dashboard sign-in references.
- **Event** — anything you'd plan with a group: trip, rave, wedding, retreat, study session, watch party. Decision 5.
- **Group** — the durable iMessage chat (chatGuid + alias). Holds many events over time. Decision 2.
- **person_id** — `sha256(E.164(phone))`. Stable across all Medha tables AND `togari_pdw`. Decision 19.
- **Tenant** — `"medha"` (single value v1). Used for tenant_id column. Future: per-product.
- **Commitment** — "I'll bring/book/handle X" extracted from chat. Concrete OR vague (decision 9).
- **PDW** — Person Data Warehouse. BQ-backed analytical mirror. Term lifted from togari.
- **Hot path / cold path** — synchronous agent runtime (JSON files) vs async BQ mirror.
- **Group echo** — the one-line confirmation Medha posts in a group after a fan-out DM.
- **Opt-in handshake** — first-touch DM-consent ritual (decision 14). Strict: 👍 or "YES" required.
- **Smoke-test ladder** — the per-phase single-sentence acceptance tests in §9.

---

## 14. Status

- 32 architectural decisions LOCKED (§1).
- 0 lines of code written on this branch.
- Phase 1 ready to start.

Next move: I write `lib/bootstrapping.js` + `lib/tools/dm-each.js` + the group-memory `opt_in_status` extension + their tests. Smoke test: handshake + DM fan-out + group echo. End-to-end pass on a real iMessage group of 4-5 people.

_Ship Phase 1, hit the smoke test, then move to Phase 2._
