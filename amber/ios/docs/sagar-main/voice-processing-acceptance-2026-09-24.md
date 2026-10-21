# Voice processing acceptance — September 24, 2026

The connected app has been rebuilt and signed for the iOS simulator; the separate demo also runs with the updated recorder. Recorder interaction and local audio retention are verified; the backend compatibility changes are deployed. This is **not yet an App Store release acceptance**: physical-device checks, App Store Connect credentials, and a distribution archive/upload remain outstanding.

## Build and deployment

- Frontend: shared changes are in `demomain` and connected `sagar-main`, using Amber's existing design system. The signed simulator artifact was built from the connected app in a local staging checkout.
- Backend: Railway deployment `2ccce3c7-4c90-473b-8155-15b45f02252b` completed with **SUCCESS**.
- The native simulator Debug build was signed successfully. Artifact: `/private/tmp/amber-sept24-derived/Build/Products/Debug-iphonesimulator/Amber.app`.
- Simulator signing does not establish distribution signing or App Store eligibility.
- App Store Connect authentication status and deep validation found no configured ASC credentials for the requested account, `team@joinrytual.com`. No distribution archive or TestFlight/App Store upload has been completed in this pass.

## Verified behavior

The simulator recording, pause, resume, stop and playback flow stays in the same modal. The original recording is copied into durable, account-scoped storage before transcription begins. Transcription failure can therefore leave a recoverable recording instead of an unsaved temporary clip.

The processing tests cover:

- Authenticated audio ticket, correctly typed signed upload, and acknowledged finalization. Failed tickets, missing files, failed uploads and failed finalization never report that audio was saved. Empty, oversized and over-duration clips are refused rather than silently accepted or shortened.
- Explicit processing deadlines and cancellation propagation. Writes do not automatically retry without confirmation.
- One memo producing separate contact, calendar and task drafts. Invented contact IDs, invalid or ambiguous dates and unsupported actions are rejected; exact duplicate proposals collapse.
- Stable action identities across retries and relaunches. Changing the reviewed action creates a different identity. The backend scopes every identity to its authenticated owner and destination.
- Durable contact-note acknowledgement without waiting for structured extraction. A model call that never resolves does not block acknowledgement; replay does not start extraction again.
- Cloud transcript corrections with compare-and-set semantics. The original transcript remains in metadata; replay is safe, stale edits are refused, and local edits do not claim to be backed up before acknowledgement.

## Test evidence

| Check | Result |
| --- | --- |
| Final combined mobile checks, including permissions and pooled-event regressions | 54 passed |
| Mobile TypeScript | Passed |
| Backend full suite | 1,640 passed; 45 skipped; two environment failures resolved in separate reruns |
| Backend boot rerun with localhost permission | Passed |
| SQL template/parser checks using the existing ESLint dependency | 2 passed |
| Changed backend JavaScript syntax and binding checks | Passed |
| Additional journal creation-retry-after-correction regression | Passed |
| Actual local PostgreSQL acceptance | Passed |
| Simulator recorder and playback interaction | Passed |
| Authenticated synthetic production audio processing and cloud playback | Passed |

The SQL acceptance submitted eight concurrent calendar actions and eight concurrent contact actions. Each group created exactly one row. Changed payloads, deleted targets and foreign-owner writes were refused. Dimension classification, transcript correction replay, stale editor rejection, owner isolation and original-transcript retention were checked against the database.

The scratch PostgreSQL installation lacks pgvector. Its untouched nullable embedding column used `real[]` for this test; embedding behavior was not tested. The tested primary keys, foreign keys, transactions and statements used the migration-defined SQL. Skipped database tests are not counted as passed.

## Reproducing the mobile checks

Run from the mobile directory with the repository test runner:

```sh
cd /Users/sagartiwari/dev/amber-ios-sagar-main/apps/mobile
/usr/local/bin/node scripts/test.mjs \
  components/NetworkCanvas lib/networkLayout lib/recordingSession \
  lib/noteMedia lib/memoActionId lib/journalSync lib/journalLocal \
  lib/applePermissions
```

`scripts/test.mjs` uses Node 22 type stripping and registers
`scripts/test-loader.mjs`, which supplies the native-module test stubs. Running
these files directly with `node --import tsx --test` bypasses that required loader
and can fail on React Native Flow/CommonJS imports before behavioral tests run.
Do not interpret those import failures as recorder or permission failures.

The final combined command passed **54/54 tests** after the Health permission management change. TypeScript also passed.

## Live production acceptance

**Passed against the deployed service.** An authenticated 8.926-second synthetic recording transcribed in **1,707 ms** and produced contact, calendar and task proposals in **2,616 ms**. These are individual stage measurements from one short synthetic clip, not a latency percentile or an end-to-end device measurement.

The private transcript, original audio and transcript correction were all confirmed saved. Playback resolved the canonical owner from the conversation and returned HTTP 200 with **77,781 bytes** from the signed audio URL. Temporary audio and journal data were both removed successfully. No real contact note or calendar event was written by this production smoke test.

This verifies the deployed processing and cloud audio path for a roughly nine-second synthetic clip. Physical-iPhone microphone capture, interruptions and longer recordings still require acceptance.

## Current product boundaries

- Google Calendar synchronization is a read/import path. Confirming a proposed event creates an Amber calendar event; it does not write that event back to Google.
- Contact notes are durable before acknowledgement. Further structured extraction runs best-effort in the background, rather than through a durable job queue. A process failure can leave the note saved without additional extracted facts.
- The Meta integration is unavailable. Displaying the proper Meta mark is not an active messaging or data connection.
- The Apple section exposes permissions for location, contacts, photos and health/fitness. Permission presentation or authorization does not establish that every corresponding data ingestion, synchronization or enrichment path is implemented.
- Original non-audio attachments remain on the device. Action receipts remain in the device journal index rather than a complete cross-device action history.
- Research/drafting does not imply computer execution or external message delivery.
- A rare lost audio-finalization response followed by retry can reserve a new storage key, temporarily returning cloud audio to pending until upload succeeds. The durable local recording remains available.

The rebuilt native bridge returned Contacts as allowed, Location/Photos/Health as not requested, and Fitness as unavailable on the simulator. This check did not change permissions. Previously reviewed Health access now shows inline instructions for managing it in the Health app.

## Remaining acceptance and release checks

1. Repeat the passed live processing smoke test after any material backend or recording-pipeline change. Keep temporary test data isolated and remove it after verification.
2. On a physical iPhone, verify microphone denial/regrant, a normal spoken memo with proper names, pause/resume, playback, the recording limit, and audio-route changes. Confirm that the original survives interrupted transcription, app backgrounding and relaunch.
3. Verify offline capture and recovery, interruption during upload, a lost success response, and a corrected transcript after relaunch. Confirm there are no duplicated contact notes or calendar events.
4. Check Apple permission denial, limited access and revocation on a device. Validate HealthKit capability/entitlement and actual data behavior before describing health data as connected. Keep unavailable integrations clearly marked.
5. Run the final release build with production entry/configuration, supported-device layouts, accessibility and reduced-motion settings. Confirm the real account, deletion, privacy and support flows, and that App Store privacy declarations match data actually collected or sent for processing.
6. Configure App Store Connect access for the intended Apple team, verify the app record and distribution signing, check the highest remote build number, then archive, validate and upload. Complete TestFlight device acceptance before App Store submission.

The simulator demo and backend regression results support continued testing. They do not substitute for the remaining device, production and distribution checks.
