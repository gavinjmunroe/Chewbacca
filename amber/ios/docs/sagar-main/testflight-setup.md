## Current release status — October 19, 2026

- iOS `main` is `9499998` (`Bump iOS TestFlight build to 14`) and contains Sagar-main `3ac933f` and UI merge `8d5f9df` as ancestors. TestFlight build 14 was built from this exact source. Mobile `verify`: 21 checks passed; mobile tests: 584 passed; typecheck and lint passed.
- Backend GitHub `main` and production `/status` runtime both report `6031655` (`Name people from their addresses, spread the graph, stop the markdown`); Cloud SQL is healthy and schema current. Full suite: 2,298 passed, 0 failed, 45 skipped; typecheck and undefined-reference check passed.
- TestFlight: version `1.0.1 (14)`, App Store Connect build ID `aaf73e4f-4f52-4f69-8476-ce9b09c1c867`, processing state `VALID`, assigned to **Amber Internal Beta**. External beta review was not submitted.
- Build 14 uses `com.joinrytual.amber.beta`, Rytual Health team `XJ94HGCQHA`, and excludes Kyber by request. The app is under Expo organization `amber-intelligence`, project ID `65b9b69f-7b1a-4915-9309-42a1069869e8`.
- EAS build `055ccf92-3f2b-4369-bb0f-aee1509f87df` used the production profile and Rytual signing credentials; the IPA was uploaded through the authenticated ASC CLI. EAS auto-submit remains unavailable until an App Store Connect API key is configured in Expo. The newest production OTA group is `4fbda0f8-0929-490c-9084-0639e2b15b4e`, published from `9499998` with runtime `1.0.1-sagar-beta`.
- The booted Simulator is still on build 11 and is not the TestFlight build. Install `1.0.1 (14)` from TestFlight on a device; launch once to fetch the OTA, then relaunch to apply it. Signed-in acceptance for onboarding, Profile, PeopleRank, discovery, and Clay remains required. No live iMessage round trip is claimed.

Entries below are historical snapshots; use this section and `HANDOFF.md` for the current release state.

## Amber ID card and contact review — October 8, 2026

Working changes add one opt-in live card with selectable links, public QR/vCard access, and explicit unpublishing. Public projection excludes notes, relationships, integration settings and disabled fields. Phone and email stay deselected by default. Card edits are saved explicitly and stale writes are rejected.

Business-card camera capture, Amber/vCard QR scanning, file imports, incoming vCards and Amber card links converge on contact review. Third-party NFC cards can open their provider page; import its vCard when no Amber-compatible payload is available. Raw NFC tag reading/writing is not implemented. New people created from memo review now use the same Apple save and owner-scoped Amber import. Name-only matches require a choice; existing details are additive; partial Apple/Amber sync is surfaced for retry. Existing Apple fields suppress redundant Clay lookups, and phone/email/LinkedIn rows support native contact actions.

The Photon adapter now reads owner-scoped profile, relationship evidence, saved memories and calendar context after phone/channel admission. Notifications remain deferred. Calendar context has an explicit seven-day window for day queries; this is not an unlimited-history claim. No live iMessage round trip or physical camera/NFC acceptance is claimed by automated tests.

Verification: 575 mobile tests passed; broad backend run had 2,066 passes and 45 skips, with its only failure a sandbox-disallowed local listen. The same boot test passed when rerun with local-port access. Focused privacy/import/context tests passed. Live isolated-review acceptance verified stable URLs, public HTML/JSON/vCard allowlists, deselection, stale-write rejection, and read-only vCard preview; its test card was unpublished afterward and contact count stayed unchanged. Observed card GET 526 ms, card save 1,086 ms, vCard preview 164 ms (single run, not a percentile benchmark).

Backend deployment: `95ad238b-35e3-4a7e-9552-0e561d28a1fc`. These app changes require a new native build for camera/document support. Build 9 is the current distributed beta. Native simulator compilation passed after replacing a stale Release React Native core with the correct Debug framework. All 20 release checks have passing results after reviewing and updating the screen contract for the new live-card controls. Build 9 archive and upload succeeded (`release/Amber-Card-9.xcarchive`); App Store Connect confirms Testing in Amber Internal Beta and Amber External Beta, with automatic tester notifications enabled. Build ID: e8277ebc-f729-4975-a341-3b73cb782435. What to Test is saved; public access remains https://testflight.apple.com/join/Ewc6Wu58. Xcode-managed simulator signing passed; isolated reviewer sign-in and session persistence, sample network, card, contact review, native file picker and camera-permission entry were checked in the rebuilt app. Physical-camera capture and live iMessage remain unverified. The simulator currently uses the isolated review account. Existing Hermes/React prebuilt dSYM warnings remain. Matt, Saraswati, and Amber Hartnell were reinvited to the existing external beta on October 8; the public installation link remains enabled.

## October 7 — onboarding context and release candidate 8

Build 8 adds optional family, nearby-people, and next-month connection voice prompts after Apple Contacts. Recordings use the private journal/audio flow. Users explicitly select matching contacts; uncertain matches are never automatically attached. Confirmed selections create a capped, 30-day decaying cold-start PeopleRank signal without overwriting imported contact fields. Previously completed users do not repeat onboarding.

AI processing, Exa research, and Clay enrichment now require separate, account-scoped disclosures and consent. Consent can be reset in Settings. Original recordings stay on-device when processing is declined. These are private personalization inputs, not general-purpose model-training data.

People discovery uses Exa's people category. Plans discovery uses Exa places and requires a city; place results are not invented calendar events. Each result remains separate until explicitly saved. Contact enrichment retains the four explicit Clay lookups and additive Apple Contacts export. Profile sources, memo audio/history, and per-person/per-plan recording are preserved.

Validation: 569 mobile tests and all 20 final mobile release checks passed, including the final copy and preview adjustment. Backend 2,058 tests pass and 45 database-dependent tests skip; the sandbox-blocked startup test passes outside the sandbox. Live isolated-review acceptance passed memo/context persistence, retry idempotency, preservation of other prompt context, PeopleRank boost, unowned-contact rejection, and the support page. No real contacts or plans were modified by these tests.

Backend deployment 121f5a44-e503-4708-9c12-39799d11d62a is SUCCESS and serves the new endpoints. Backend source is checkpointed locally at 9c29eea on redesign-integration. No schema migration or destructive operation. Support: https://amber-id-production.up.railway.app/support. Privacy: https://amber-id-production.up.railway.app/legal/privacy.

Release status: 1.0.1 (8) is Testing in both Amber Internal Beta and Amber External Beta. The final archive is release/Amber-Onboarding-8-Final.xcarchive. Upload and export succeeded; existing Hermes/React native framework dSYM warnings remain. Build ID: 5711fe46-f86b-4cd2-b399-57043537c72e. What to Test is saved. iOS implementation commit 573beec is pushed to origin/sagar-main.

Shirley is now in the internal group (three testers total). Karthik's corrected address, [redacted tester email], is visibly Invited in the external group and can install immediately. Public beta installation: https://testflight.apple.com/join/Ewc6Wu58 (100-tester limit). The separate least-privilege App Store Connect Marketing invitation is prepared and awaiting final access confirmation; acceptance is required before internal group eligibility. The old Gmail invitations have not been removed.

Public App Store submission is not complete. Support/review information, category and subtitle are saved. Privacy responses are fully drafted but final publication/attestation needs user confirmation. Public app name and territory preferences remain pending. Screenshots, age/content declarations, pricing/availability, business verification and final build selection/submission remain unfinished. Public TestFlight description was cleaned to keep review-access instructions in private review information only.

Remaining acceptance limits: the family prompt was visually verified in the simulator, but a complete new onboarding recording and native permissions still need physical-device testing. Real new-user SMS delivery, the Jonah Clay identity lookup and all live calendar mutations are not established by the automated checks. The simulator has been returned to the connected development server. Onboarding personalization uses explicit selected contacts; it does not infer sensitive traits or silently overwrite imported fields.

Dependency audit: pnpm production audit reports 3 critical, 90 high, 46 moderate and 9 low findings. Critical paths include shell-quote in React Native tooling, tar in Expo tooling and proxy-addr in a legacy service. These need runtime applicability and safe-upgrade review before claiming public-release security readiness. No broad dependency changes were introduced into build 8. Audit counts alone do not establish exploitability of the shipped iOS binary.

## October 4: simplified version 1 — TestFlight build 4

People keeps the existing PeopleRank graph with the circle selector removed. Plans shows device and synced Google calendar events, with cached independent reads. Voice memo history and playback live under the top-right profile. Person and plan cards have contextual voice recording; context is labeled separately from the spoken transcript and preserved in cloud history. Generic memos remain privately saved until reviewed. Existing plans require explicit selection; plan people are private additive associations, not invitations. Source recordings are linked through owner-scoped observations.

Optional onboarding permissions are skippable. Health requests read-only steps/workouts, previews a daily summary, and uploads only after an explicit save to Amber ID. Photos are selected individually through the capture flow; location permission does not automatically upload location. Cross-app Screen Time is not enabled and needs a separate entitlement and confirmed scope.

Validation: mobile TypeScript and 553 tests; targeted backend ownership/idempotency/search tests and boot passed. Simulator shows real Google events and profile memo history including the new contextual recording. Native Health read/prompt requires the updated device build and still needs real-device acceptance. Live Perplexity search remains blocked until production PERPLEXITY_API_KEY is configured. No claim of Shirley sign-in acceptance yet.

Backend deployment: 4db25dd4-c862-49e4-8d44-ed06ae5aaa38, commit dcbe846, SUCCESS; status healthy and schema current. Calendar sync now preserves reviewed memo participant links, including partial Google write-back responses. No schema migration or destructive operation.

Release: version 1.0.1 (4), com.joinrytual.amber.beta, team XJ94HGCQHA. Final archive release/Amber-People-Plans-4-Final.xcarchive has build 4 and both HealthKit usage descriptions; upload succeeded October 4 at 18:11 Pacific. App Store Connect build d685ee29-96ed-4e7f-92f3-f3d7e88a2886 finished processing and is assigned to Amber Internal Beta (2 testers), with What to Test saved. No external beta review or App Store approval is claimed. Hermes/ReactNativeDependencies dSYM upload warnings remain. Earlier entries below are historical snapshots.

Focused calendar participant preservation/write-back tests: 20 passed. Native Health and live calendar mutation still need device acceptance; this release does not establish that Shirley’s code-delivery issue is resolved.

## October 4 — People, Plans and Perplexity (new source, not uploaded)

- Community/Calendar are now People/Plans. The center recording trigger uses the actual Amber rock PNG, with the existing immediate recording sheet. Simulator navigation and trigger verified; test recording cancelled without saving.
- Each newly processed memo sorts into bounded people, places and plans. Places render under their related person/plan; there is no Places tab. Sorting runs alongside the existing network query and is cached per transcript. A corrected transcript queues fresh processing after cloud save.
- The review drawer reuses extracted drafts rather than another model call. It asks for missing identity, timing and place (including “not decided / not relevant”). New people require email or phone as an identity anchor. Place context is included in person notes and Google event writes.
- An existing plan must be selected explicitly before updating. The new endpoint checks the selected version and Google ETag, supports primary and secondary calendars, preserves unrelated provider fields, and does not report success before mirroring. Recurring/all-day Google updates remain provider-editor only.
- Both Amber-enabled global search bars now call Perplexity Search, at most 10 linked results. People results are individual LinkedIn source profiles. Clay remains explicit profile/email/phone enrichment. Regular saved-content filtering remains local.
- **Blocker: Railway has no PERPLEXITY_API_KEY.** Do not claim live global results or ship this as fully functional until the key is configured and both result lists pass live acceptance. The signed-in Plans UI correctly surfaced this configuration failure through the deployed endpoint.
- Live synthetic capture test: 200 in 3.85 seconds, with person/place/untimed plan; no real contact/calendar writes. It exposed omitted place fields on actions; normalization now carries matching object place tags into drafts, covered by a regression test.
- Checks: TypeScript, 551 mobile tests, 28 focused backend tests, and full service boot check pass. Google update acceptance is mocked so far; a live, explicitly selected disposable event still needs verification.
- Backend deployment a4ca41ad-bd2f-45c4-8acd-0c7f1c9afa0a is SUCCESS; /status healthy and schema current. No new migration. Legacy companion health remains its pre-existing 404.
- App Store Connect refresh on October 4 redirected to sign-in; cached build-3 Processing state cannot be treated as current. Latest source has **not** been archived/uploaded/distributed. Shirley’s no-code sign-in issue remains unresolved.
- Structured objects are currently cached in the account-isolated on-device index. Transcript/audio and conversation use existing cloud journal storage; cross-device object hydration is a remaining follow-up.

## October 4 — build 3 and live Clay search

- Signed 1.0.1 (3) for `com.joinrytual.amber.beta`, Rytual team `XJ94HGCQHA`.
- Archive: `release/Amber-Beta-Simple-3.xcarchive`. Xcode upload confirmed
  `Uploaded Amber` / `EXPORT SUCCEEDED`; App Store Connect visibly showed build 3
  Processing at 2:04 AM Pacific. **Tester group assignment is not yet verified.**
- Build 2 was uploaded without any tester group. Build 1 was still assigned to
  Amber Internal Beta (2 invitations, 1 installation). Do not equate upload with distribution.
- Community rock-enabled discovery now uses a clean Clay people list, capped at
  10, with editable query, LinkedIn links, and explicit profile/work-email/phone
  enrichment. Normal saved-network filtering stays local. Calendar web opportunity
  search retains its separate existing flow.
- Clay server integration is live in Blue Modern Advisory (1149025). Dedicated
  key is stored only as Railway `CLAY_PUBLIC_API_KEY`; its temporary plaintext
  creation file was removed. No key is bundled in iOS.
- Live public API search returned 10; a live profile routine completed. A full
  signed-in simulator search through Amber ID also visibly returned 10. The first
  UI test caught an unstructured query-planning failure; the corrected typed-tool
  planner is deployed in backend commit a72c603. Email and phone input contracts
  were verified, but their actual provider results and the final in-app enrichment
  tap remain acceptance checks.
- Memo details now show audio, transcript and a compact Amber result. Chat and
  editing/actions are collapsed behind explicit controls. Automatic memo queries
  request a short summary rather than unnecessary follow-up questions. Existing
  saved replies retain their original text. Confirmed memo details render in the
  simulator; no fresh ambient microphone recording was made during this pass.
- Sign-in now includes resend cooldown, manual entry for delayed codes, recovery
  when native/storage calls throw, validated Messages opt-in links and the sender
  fallback. Biometric preference initialization cannot invalidate a saved login.
  Failed or malformed 200 send responses no longer advance to verification.
- Shirley's no-code report is **not yet resolved or reproduced**. Both shipped
  archives use the correct Amber ID URL. Provider subscription connection errors
  were seen, but no matching mobile OTP delivery failure was found. Await her
  exact app/build and send-error wording; she may be on the older Amber app.
- Validation: TypeScript and all 546 mobile tests pass; 11 new backend tests pass.
  Returning signed-in simulator restart retained the session without onboarding.
- Simulator app expects Metro 8082. Preview scripts and Desktop `start-ios.command`
  now use 8082; the live connected server log is `/private/tmp/amber-sagar-metro-8082.log`.
- Backend deployment `9fc74aec-396a-44e3-9ee7-a7341055ec85` succeeded. Additive
  migration 059 stores owner-scoped Clay jobs with paid dispatch deduplication.
  Amber ID `/status` reported healthy/current. The legacy agent URL still returns
  404 as previously documented; the active app queries Amber ID.
- Upload succeeded with the pre-existing missing Hermes dSYM warning; this limits
  symbolication of Hermes-native crashes, not installability.

# Sagar main: onboarding and TestFlight setup

## Current release status — September 30, 2026

Use `/Users/sagartiwari/dev/amber-ios-sagar-main` (branch `sagar-main`) and
`/Users/sagartiwari/dev/amber-id-main` (branch `redesign-integration`). The Desktop
copies are iCloud-backed and are not the active build checkouts. Start the signed-in
simulator experience from `apps/mobile` using Node 22 and
`node scripts/preview-connected.mjs`. The Sagar shell is also the release home;
legacy notification destinations still route to their existing screens.

Latest main was merged without discarding Sagar work: iOS `c885ee1` and Amber ID
`3f29362`. Account data, Google integration, contact provenance, cadence and graph
interaction strength use Amber ID. Unavailable paid enrichment and sample-only
integration controls are hidden in the connected beta.

### Apple identity

- Xcode account: `team@joinrytual.com`, Admin, Rytual Health LLC.
- Verified team ID: `XJ94HGCQHA`.
- User authorized a separate beta because the original bundle belongs to another team.
- New app: **Amber — Rytual Beta**, App Store Connect ID **6817619431**.
- Bundle: `com.joinrytual.amber.beta`; version `1.0.1`, build `1`.
- Runtime: `1.0.1-sagar-beta`, isolated from old OTA updates.
- User's iPhone registered with the Rytual team; generic-device signed archive succeeded.
- Publishing uses the signed-in Xcode account; ASC API credentials are not configured.
- Apple accepted the corrected upload on September 30: **1.0.1 (1)**.
  `asc xcode export` reported `Uploaded Amber` and `EXPORT SUCCEEDED`.
- Current archive: `release/Amber-Beta-Final-1.xcarchive`. Older Google/initial
  archives and `Amber-Beta-1.ipa` contain the rejected HealthKit configuration;
  do not redistribute them. The corrected archive has no HealthKit entitlement
  or linked HealthKit framework.
- Apple warned that prebuilt React, ReactNativeDependencies and Hermes framework
  dSYMs are absent. Upload succeeded, but those framework crash symbols remain unavailable.
- App Store Connect browser login expired. Apple processing and internal
  TestFlight tester availability are **not yet verified**; browser sign-in is pending.

### Google Calendar release requirement

Google write-back is required, not an Amber-only fallback. Both memo review and
Sagar Calendar's Add Event select a connected Google account explicitly. They
create timed, non-recurring events in its **primary** calendar through authenticated
`POST /v1/me/google-calendar-events`, without guests. Stable request IDs recover
lost responses and failed Amber mirroring without duplicate Google events. The
same external event key is used by inbound sync. Google/Outlook events are labeled
with their provider; editing them uses the provider, not a local-only editor.

**Live test passed:** from the authenticated simulator, created
`Amber beta write-back test` in the connected Google primary calendar for
September 29, 11:00–11:30 PM America/Los_Angeles. The write endpoint confirmed
Google creation and Amber's calendar showed the event. It has not been deleted.

**New/reconnected Google sign-in remains blocked:** production's
`MEDHA_ID_PUBLIC_URL` pointed at the retired Medha domain. It is now
`https://amber-id-production.up.railway.app`, deployed successfully. Google
correctly reports `redirect_uri_mismatch` because its OAuth client must also
allow this exact callback:

`https://amber-id-production.up.railway.app/v1/oauth/google/callback`

Google OAuth project number: `813373326630`. Client ID:
`813373326630-an0c7pqdf0pccau127obpuhljc9a57bd.apps.googleusercontent.com`.

A Google Cloud sign-in handoff is pending. Preserve other legitimate callback
URIs. After adding this URI, retry fresh authorization, confirm return to Amber,
and sync the connected account. Do not use success from an old stored token as
proof that fresh authorization works.

### Validation

518 mobile tests pass, TypeScript passes, and the backend suite has 1,988 passes,
45 skips and no failures. These include Google write-back ownership, timeouts,
concurrent retries, mismatched retries, cancelled events and failed local mirroring.

### Remaining release checks

1. Update Google's OAuth redirect allowlist and verify fresh authorization.
2. Sign back into App Store Connect as `team@joinrytual.com`, verify processing
   of uploaded **1.0.1 (1)**, and configure internal TestFlight.
3. Verify microphone recording/transcription/contact actions on the final beta;
   fixture tests and a successful archive are not full physical-device acceptance.

## October 2 beta fixes

- Google is hidden from sign-in/onboarding; Community no longer has an integration strip. Existing connector settings remain accessible.
- Sign-in enters the gated home and resolves the server onboarding timestamp. Completed users are redirected out of onboarding; unfinished users still see it. Transport errors do not restart the funnel.
- Contacts render before optional ranks/favorites/graph responses. Refresh failures preserve existing contacts. Search layout is deferred behind input updates.
- Contact names preserve recorded identity instead of linked short names or inferred token removal. Sagar cards do not surface username labels. Legacy share URLs remain compatible.
- Simulator verified 2,927 contacts, Caleb Newton and Karthik Devarakonda, no Community connectors, and circle switching. No physical-device latency benchmark or sign-out/OTP acceptance has been claimed.
- Validation: mobile TypeScript and 527 tests pass; backend 1,991 pass / 45 database-dependent skips. The sandbox-blocked boot test passed when rerun with port access.
- Build 1.0.1 (2) archived successfully at `release/Amber-Beta-Feedback-2.xcarchive` and Apple accepted upload (`EXPORT SUCCEEDED`). Processing and internal group assignment are not yet verified because the App Store Connect browser session expired. Build 1 remains the last verified distributed version. Upload log: `/private/tmp/amber-beta-feedback-2-upload.log`.
- Backend commit `0054f65` deployed successfully as Railway deployment `62914135-2381-48fa-9539-f9768e9fbf27`; `/status` confirms healthy database and current schema.

## Historical implementation notes

The notes below describe earlier iterations. The current status above supersedes
old bundle IDs, retired hosts, UI names, feature availability and release blockers.


Checked September 20, 2026.

## Run the design walkthrough

The simulator is running from the complete, non-iCloud checkout at `/Users/sagartiwari/dev/amber-ios-sagar-main`.
Open `/Users/sagartiwari/Desktop/Codex/amber/start-ios.command` to start Metro and launch the installed `com.joinrytual.amber` app. Keep its terminal open. Node 22 is `/usr/local/bin/node`. The preview can also be started from `apps/mobile` with `npm run preview:onboarding` using Node 22.

The original Desktop checkout is iCloud-backed. Cloud-only dependency files blocked synchronous Metro reads and coordinated Xcode project reads, causing misleading timeouts. Use the permanent local checkout for Metro. Before building from the Desktop checkout, use Finder's Download Now and wait for hydration. The native project and signing still need validation for an archive.

The design entry now begins with onboarding rather than going straight to the sample network. Use the Walkthrough button to return to the beginning. This development-only entry uses synthetic data and does not create an account or connect sources. Release builds use Expo Router and the real sign-in/onboarding flow. The authenticated development shell is available via `npm run preview:connected`.

## Apple configuration

- Requested account: `team@joinrytual.com`.
- Xcode shows this account with Admin access to Rytual Health LLC.
- Configured team: `4DMVHH99R2`; still needs matching to the account's team ID.
- Bundle: `com.joinrytual.amber`.
- Existing App Store Connect app ID: `6774023666`; not verified remotely.
- Expo and native Info.plist: version `1.0.1`, build `113`.
- `asc auth status` has no configured API credentials.
- Local keychain exposes an Apple Development signing identity; distribution signing has not been verified.

A signed archive was attempted using `asc xcode archive` with automatic provisioning. It stalled during coordinated project reads before signing could be verified, and was stopped. No IPA or TestFlight upload was completed. Check the highest remote build number before choosing the release number; do not assume 113 is available. App Store Connect sign-in is still required to verify the app and builds.

## Initial Amber ID integration fixes

`https://medha-id-production.up.railway.app/status` reported healthy Amber ID, database, and current schema. Authenticated end-to-end operations have not been tested with a user session.

Production onboarding checks the transport result for profile writes and advances only after success. Name, privacy, city, and completion persist via authenticated `PATCH /v1/me`. Errors keep the current step visible; save guards prevent duplicate writes. The duplicate phone step was removed because phone is immutable on that endpoint. Saved progress migrates old step indices. Private-profile copy no longer claims cloud-stored data stays on-device. TypeScript and the existing contacts-sync/OTP tests passed after these changes.

Next, connect the redesigned components to the authenticated release flow, verify actual contact imports/search, and complete device acceptance before TestFlight distribution.

## Community and discovery redesign (September 20 follow-up)

Onboarding and Community now render the same `NetworkCanvas`: warm orbit rings, small people nodes, the Amber rock, spring transitions, and a reduced-motion alternative. Local search and status match saved names, roles, and note context; matching people move inward and nonmatches remain visible further out. This is deterministic matching, not a verified semantic graph model. New sample contacts join the same layout; confirmed voice notes update searchable context.

The source picker is Apple / Google / Web only. Local Community search reshapes the graph without opening a modal. Local calendar search filters the selected day's agenda. Web searches open a separate contact/event discovery modal. Sample contact adds update the graph and retain available emails/phone for the profile.

Your network now shows a virtualized, progressively loaded bank of daily questions, private polls, charts of the user's selected answers, and calendar-aware prompts. Answers are stored on-device under an account-scoped key (a separate sample namespace for the design walkthrough). The current curated bank ends after 96 topical prompts; there is no live endless content-generation service or community vote aggregation yet. Custom Big Five-inspired prompts are not a validated personality test; the charts show selected option positions, not trait scores. Research reference: https://ipip.ori.org/newMultipleconstructs.htm

Verification: TypeScript; graph relevance/insertion/no-match tests; six SerpApi adapter fixture/auth/error tests; Simulator checks for in-place Community and calendar searches, daily feed, web contact review, and adding a sixth sample person.

Remaining release blockers: authenticated full acceptance, backend event-route mounting and SerpApi server credentials, paid enrichment/billing, real feed generation/aggregation, and promoting the authenticated development shell into the release home route while preserving existing navigation. The design preview still uses synthetic data. The existing release home is unchanged. See `integrations/amber-id/README.md` for the exact backend handoff.

## Rock actions and alert composer update

The rock opens the editable profile on tap and exposes Professional, Amber Alert,
and Personal quick actions on press/drag. Saved network memberships and profile
appearance persist locally; supported account profile fields use the authenticated
profile endpoint. Calendar / Your Network now contains “Who am I looking for
today?” and opens conversational discovery in a bottom sheet. Web uses the
Perplexity mark; contact enrichment uses Clay.

Amber Alert is now text-only, with Family, Local, and Opt-in audience choices and
a single Send Amber Alert action. The preview records the selected audience in
the sample status without sending notifications. Live submission is unavailable
until those audience groups and delivery are implemented server-side; the old
network-wide note-sharing endpoint must not be used as a substitute.

Validation: mobile TypeScript passed; eight saved-network and graph-layout tests
passed. Simulator accessibility confirms all three alert audiences, the text
field, and the single submit button, with no recording or review controls.

## Journal replaces Calendar in the redesigned shell

Community and Journal are the two bottom tabs. Journal embeds memo history,
searches saved memo text, and places Record voice memo above the glass dock.
Each recording opens its transcript, original audio when available, and memo
actions. The previous Calendar/daily-focus surface is no longer in this shell.

New memo metadata is persisted in account-isolated AsyncStorage. Original audio
is copied from the recorder cache into Documents/journal with account-scoped
folders; preview recordings use a separate namespace. These are device-local
copies, not cloud backup. Existing account history now requests the supported
date-window route from 1970 through today rather than the default 30 latest
conversations, and includes older entries whose capture type is unknown. Full
account history and original audio availability still require authenticated
acceptance testing. Previously discarded session-only recordings cannot be
reconstructed from this change.

Simulator verified Journal navigation, top search, empty state, and record button
above the dock. No microphone recording was made during this verification.

## Calendar social day feed (September 21 revision)

Calendar replaces the Journal label and embeds recordings and calendar events
in chronological My day cards. Friends shows only server-authorized shared
notes from the existing network feed, with original shared audio where present.
All memos retains access to recording history. The record control remains above
the glass dock. Preview plans/friend updates are explicitly labeled samples.

Community integrations: Contacts (Apple mark), Gmail (Google mark), then future
providers. Web and Attio are removed from this row. Contacts now invokes the
existing iPhone permission and contact-import engine; Google uses its existing
OAuth flow with its actual broad permission disclosure. Calendar connections
are Apple Health and Google Calendar in full color, then greyed Whoop, Oura,
Garmin, Strava, MyChart and Function. Apple Health is a visible setup surface
only; native HealthKit access is not implemented. Google Calendar opens the
existing calendar connection sheet in authenticated mode.

Both search bars use the Amber-outline switch: off filters saved data, on opens
the web response bottom sheet on submission. Community requests sourced people;
Calendar requests general web context. Follow-ups preserve the conversation.
Perplexity branding is removed from these popups. Clay remains on enrichment.

Validation: TypeScript passed, plus 69 tests spanning feed privacy separation,
date boundaries and overlap, search routing, agenda merge, memo actions, and
audio waveforms. Simulator checks covered both search modals, follow-ups,
return to local filtering, revised connection labels, and opening/playing an
existing original recording from the Calendar timeline. Authenticated web
queries, Google sign-in, contact imports, HealthKit, and end-to-end feed sync
are separate acceptance gates; sample checks do not validate them.

Release remains pending: this redesigned shell is still a development preview.
Before an App Store/TestFlight build, verify authenticated flows and decide
which incomplete connections should ship, then promote the shell into the
production route. Confirm the Apple team for team@joinrytual.com, restore ASC
authentication, inspect the highest remote build number, sign an archive, and
run device acceptance testing. No upload or App Store submission has occurred.

## September 21 connector audit and calendar cleanup

See [the connector migration audit](audit/README.md) for the verified mobile
wiring, 51-module/175-route inventory, missing feature parity and migration
order. The date heading now opens a full month picker; controls are You,
Friends, Add event and the header recording-history button. The search mark
is one simple rock outline. Date selection was verified in Simulator.

Streaming chat now refreshes credentials before a request; contact imports
refresh the visible graph; authenticated profile settings link to the existing
settings route; recording shortcuts are consumed by the connected shell;
targeted notification destinations retain the original handlers. TypeScript
and 86 tests pass. Backend source verification still needs the iCloud
Amber ID folder downloaded. Full feature transfer is not complete.
