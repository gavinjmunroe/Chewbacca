# Amber ID → redesigned mobile app: connector and migration audit

Checked September 21, 2026. Scope: the readable sagar-main mobile checkout, its existing production screens, the redesigned connected shell, and shared transport modules. This is an implementation audit, not confirmation of a live deployment.

**Finding: the new design does not yet have feature parity with the existing app. Do not promote it to the release route based on visual acceptance alone.** The transport and many connectors already exist; reusing them is faster and less expensive than building another integration layer.

The automated inventory contains **51 connector modules and 175 literal route references**, including duplicates and templated paths. Those numbers are not counts of verified server endpoints. [connector-inventory.json](connector-inventory.json) records exports, callers, route expressions and source lines. Import reachability is only a shortlist: an imported module does not prove its controls are rendered, and route-string navigation is not captured by the scanner.

Reproduce without API calls: `python3 scripts/audit-mobile-connectors.py` from the repository root. No credentials, `.env` files, account contents, or paid provider calls are needed.

## 1. Current architecture

- **Release entry:** `app/index.tsx` redirects through `AuthGate` to `app/(gated)/home.tsx`. The default is `OriginalHomeScreen`, with `HomePage`, `ProfilePage`, `MessagesPanel`, `ChatProvider`, `HomeVoiceCapture` and the existing search overlays.
- **Connected redesign:** `components/ConnectedRolodex.tsx` is selected only with `__DEV__` and `EXPO_PUBLIC_CONNECTED_ROLODEX=1`. It uses `NetworkCanvas`, `NetworkProfile`, `AmberProfileEditor`, `CalendarActivityFeed`, `MemoComposer`, `MemoHistory` and `WebDiscoverySheet`.
- **Design walkthrough:** `preview/HealthNetworkPreview.tsx` runs with sample data. Its apparent saves, friend updates and searches are not live backend acceptance tests. The local journal does persist real device recordings made in the walkthrough, in a separate preview namespace.
- **Amber ID REST:** `lib/config.ts` resolves `extra.amberIdBaseUrl`, defaulting to `https://medha-id-production.up.railway.app`. `lib/medhaId.ts` provides authenticated requests, refresh, read retry/deduplication, result envelopes and an offline write queue. Reuse this rather than introducing screen-specific fetch clients.
- **Amber ID streaming:** `lib/chat.ts` sends SSE requests to `/v1/chat` using native `expo/fetch`. It is distinct from `lib/agent.ts`, whose agent and Togari requests use the platform host. A web-search prompt is not an agent execution request.
- **Identity:** `auth.ts`, `secureStorage.ts`, `sessionRefresh.ts`, `AuthGate` and the gated layout own the session. Credentials stay in SecureStore. Phone-keyed local preferences are device storage, not server-owned community membership.
- **Device integrations:** Contacts and device calendar require their existing native permission flows. An OAuth connection is not proof that data finished syncing. HealthKit is not implemented in this checkout.

## 2. Wiring repaired during this audit

1. `chat.ts` now obtains its bearer from `getFreshAccessToken()` before starting a stream. Closing a search during refresh exits without making a request. Failed POSTs are not automatically replayed. Four mocked transport tests cover refreshed auth, no session, cancellation and failure without repeated paid requests.
2. `IntegrationStories.tsx` reports a successful contacts import or confirmed Google connection to its parent; `ConnectedRolodex.tsx` refreshes the visible community. The existing contacts permission/sync engine remains the source of truth.
3. `AmberProfileEditor.tsx` exposes **Account settings** in the authenticated design. It navigates to the existing `/(gated)/settings` route, preserving connection management, privacy, notification preferences, sign-out and account deletion rather than duplicating them.
4. `redesignRoute.ts` preserves the established home handlers for explicit tab, reminder and DM destinations during the migration. Two route tests ensure the preview flag cannot silently swallow these routes or activate the design in release.
5. `ConnectedRolodex.tsx` consumes the existing `pendingRecord` signal for authenticated recording shortcuts, with the same 15-second expiry and exactly-once consumption as the original home. It does not auto-record on ordinary launch.
6. Calendar now has a visible date dropdown, a separate full month picker, a **Show this day** action and a **Today** shortcut. The feed uses **You / Friends** and **Add event**. Recording history is accessed through the header history button. The search icon is a single rock contour.

Validation performed locally: TypeScript and 86 tests (transport auth, route guards, request contracts, contact sync, feed boundaries/privacy separation, search routing, memo actions, agenda behavior and waveforms). Simulator verified opening the month picker, selecting a different date and updating the timeline. No real contacts were imported, no messages were sent, and no paid enrichment/web queries were used for this audit.

## 3. Feature transfer map

### Authentication and onboarding — preserve the existing shell

Reuse `auth.ts`, `otpRequest.ts`, `sessionRefresh.ts`, `api.ts`, `onboardingState.ts`, `AuthGate` and `app/(gated)/onboarding.tsx`. Existing sign-in and authenticated profile writes remain in the router flow. The sample walkthrough is not a replacement for verification, consent or account creation. Acceptance: sign-in, relaunch, token expiry, failed profile save, sign-out and account change, with no cross-account local data.

### Contacts, search and graph — partially connected

`network.ts`, `useContacts.ts`, `contacts.ts`, `favorites.ts`, `contactNotes.ts`, `contactsSync.ts` and `contactsSyncEngine.ts` already cover address books, full cards, facts, edits, favorites and durable import. `ConnectedRolodex` reads contacts/favorites; `NetworkProfile` reads contact details and facts; Add note already calls `captureContactNote`. Contact edits, duplicate resolution, enrichment and identity-link management still need the appropriate existing controls restored.

The graph's local text matching is not equivalent to all of the original semantic-search experience. Reuse `peoplerank.ts` and the event interpretation in `ChatContext.tsx` when a query needs semantic results. Preserve clarification, known-contact IDs, provenance and cancellation; do not replace them with guessed model-generated IDs.

Target UI files: `ConnectedRolodex.tsx`, `NetworkCanvas.tsx`, `NetworkProfile.tsx`, `IntegrationStories.tsx`.

### Saved networks and circles — blocking parity gap

`amberSpace.ts` / `useAmberSpace.ts` persist Professional/Personal membership locally. They do **not** create server circles, invitations, permissions or synchronized membership. Existing server behavior is in `circles.ts` and `circleFavorites.ts`: list/create/update circles, get/set members, inbound invitations, leave/seen and pinned circles. Preserve circle IDs and ownership; never reinterpret a local filter as a sharing audience.

Target: a circle-backed saved-network adapter consumed by `AmberProfileEditor` and `NetworkCanvas`. Acceptance: existing circles survive unchanged, membership persists across devices, overlapping memberships work, and private groups stay private.

### Voice capture and original audio — blocking parity gap

Original flow: `HomeVoiceCapture` → `ChatContext.runSearch(..., 'soundboard')` → conversation capture → `uploadNoteAudio` → optional `setNoteShare`; reminder parsing/scheduling is a separate established step.

New flow: `MemoComposer` captures/transcribes → `useJournal` saves locally → `RequestReview` proposes actions. `ConnectedRolodex.confirmMemo` writes selected contact notes or calendar events. Audio upload currently happens on the contact-note action, **not for every recording**. A recording that remains unreviewed or only creates a calendar event is not thereby backed up to Amber ID. Computer actions are drafts, not executed agent tasks.

Reuse `chat.ts`, `contactNotes.ts`, `noteMedia.ts`, `conversations.ts`, `noteShares.ts`, `reminders.ts`, `noteTags.ts` and `voiceCorrection.ts`. Build one explicit capture service with a persisted conversation ID, transcript-save status and audio-upload status. Retry audio against the same ID rather than re-running transcription, capture and billing. Preserve the local recording on every failure. Never use an assistant reply or a received SSE `meta` event alone as proof of persistence.

Target: `MemoComposer`, `useJournal`, `MemoHistory`, `ConnectedRolodex`. Acceptance: offline capture, transcript failure, upload failure, interruption, restart, retry without duplication, cross-device playback, and selected-audience sharing.

### Calendar and reminders — reads/create wired, full behavior incomplete

`agendaApi.ts` / `agenda.ts` provide the old cached day query, timezone boundaries, event/reminder merge and duplicate rules. `calendarAccounts.ts` and `CalendarSyncSheet` provide Google/Microsoft account connection, sync and disconnect. `deviceCalendar.ts` reads permitted device calendars. `scheduleEdits.ts` covers create/edit/delete and repeat/notification fields; `openReminders.ts` and `reminders.ts` cover unfinished reminders and completion/scheduling.

The new `CalendarActivityFeed` reads device/Amber agenda and daily conversations and creates events through `QuickEventSheet`. Its one-off effect duplicates the older cached day-loading orchestration. Port the existing cache/invalidation behavior and restore editing, deletion, reminder completion and notification destinations. Do not label a backend failure as an empty day. Device-calendar events and Amber-owned events have different edit permissions.

### Friends feed and social actions — partial, not full Strava-like behavior

The new feed reads `noteShares.getNetworkFeed(100)` and displays authorized shared notes/audio. It does **not** include the separate `connect.networkFeed()` wall-post feed. Filtering the most recent 100 notes locally is not arbitrary historical pagination. `wall.ts`, `connect.ts`, `postSocial.ts`, `noteMedia.ts`, `feedSocial.ts` and `commentVoice.ts` already cover posts, connection requests, reactions and comments. Preserve the distinction between note IDs and post IDs and reuse `feedSocial` action adapters.

Target: `CalendarActivityFeed` and its expanded update view. Acceptance: notes and posts from authorized friends only, own private notes excluded, real reactions/comments, revoked sharing, and correct empty/error/older-day states. Do not add an activity/health card until a source actually supplies it.

### Web discovery, enrichment and contact creation — separate operations

`WebDiscoverySheet` already calls `/v1/chat` with `forceWeb`, supports follow-ups and displays safe source links and people. `contacts.createContactFromWeb` already exists. `enrichment.ts` supports enrichment and ambiguous-result resolution. `clay.ts` configures a Clay destination and pushes contacts; this is not automatically a $1-per-contact purchase contract.

The redesigned $1 action is preview-only and must stay so until a real price/entitlement/purchase/receipt contract is verified. Restore known-contact handling, source attribution, add-vs-enrich behavior and duplicate safeguards using these adapters. Reuse original chat event handling for clarification, persistence and suggestions rather than silently dropping unsupported event types.

The staged `integrations/amber-id/serp-events.mjs` adapter has not been mounted or deployed. Existing authenticated `/v1/chat` web search and proposed SerpApi event discovery are different paths.

### Profile and personal data — basic fields connected; deeper features missing

`AmberProfileEditor` patches supported `/v1/me` fields; appearance, website and saved-network preferences remain local. Existing profile capabilities include `voiceBio.ts`, `selfDimensions.ts`, `experiences.ts`, `wall.ts`, `contactLinks.ts`, username/connection controls in `connect.ts`, and pinned circles/favorites. Reuse the original controls or their adapters within the new profile; keep field privacy and immutable identity rules.

### Messaging, invitations and questions — existing routes, missing new navigation

`dms.ts`, `MessagesPanel`, `directory.ts`, `connect.ts`, `questions.ts`, `pending.ts` and the gated circle/user/intro/question routes remain in the app. The redesigned main navigation does not expose full DM threads, incoming requests, intros, circle invitations, question inboxes or pending clarification. Map these to person/circle screens and a clearly named inbox; preserve unread counts and notification destinations. Route fallback now prevents targeted DM/reminder links being swallowed, but is not a completed visual migration.

### Apple/Google connectors, health, agents and alerts

- Contacts reuses the real native import engine; Gmail uses the existing Google OAuth endpoint. Its current permissions are broader than Gmail alone, so keep the disclosure until the server offers narrower scopes.
- Google Calendar opens the existing account/calendar flow. Apple Health is a visible design surface only. No HealthKit bridge/capability exists here. Whoop/Oura/Garmin/Strava/MyChart/Function remain future connectors, not enabled integrations.
- `agent.ts` / `togari.ts` are separate platform capabilities. New Computer drafts do not execute them. Retain explicit review before any external action.
- Family/Local/Opt-in Amber Alert audiences do not map to the current private/network/circle/contact note-share contract. Define membership, consent, location scope and delivery server-side before enabling Send; never fall back to network-wide sharing.

## 4. Efficient migration order and acceptance gates

1. **Read Amber ID source and match contracts.** Confirm the server revision, route handlers, middleware/ownership, request/response shape and migrations against this inventory. Avoid creating duplicate routes because the new frontend does not call an existing one yet.
2. **Unify capture and persistence first.** One original memo, one conversation ID, one recording upload, recoverable retry. This is the highest data-loss risk.
3. **Back saved networks with existing circles and restore account/inbox controls.** Keep local filter state separate from audience authorization.
4. **Reuse calendar cache/edit/reminder and social adapters.** Bring old behavior into the new views rather than copying request code into each screen.
5. **Finish web add/enrich and supported provider acceptance.** Reuse sourced contacts; resolve billing before enabling $1. HealthKit and new wearables require separate implementations.
6. **Promote the new shell only after parity gates pass.** Auth, contacts, profile, recording save/playback, calendar create/edit, friends authorization, messages, deep links, deletion/sign-out and offline recovery must be verified with a test account. Then complete signing, build-number checks, device testing and TestFlight. Do not treat a passing typecheck or sample demo as App Store readiness.

Cost control: use static maps and existing tests first; mocked transports for success/failure/cancellation; no provider searches on keystrokes; no automatic replay of chargeable POSTs; cache repeated day/contact reads; one transcription per recording and independent audio retry. Run a small, explicit live acceptance matrix after source contracts are known instead of repeated exploratory production calls. No numeric cost/speed savings are claimed without measurements.

## 5. Outstanding evidence

The local `/Users/sagartiwari/Desktop/Codex/amber/amber-id` files, including `AGENTS.md`, `package.json` and `src/index.js`, were still `compressed,dataless` iCloud placeholders at the final filesystem check. The `amber-id-auth-fix` checkout has the same issue. Server implementation, DB migrations, environment configuration and deployed revision have **not** been verified by this pass. Download that folder in Finder before continuing the server half; no backend edits were made without its instructions.

No authenticated end-to-end session, HealthKit permission, real Google OAuth, live enrichment purchase, notification delivery, signed archive or App Store upload was performed. The Apple account remains the requested `team@joinrytual.com`; previous configured identifiers are not proof of current signing readiness.
