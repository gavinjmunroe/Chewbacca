# Calendar, voice, circles, and contact enrichment — October 3, 2026

## Verified in this iteration

The floating voice-memo target is removed. The center + is a native press into the recorder. The community rock sits outside the graph pan/pinch gesture surface and opens Amber Alert, Family, Friends, Romance, Work, School, Exercise, and Nearby. Selecting the active circle again returns to All. The full-screen frosted backdrop stays behind the crisp radial controls.

The latest user direction replaces Events + Voice memos with **voice memos only**. Calendar dates navigate recordings; selecting a date collapses the month into its week. All recordings removes the date filter. The original recording date remains fixed when replies are added. There are no Google imports, event feed tabs, connection controls, or background calendar sync on this screen. Explicit Add to Google Calendar remains inside memo actions for an already-connected account.

New transcribed recordings queue a people/planning query after authenticated transcript storage succeeds, while original audio uploads independently. Responses stream into the same memo, with tappable known contacts and a continuation field. Completed/failed/interrupted queries do not automatically rerun when history opens. Transcript edits must save before querying. The second automatic action-preparation request is disabled; manual suggestions and confirmed contact/calendar actions remain available. Model answers distinguish proposed gatherings from recorded hosting context.

`GET /v1/me/journal` is a new owner-scoped, 40-item paged recording endpoint: one query, no per-row conversation/contact fetches. Recording timestamps, half-open local date windows, and full-precision keyset cursors keep history stable. Detail/audio load on demand. Explicit typed notes are excluded; legacy notes with unknown capture type remain available. Backend commit db70d74 deployed successfully as Railway d08e0491-b1da-4d45-b5b2-23f0990e48b2; health/database/schema checks passed, unauthenticated access returns 401.

Memo impact feedback animates Community and Calendar only after the matching save succeeds. Transcription and suggestions never count as completed changes. The recorder remains in one modal during capture, processing, and review. First-capture Calendar mounting is fixed.

## Hosting design decision

User-approved audience: selected circles, optional invite link. Recipients RSVP; an invitation does not automatically write to their calendars.

Future hosting path (not a separate Events tab): open a memo, explore related people and recorded plans, develop a hosting draft, choose circles, and publish invitations only after explicit review. Invitation objects should attach to the originating memo. RSVP acceptance precedes any calendar export. Neither opening a memo nor asking Amber sends invitations. Revocable links and private audience enforcement remain required.

### Backend gap — not implemented or deployed

`src/routes/events.js` contains private personal planning cards in agent_data; its tests reject public visibility. `/v1/me/agenda` is the authenticated calendar aggregate. `/v1/me/circles` and inbound/membership endpoints provide ownership and membership, but no hosted-event invitation, RSVP, or revocable event-link lifecycle was found. Neither a shared voice update nor a private Google event is an event invitation.

Implement a distinct owner-scoped hosted-event contract with durable events, invitations, RSVP records, and revocable links. Reuse circle authorization and verified session identity; never trust recipient IDs or host IDs supplied by a client. Snapshot recipients at publish, deduplicate people in multiple circles, and handle unresolved/non-Amber contacts with optional links. Transport sends belong to amber-agent per Amber ID's AGENTS.md. Required tests: cross-owner reads/writes, unrelated circle access, removed membership, expired/revoked links, invitation retries, duplicate RSVP, cancel/edit propagation, timezone/multi-day overlap, calendar failure after accepted RSVP, and no calendar write for declined/unanswered invitations.

No hosted-event or RSVP controls are being represented as live in this UI revision.

## Clay setup and verified lookup contracts

Official `clay-run/agent-plugins` marketplace installed; plugin 2.31.0 and independent CLI 1.8.0. Active workspace is **Blue Modern Advisory, 1149025**. Serif Health is not used. No paid lookup was run and no contacts were sent to Clay during this review.

Use the existing managed routines for the new Amber lookup flow, rather than duplicating their provider waterfalls:

| Amber action | Verified routine | Required input | Result |
| --- | --- | --- | --- |
| Find LinkedIn from a known email / enrich an already confirmed profile | [Enrich Person](https://app.clay.com/workspaces/1149025/tables/t_0tivcd78WMyJCABTHus) — `function:t_0tivcd78WMyJCABTHus` | Actual schema offers `Email` or `Professional Profile URL`; Amber should require at least one | `Enrich person` object: profile URL, career/education, summary, picture URL fields; review the match before saving |
| Find work email | [Work Email](https://app.clay.com/workspaces/1149025/tables/t_0tivcdkDid9RmFBpp7k) — `function:t_0tivcdkDid9RmFBpp7k` | `Full Name`, `Company Domain`, `Company Name` | `Work Email` |
| Find phone | [Mobile Phone Number](https://app.clay.com/workspaces/1149025/tables/t_0tivcd9nsdpVHPknrm8) — `function:t_0tivcd9nsdpVHPknrm8` | `Social Profile URL`, `Full Name`, `Company Name` | `Mobile Phone` |

For a name-only search, use Clay people search to present candidate matches first; don't silently equate a common name with the first result. Existing profile/name data remains primary. Do not surface provider slugs/handles as names. When work-email prerequisites are missing, ask for company/domain or explicitly offer the separate Company Domain lookup. Do not substitute the combined Contact Details routine behind a single-field action: that would run more enrichment than requested. These verified functions do not establish a personal-email lookup; add one only after catalog/schema verification.

### Search and contact-card interaction

Saved network search stays local and immediate. A candidate card shows name, company/location and existing identifiers. Explicit actions: Find LinkedIn, Find work email, Find phone. Each action has its own idle / needs input / working / review result / no match / retry state. Searching, opening a card, and scrolling must not trigger these calls.

Show returned fields and source in a review tray before applying. Add verified fields without overwriting user-supplied data; use the existing contact union/trust writer. Rich media should show only actual returned images and career details. Keep source provenance, retrieval time, and relationship context separate. Unknown is not a guessed email or phone. Do not advertise a $1 purchase until billing and its authoritative price are implemented.

### Backend gap — CLI connection is not mobile integration

The existing Clay destination/push endpoints export contacts to a table; they don't implement per-field jobs and results. The old candidate provider uses filters-mode search and can select a stub when unconfigured; it must not back production Find actions. The current documented integration is async routine execution with a dedicated server-side public API key, separate from CLI login.

Proposed contract (not registered endpoints):
- GET contact lookup capabilities: current fields, prerequisites, supported actions.
- POST contact lookup job: contact id, explicit action, stable request id. Verify ownership, reserve one job/spend atomically, return 202 promptly. Do not retry ambiguous POST timeouts by starting a new paid job.
- GET own job: queued/running/reviewable/no_match/failed; normalized results with provenance. Persist provider run id and failures rather than blocking search UI on polling.
- POST apply selected result: idempotent owner-scoped contact union write. Never accept an arbitrary client-provided provider result or owner id.

Production prerequisites: dedicated public API key stored only in Amber ID's encrypted secrets/configuration, budget controls, verified output mapping, durable job ownership/idempotency, match review, real acceptance tests, then feature enablement. No key was minted or deployed in this setup step.

API sources: https://developers.clay.com/public-api/authentication.md and https://developers.clay.com/routines/api.md. Schemas above were also read from the live Blue Modern Advisory routine/function catalog.

## Validation and release boundary

TypeScript passed. The final mobile suite passed 543 tests; the focused backend journal suite passed 18 tests. New tests cover incomplete/error/aborted streams, unconfirmed persistence, bounded query length, saved transcript gating, local date boundaries, paging, authentication and invalid windows. The recording SQL was also run read-only against the real database with a synthetic owner before deployment.

Simulator: rock opens eight options, + opens native recorder, date selection collapses to week and filters local recordings. A real query on an existing saved memo returned a grounded clarification; reopening retained the answer. Google account selection is only mounted when explicitly adding a calendar action. No test event or contact enrichment was submitted in this iteration.

Still needs device acceptance: automatic query after a fresh spoken recording, complete voice-to-Google export, continuous drag-release, Reduce Motion/Transparency, successful/failed destination animation, and screen-reader navigation. This revision has not been archived or uploaded to TestFlight. Hosted invitations/RSVP and per-field Clay write-back remain implementation work. The legacy agent host still returns 404 (pre-existing); memo queries use the verified Amber ID /v1/chat endpoint instead.
