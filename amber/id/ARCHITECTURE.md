# Amber ID: Full Architecture

---

## System Overview: From Onboarding to App Store

```
╔══════════════════════════════════════════════════════════════════════════╗
║                    COMPLETE AMBER DATA ARCHITECTURE                     ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║  USER ONBOARDING (amber-ios)                                            ║
║  ┌────────────────────────────────────────────────┐                     ║
║  │ Collects immutable characteristics:             │                     ║
║  │ • Birthday, birth time, birth location          │                     ║
║  │ • Alma mater, hometown, current city            │                     ║
║  │ • Personality profiles (MBTI, Enneagram, Big5)  │                     ║
║  │ • Privacy tier selection                        │                     ║
║  └─────────────────────┬──────────────────────────┘                     ║
║                        │                                                 ║
║                        ▼                                                 ║
║  ╔════════════════════════════════════════════════════════╗              ║
║  ║            AMBER SHIRLEY ID (this repo)                ║              ║
║  ║                                                        ║              ║
║  ║  ┌──────────────────────────────────────────────────┐  ║              ║
║  ║  │  LAYER 1: PRIVY AUTH + BLOCKCHAIN IDENTITY       │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  Privy.io                                        │  ║              ║
║  ║  │  ├── Social login (Google, Apple, Email)         │  ║              ║
║  ║  │  ├── Embedded Solana wallet (non-custodial)      │  ║              ║
║  ║  │  └── JWT tokens for all interface auth           │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  Solana Blockchain                               │  ║              ║
║  ║  │  ├── Compressed NFT (cNFT) per user              │  ║              ║
║  ║  │  ├── Immutable profile data on-chain             │  ║              ║
║  ║  │  ├── Content hash for profile integrity          │  ║              ║
║  ║  │  └── User owns their identity (portable)         │  ║              ║
║  ║  └──────────────────────┬───────────────────────────┘  ║              ║
║  ║                         │                               ║              ║
║  ║                         ▼                               ║              ║
║  ║  ┌──────────────────────────────────────────────────┐  ║              ║
║  ║  │  LAYER 2: KNOWLEDGE BASE (Pinecone)              │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  amber-knowledge-base wiki                       │  ║              ║
║  ║  │  ├── Company knowledge (BMA, Rytual)             │  ║              ║
║  ║  │  ├── Project documentation                       │  ║              ║
║  ║  │  ├── Decision logs and concepts                  │  ║              ║
║  ║  │  └── Markdown → embeddings → Pinecone            │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  User-specific vectors                           │  ║              ║
║  ║  │  ├── Contact graph + relationship memory         │  ║              ║
║  ║  │  ├── Conversation histories                      │  ║              ║
║  ║  │  ├── Calendar events + meeting notes             │  ║              ║
║  ║  │  └── Behavioral patterns + preferences           │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  RAG Pipeline                                    │  ║              ║
║  ║  │  ├── Query → embed → search Pinecone             │  ║              ║
║  ║  │  ├── Retrieve top-k relevant contexts            │  ║              ║
║  ║  │  └── Feed to Claude for grounded AI responses    │  ║              ║
║  ║  └──────────────────────┬───────────────────────────┘  ║              ║
║  ║                         │                               ║              ║
║  ║                         ▼                               ║              ║
║  ║  ┌──────────────────────────────────────────────────┐  ║              ║
║  ║  │  LAYER 3: ENTERPRISE ENRICHMENT (PeopleRank)     │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  Togari PeopleRank API (external, via BMA)       │  ║              ║
║  ║  │  ├── People search across web + databases        │  ║              ║
║  ║  │  ├── Contact scoring and ranking                 │  ║              ║
║  ║  │  ├── Company intelligence                        │  ║              ║
║  ║  │  └── Relationship strength signals               │  ║              ║
║  ║  │                                                  │  ║              ║
║  ║  │  Enrichment Flow                                 │  ║              ║
║  ║  │  ├── iOS pushes contact graph → Shirley ID       │  ║              ║
║  ║  │  ├── Shirley ID calls PeopleRank for enrichment  │  ║              ║
║  ║  │  ├── Enriched data → Pinecone vectors            │  ║              ║
║  ║  │  └── Signals generated for iOS suggestion feed   │  ║              ║
║  ║  └──────────────────────────────────────────────────┘  ║              ║
║  ╚════════════════════════════════════════════════════════╝              ║
║                        │                                                 ║
║                        │  Unified API exposed to all interfaces          ║
║                        │  Auth: Privy JWT on every request               ║
║                        │                                                 ║
║           ┌────────────┼────────────┬────────────┐                      ║
║           ▼            ▼            ▼            ▼                       ║
║      amber-ios    amber-voice  amber-visionOS  rytual-*                 ║
║      (App Store)  (iMessage)   (Vision Pro)    (web/admin)              ║
║                                                                         ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║  PARALLEL SYSTEMS (not part of Shirley ID, but connected)               ║
║                                                                         ║
║  amber-caleb-api                 rytual-sagar-mcp                       ║
║  ├── iMessage agent logic        ├── MCP tool orchestration             ║
║  ├── AI tools + automation       ├── Perplexity Computer interface      ║
║  ├── Photon/Spectrum SDK         ├── Tool registry + routing            ║
║  └── D1 networking               └── Evaluates caleb-api features       ║
║                                                                         ║
║  Togari PeopleRank (Blue Modern Advisory — separate business)           ║
║  ├── People search API                                                  ║
║  ├── Contact enrichment                                                 ║
║  └── Updated independently, consumed via API                            ║
║                                                                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## How This Gets to the App Store

### Step 1: amber-id deploys as the backend
- Fastify API server on GCP Cloud Run (or Railway)
- PostgreSQL database (Cloud SQL or Supabase)
- Privy.io handles all user auth
- Pinecone handles all knowledge storage and RAG
- PeopleRank API called for contact enrichment

### Step 2: amber-ios connects to amber-id
- iOS app calls Shirley ID API for auth, profiles, knowledge, enrichment
- Onboarding flow collects immutable data → sends to Shirley ID → mints cNFT
- Contact graph sync → Shirley ID → PeopleRank enrichment → Pinecone storage
- AI chat grounded in RAG from Pinecone (not hallucinated)
- Signal feed driven by enriched data from all three layers

### Step 3: Other interfaces connect the same way
- amber-voice authenticates via Shirley ID, queries knowledge base for memory
- amber-visionOS authenticates via Shirley ID for any Amber features
- rytual-arnav-website sign-up flows through Shirley ID Privy auth
- rytual-matthew-admin auth and data access through Shirley ID

### Step 4: App Store submission
- amber-ios is a pure SwiftUI client (no backend code bundled)
- All backend logic lives in amber-id (deployed separately)
- Privacy policy references Shirley ID's tiered privacy system
- Data handling compliant with App Store guidelines (user controls their data)

---

## Data Flow Between Repos

```
amber-knowledge-base (wiki markdown)
    │
    │  ingest.ts reads wiki, generates embeddings
    │
    ▼
Pinecone (vector DB)  ←──  user data from onboarding
    │                  ←──  contact graph from iOS
    │                  ←──  conversation memory from voice
    │
    │  RAG query returns relevant context
    │
    ▼
amber-id API (unified backend)
    │
    ├── /auth/*        — Privy JWT verification
    ├── /identity/*    — cNFT minting and verification
    ├── /knowledge/*   — RAG queries against Pinecone
    ├── /profile/*     — User profile CRUD
    ├── /onboarding/*  — Immutable data collection
    ├── /signals/*     — Suggestion feed generation
    ├── /contacts/*    — Contact graph management
    ├── /circles/*     — Social circles
    ├── /internal/agents/group-chat/decide — Group-chat social governor
    │                    (rules: respond-only-if-addressed, hard shutdown
    │                     guard for "shut up" / "chill", forbidden topics,
    │                     image-passthrough mode, casual-greeting reset
    │                     (short_greeting + contextPolicy=reset_topic, only
    │                     primary co-mentioned agent replies),
    │                     multi-addressed multi-intent (each named agent
    │                     answers its own clause via currentAgentClause)).
    │                     amber-agent calls before generating any reply in
    │                     a multi-party chat.
    └── /enrichment/*  — PeopleRank contact enrichment
         │
         └── calls Togari PeopleRank API
              (external, managed by Blue Modern Advisory)
```

### Phone OTP delivery failures

`POST /v1/auth/otp/request` and `POST /v1/auth/start` return HTTP 503
with `error: "delivery_restricted"` when Photon rejects the recipient with
"Target not allowed for this project". This requires checking the configured
Photon project's recipient permissions and sending line; retrying or changing
the verification code cannot resolve it. Provider details remain in server logs.

The production dedicated sender is configured with `MEDHA_SENDER_PHONE`; sends
and opt-in links use that same line. Photon connections are initialized once
even under concurrent requests. Successful DM routing is cached per recipient
and cleared on connection reset. OTP logs include storage and delivery timing
without phone numbers or codes.


## Private mobile journal capture (September 21, 2026)

The redesigned mobile Calendar records into the existing Cloud SQL
`conversations` / `conversation_messages` tables used by Main. This is the
current runtime, as implemented by `src/index.js`; historical overview sections
above describe older services and are not authoritative for this route.

`PUT /v1/me/journal/:id` accepts `{ text, voice, createdAt }` and returns
`{ ok, conversationId, createdAt, created }`. Authentication is mandatory and
ownership comes only from the authenticated session. The UUID is a retry key,
not an ownership claim. A transaction creates a `kind=note` conversation and
its original user message once. Replaying matching input returns the existing
memo; an unowned, deleted or conflicting ID returns 409. The timestamp is UTC
and cannot be more than five minutes in the future. No new schema is required.
Saving does not run extraction, share, notify, or create calendar events.

After confirmation, mobile uses Main's existing `/v1/me/notes/:id/audio`
upload-url → signed PUT → finalize sequence, where `id` is the conversation
UUID. Contact-note row IDs from `/v1/me/contacts/:contactId/note` are distinct
and must never be passed to the conversation audio endpoints.

`GET /v1/conversations/:id` includes optional original `audio` metadata and
`ownerId` derived from the caller, in addition to messages. Only ready audio is
exposed. Playback still obtains a fresh signed URL via the existing note-media
route, which rechecks access. Neither storage keys nor signed URLs are returned
in conversation history. These additions are backward compatible with Main.

Tests: `node --import ./scripts/test-env.js --test src/routes/journal.test.js
src/routes/journal-playback.test.js`. Journal save/replay/conflict and tenant
isolation were also checked against local PostgreSQL with the actual migration
tables on September 22. Production acceptance through the signed-in simulator
also passed: private save, idempotent retry, original transcript restoration,
signed AAC upload/finalize, audio metadata restoration and signed download.
The synthetic silent clip and temporary conversation were removed afterward.

## Connected mobile Community and Calendar (September 22, 2026)

The redesigned Community uses existing saved circles (`/v1/me/circles`) for
Family, Friends, Romance, Work, School and Exercise. Categories start empty;
the client only writes membership after an explicit edit. Selecting an active
category again returns to all contacts. Nearby currently filters saved contact
cities against a user-editable city, not live GPS proximity.

`GET /v1/me/contact-ranks` returns every non-deleted owned contact and its
existing derived `contact_scores.base_score` and `computed_at`. The SQL join
scopes both contact and score to the authenticated owner. It does not call a
model or recompute scores. Mobile orders computed ranks descending and puts
unscored contacts afterward. `/v1/me/contacts/:id/rank` remains the source for
the card's existing six-dimension breakdown; missing evidence is not invented.

`GET /v1/me/contacts/:id/details` exposes a whitelist of imported contact fields
from owned contacts, including addresses, birthday, URLs and relationships.
Private ingestion bookkeeping is not returned. Full contact notes remain in
the existing contact response. The profile facts route now includes retained
expired/decayed observations without a ranking limit; ranking reads keep their
separate decay and retrieval rules. Mobile accepts the existing `text`,
`fact_text`, source conversation and timestamp fields and links original memo
sources to authorized playback.

Calendar reuses Main's agenda, calendar accounts, OAuth, calendar sync, event
detail and signed audio routes. The mobile account sheet awaits sync before
refreshing the agenda and displays failed account/sync requests. Shared updates
can be requested through `GET /v1/me/feed?from=...&to=...`, a half-open UTC
window of at most 62 days. Omitting both parameters retains Main's behavior.
The share timestamp remains the timeline timestamp. Authentication and share
visibility filtering are unchanged. Conversation summaries expose `kind` so
notes and voice recordings appear in Calendar without treating web chats as
memos. No schema migration or new service credentials are required.

Deployed successfully to the existing production Amber ID service as Railway
deployment `d66b49a6-aa4a-4622-8469-5efeee48492d` on September 22, 2026.
Authenticated read acceptance returned 2,267 contacts (2,255 scored), six rank
dimensions and complete profile facts. Agenda, daily conversations, shared
feed, circles and calendar accounts all returned HTTP 200. This test account
has no calendar accounts connected yet; calendar provider OAuth/device calendar
permission must be completed before external events can populate the timeline.

## Responsive mobile capture and Google Calendar repair (September 23, 2026)

The center capture button accepts voice, text, images, documents and bounded file
exports. `POST /v1/me/capture/read` requires the existing owner session and reads
an attachment up to 8 MB (12 MB request limit); UTF-8 text exports are decoded
locally on Amber ID, and documents/images use the existing OpenAI credential.
`POST /v1/me/capture/prepare` produces draft actions from at most 32,000 characters
and 50 candidate contact names/IDs. It has no tools and performs no identity
writes. Both routes are rate limited. The client reviews each action, then uses
Main's owned contact fact, calendar event, or active Amber ID chat routes. Original
files remain in device storage; the extracted private journal text uses the
existing journal endpoint. Recorded audio continues using signed audio uploads.

Google OAuth accepts `purpose=calendar` to request only identity and Calendar
scopes. The default Google connector retains Main's broader Gmail/Drive/Contacts
consent. Mobile verifies the exact callback and stored calendar accounts and
awaits sync before showing success. `POST /v1/me/calendars/restore-google` explicitly
recovers a missing account from the authenticated owner's existing GCAL grant;
ordinary sync does not resurrect disconnected accounts. Google sync pages all
selected calendars, expands recurring events, preserves primary event IDs and
namespaces secondary IDs, and stores all-day boundaries using the calendar's
IANA time zone. Locations/descriptions are retained and cancellations need no
start date. No new migration or service credential is required.

Amber Alert targets one saved circle selected by the user through the existing
note-share route. Its seven visible audience options are Family, Friends,
Romance, Work, School, Exercise and Nearby. Nearby cannot be sent until recipient
location/opt-in support exists; it never falls back to broadcasting to everyone.
Calendar and Community stay mounted across tab switches. Rock drag feedback runs
on the UI thread, contact rendering is memoized, and capture contact pickers are
bounded rather than mounting the entire address book.

Validation: 23 focused mobile tests and TypeScript passed. The backend suite had
1,634 passing tests and 45 intentional skips; its local-port boot check and SQL
parser check passed separately after supplying the required local permissions
and existing ESLint dependency. Calendar writes were also checked against actual
local migration tables: update idempotency, all-day/location/description fields,
start-less cancellations and owner isolation. Live acceptance follows deployment.

Live acceptance on September 23: Google account present, completed sync with no
last_error, and 199 agenda events in September. Text/PDF extraction and valid
synthetic voice transcription returned 200. Contact extraction now explicitly
keeps stated preferences. Private notes do not invoke note sharing. The former
medha-platform agent hostname is no longer served; mobile capture uses existing
`POST /v1/chat` for research/drafting, not computer execution or external sends.
The UI distinguishes those limits.


## Reviewed memo retries and transcript corrections (September 24, 2026)

Contact-note and calendar-event POST routes accept an optional UUID `requestId`.
Mobile hashes the memo identity plus exact reviewed action; Amber ID scopes that
key to the authenticated owner and destination, then uses the resulting UUID as
the existing observation/event primary key. Concurrent retries insert one row.
The same identity with changed content, an existing deleted row, or a mismatched
owner is refused rather than overwritten. Existing clients without requestId
retain their original contract. No migration or new credentials are needed.

The keyed contact-note path returns after its durable, dimension-classified note
transaction. Additional structured extraction runs best-effort in the background
and is skipped on replay. It is not a durable job queue; note persistence does
not depend on that enrichment completing. Calendar actions remain Amber calendar
events; this does not imply a Google Calendar write-through.

`PATCH /v1/me/journal/:id` accepts `{text, previousText}` on owned, live journal
messages only. It compares the previous text under a row lock, accepts replay of
the same new text, refuses stale edits, and retains the first transcript in message
metadata. Retrying the original PUT after correction remains safe and returns the
current text; it never restores the original over a correction. Audio and dates
are preserved. Mobile sync tracks the acknowledged transcript separately from the
original and never claims an unconfirmed edit was backed up.

Validation: focused mobile audio/transcript/action tests, route auth/retry tests,
and actual local PostgreSQL concurrent inserts/corrections passed. The local
PostgreSQL lacks pgvector, so its untouched nullable embedding column used real[]
for this acceptance; tested primary keys, owner FKs, transactions and statements
use migration-defined SQL. Deployment and authenticated production acceptance
must be completed before the new optional requestId/PATCH clients are enabled.

## Sagar beta: confirmed Google Calendar creation

Authenticated `POST /v1/me/google-calendar-events` requires an explicit connected
Google `accountId`, UUID `requestId`, title, and offset-bearing start/end instants.
It creates a non-recurring timed event in that account's primary calendar, without
guests, then upserts the same provider event into Amber using the inbound-sync
key. Credentials stay in Amber ID. Deterministic Google IDs and a private payload
fingerprint recover lost replies and mirror failures without duplicate events.
An existing request with changed content or a cancelled provider event returns
409. Provider or local-sync failure is never represented as success. Existing
`/v1/me/calendar-events` remains the explicit Amber-only manual event API.
The OAuth callback base must be the current public Amber ID domain in
`MEDHA_ID_PUBLIC_URL`, also registered on the Google OAuth client.

### Contact name projection (Sagar beta, October 2, 2026)

`GET /v1/me/contacts` preserves the owner's recorded `full_name`, falling back to
structured first/last name and then the linked account's real name. Linked account
IDs remain identity references; usernames never replace contact names. This read
no longer applies corpus-based name shortening; stored names and tags are unchanged.

### Voice memo navigation (Sagar, October 2026)

`GET /v1/me/journal` lists the authenticated owner's recordings in pages of 40,
using the first user message's timestamp. Optional `from`/`to` define a half-open
window; `before`/`beforeId` are the returned keyset cursor. The response contains
`conversations` with `createdAt` and `next` (cursor or null). Opening a memo still
uses the existing conversation/audio endpoints. Replies never move the original
recording to another date. Explicitly typed notes are excluded; legacy note
threads with unknown capture type remain visible. No Google Calendar reads,
contact enrichment, or model calls occur while listing recordings.

## Clay people search (October 4 beta)

JWT-scoped `POST /v1/me/clay/search` accepts `{requestId: UUID, query}`.
The validated query compiler preserves supported name, role, company, location and
profile keyword criteria; unsupported requests fail explicitly. Clay Public API
query-mode runs once with limit 10, with no automatic retry or pagination.
`POST /v1/me/clay/enrich` accepts `{requestId, searchId, personId, action}`; actions
are profile, email and phone. Only a person from the caller’s stored search may
be enriched. Work email requires a previously enriched company domain.
`GET /v1/me/clay/jobs/:id` polls only the caller’s job and returns status/results.
Durable `clay_jobs` reservations prevent duplicate paid dispatch under the same
request ID, with transaction-serialized admission capped at 20 jobs per owner
and 100 globally per rolling 24 hours. No provider POST is retried after an
ambiguous timeout; a stalled pending job requires operator reconciliation.
Results do not silently overwrite saved contacts. Server-only `CLAY_PUBLIC_API_KEY`
belongs to Blue Modern Advisory; never distribute it in an app binary.


## People / Plans memo flow and global search — October 4, 2026

- `POST /v1/me/discovery/search` accepts authenticated `{requestId,query,scope:people|plans}`. Uses Perplexity Search API directly, max 10 source results. People results must be individual LinkedIn profiles; no invented names/contact details or dates. Server-only `PERPLEXITY_API_KEY` required; no silent Clay/Exa fallback.
- Results use the existing owner-scoped search job store and beta quotas. `GET /v1/me/discovery/jobs/:id` resumes reads without another provider call. Clay enrichment remains an explicit action against a result belonging to that owner.
- `POST /v1/me/capture/prepare` adds bounded `objects:{people,places,plans}` and `place`/`personName` on action drafts. Incomplete plans return `needsTiming:true`; clients must clarify rather than invent a date. Places attach as context tags; recording alone does not mutate contacts or calendars.
- `GET /v1/me/memo-plans?q=...` returns up to 20 matching saved plans, owner-scoped, without triggering Google sync. `PATCH /v1/me/memo-plans/:id` requires a selected version plus reviewed fields. Capture plans use compare-and-update; Google plans check remote fields and use If-Match, retaining unrelated fields. Primary and namespaced secondary calendars are supported. Recurring and all-day Google events require their provider editor. No attendee additions or invitation actions.
- New Google plans keep the existing idempotent write-first/mirror-second endpoint, now receiving the reviewed place. A failed mirror is not reported as a completed update.
- Structured memo sorting is cached with the account-isolated local memo index; the original transcript/audio and conversation continue using cloud journal storage. Cross-device structured-object hydration remains a follow-up.

### Reviewed plan memo associations (October 4, 2026)
`POST /v1/me/memo-plans/:id/memos` accepts requestId, conversationId, text and explicit contactIds. It verifies ownership of the event, memo and each contact before inserting an idempotent observation linked to the source recording. Event participants are additive; no event, contact, existing participant or provider field is removed. These are private associations, not invitations or Google guest updates. Agenda events now return a `people` array. The owner remains the personal calendar context.

`POST /v1/me/health-summary` requires explicit consent, a stable requestId and a bounded daily summary. It appends a private self observation with Apple Health provenance in the body, no contact participants, no event creation, no automatic dimensions, and no model invocation. Raw Health samples never leave iOS. No permission grant alone uploads data.

Calendar write-back responses without an attendee list no longer clear participant rows. Full provider refreshes preserve reviewed memo associations (observation source conversation + explicit participant), while retaining existing provider-removal semantics for other attendees.

## October 5 MVP search and enrichment update

People and Plans global discovery uses Exa through the existing owner-scoped discovery job contract, capped at ten results. Jobs persist request IDs to prevent duplicate provider dispatch. POST `/v1/me/discovery/jobs/:id/people/:personId/save` saves only an owned completed People result using the existing contact identity resolver and source provenance. Conflicting LinkedIn URLs require review.

Clay enrichment accepts either an owned contactId or owned searchId/personId. New clients expose exactly work_email, personal_email, mobile_phone, and linkedin; legacy action aliases remain for installed betas. POST `/v1/me/clay/jobs/:id/apply` explicitly applies completed results to the matching owned contact, adds emails/phones, preserves primary phone and unrelated enrichment, and rejects conflicting profile URLs. No new schema or destructive migration. Apple Contacts writes remain explicit client actions with identity matching and duplicate ambiguity rejection.

Photon callback logging no longer records authentication headers, callback query secrets, or raw message bodies. Its transport still requires a shared callback secret and linked DM account. Voice-message acceptance remains separate from text transport and must be validated before release claims.

### People discovery refinement (October 6, 2026)
The iOS Plans search is local only; global discovery is exposed only on People. Older discovery jobs remain readable. Work email and mobile lookups can resolve missing employer context from the exact Exa LinkedIn profile via Clay's Enrich person routine. Only a unique current employer is accepted. An atomic job-stage claim prevents concurrent polling from dispatching the paid second lookup twice; uncertain dispatch failures are not retried automatically. Verified profile context is returned with lookup results and applied only on explicit save, filling empty employer/title fields without replacing existing values. A completed provider run with no field is an empty result, not a discovered email.
The self profile refreshes cached data on opening; its Sources tab reads account connections, imported contact counts and journal history. These are separate from contact provenance. Photo permission alone does not import the library; Apple Messages history is not imported.

### Isolated App Review account (October 2026)

The existing six-digit phone sign-in UI supports one reserved fictional number,
+14085550186. It is disabled unless APP_REVIEW_AMBER_ID, APP_REVIEW_CODE_HASH,
APP_REVIEW_CODE_SALT and APP_REVIEW_EXPIRES_AT are valid. Only a pre-seeded user
with an isolated appReview marker and matching credential hash can authenticate.
Both verification endpoints share a database row lock and a persistent budget of
20 failed attempts per credential; requesting another code never resets it.
No SMS/iMessage or social identity linking occurs for this account. Access tokens
and refreshes stop working on expiry or disabled configuration. Sessions use the
ordinary owner-scoped APIs, with synthetic contacts and plans in a separate owner
namespace. Review credentials are provided privately in App Store Connect.

### Personal MCP connections (2026-10-06)

POST /v1/me/api-keys accepts purpose: mcp (default remains ingest). MCP keys use
ambermcp_live_ and cannot authenticate contact-ingest or service/admin routes.
Existing ingest keys are not accepted by MCP. Keys are hashed, owner-scoped and
revocable through the existing API-key routes. Temporary review accounts cannot
create persistent keys. MCP authenticates the live account on each request.
Owner-bound MCP tools reject another DID before resolving data. The arbitrary-phone
dashboard/session tool is not exposed to owner-bound connections. Trusted unbound
service keys and local stdio retain their existing explicit-owner semantics.

MCP search_plans reads owner-scoped scheduled actual/planned events, supports bounded
text/date filtering and reports data failures as errors. Device-only Apple events
are not claimed as synced. It never writes a calendar or performs web search.

GET/POST/DELETE /v1/me/imessage-link also return available and unavailableReason,
reporting transport configuration and beta admission separately from user consent.
This does not change or bypass the webhook admission policy.


## Typed mobile web discovery (October 6, 2026)

POST /v1/me/discovery/search uses the existing server-side EXA_API_KEY only.
`scope: people` presets Exa category `people` and returns individual LinkedIn-backed
cards. `scope: plans` presets category `places`, requires `location` (city, optionally
region/country), and returns source-backed physical places with addresses, never
calendar events or invented dates. Exa fast search caps results at ten; places use
outputSchema to distinguish actual places from generic webpages. Source URLs,
locality, result types and duplicate identities are checked before returning.
People can be explicitly enriched through Clay and saved. A place can open Maps
or an editable plan draft; the user supplies/reviews the date before saving.

Only the public query and chosen city leave Amber ID. Private contacts and calendar
records are not sent. No Perplexity credential or silent provider fallback is used.
Existing Exa and Perplexity jobs remain readable. Owner-bound request IDs prevent
repeat charges when resuming a search. The provider deadline is 15 seconds, shorter
than the mobile request deadline. Completed results are cached within the open
sheet for five minutes. Older pending jobs report failure after two minutes.


## Onboarding voice context (October 7, 2026)
Three optional prompts (family, nearby, priorities) reuse the private journal and original-audio upload. `GET /v1/me/onboarding-context` and `PUT /v1/me/onboarding-context/:prompt` resolve the authenticated DID and validate ownership of the saved memo and every selected contact. The write atomically merges only one key in `users.profile_extra.onboardingVoice`; no schema migration or destructive contact overwrite occurs. Only user-confirmed contact links affect the initial network rank. The bounded additive cold-start contribution decays over 30 days, with an explicit base score, boost, and reasons in `/v1/me/contact-ranks`. Categories describe the owner's stated goals, not inferred traits of other people. Raw recordings remain private journal sources, not model training data.

## October 7 contact reuse

Discovery save accepts an optional `appleExternalId` after the client explicitly selects and syncs an Apple card. The owner-scoped source mapping must already exist; otherwise it returns 409 without inserting. Existing LinkedIn profiles are matched across www/trailing-slash variants. Conflicting identities remain reviewable instead of being overwritten. Clay field unions normalize phone/email values while retaining existing formatting.

## Selective live Amber card and import review
Authenticated `GET/PUT /v1/me/amber-card` resolves DID to the existing owner and updates only `profile_extra.amberCard`. A stable random token identifies the public HTML, JSON and vCard at `/card/:token`. Publication is opt-in; the public projection contains name, bio and enabled links only. Disabling publication returns 404. Updates use optimistic concurrency and a row lock. No memo, graph or integration information enters this projection.
`POST /v1/me/capture/contact-preview` parses vCards through the existing parser, or extracts only visible business-card details with the existing capture model. It never writes contacts. The iOS review then saves additively to a selected Apple contact and syncs that exact card through the existing owner-scoped Apple importer, preserving its external ID and identity resolution/PeopleRank invalidation path.

The Photon DM adapter now reads the same owner-scoped relationship retrieval and memory search used by the app, plus an allowlisted self-profile and a seven-day calendar window for day questions. Reads start alongside intent classification. Group replies never receive this private context. Phone admission and explicit Texting Amber consent remain required; no notification cadence or new transport was added. Calendar actions are not claimed by this read-only adapter.
