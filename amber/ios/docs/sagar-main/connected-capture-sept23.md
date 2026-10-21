# Connected capture and Calendar — September 23, 2026

The connected source remains on `sagar-main` in `/Users/sagartiwari/dev/amber-ios-sagar-main` (Metro 8081). The workspace copy is `amber-ios`. A separate `demomain` task/checkout and simulator handle the new middle-screen demo on Metro 8082. Demo locations, wearable battery, daily self score and friend overlaps remain synthetic. Preserve Amber styling; Oura/Whoop are gauge-shape references only.

## Verified in the connected app

- A native 2,267-person graph-layout benchmark improved from 679 ms to 20 ms (mean of 10 runs, same synthetic input). This measures layout, not end-to-end tap latency.
- Rock drag hover runs on the UI thread; taps toggle its circle menu. Community and Calendar stay mounted across tab changes. Contact pickers render at most 30 searchable matches.
- The center glass-dock + opens recording, text/paste and attachment capture. NativeWind did not apply functional Pressable layout styles in this client; static style arrays fixed invisible/misplaced controls.
- One Google account is connected. The latest sync completed without an error; September 2026 agenda returned 199 events. Consent now offers Calendar-only scopes and checks the stored account before reporting success. Google sync includes selected calendars, pagination, recurring instances, time-zone-correct all-day events, descriptions, locations and cancellations.
- Live synthetic text/PDF extraction and 4.5-second voice transcription passed. Capture proposals are read-only; confirmed contact and calendar actions still use Main's owner-scoped write routes. The contact extractor was corrected to retain ordinary preferences without an explicit save command.
- Private Amber notes persist through the journal endpoint. Circle alerts use one explicitly selected saved circle. Nearby and multi-circle mutual-opt-in delivery are not implemented on the production backend; the demo can illustrate them without notifications.

## Execution boundary

The old configured `medha-platform-production.up.railway.app` agent host returns Railway application-not-found, and the current Amber project contains only Amber ID and the website. The capture's Ask Amber action now uses Main's active `POST /v1/chat` for research/drafting, with follow-up mode to avoid incidental automatic contact writes. A live synthetic question completed with a real streamed reply. Computer control, external sends and bookings are not available; the UI says so. Google import is live; manually created Amber events are not yet a verified Google write-back implementation.

Original attachments are retained on this device; extracted text is backed up in the private journal. Recorded audio retains Main's signed upload/playback flow. No TestFlight archive or upload was performed in this pass.

## Validation

TypeScript and 23 focused mobile tests passed. The backend full run had 1,634 passing tests and 45 skips; the sandbox-bound boot check and missing-ESLint parser check passed separately with the appropriate local environment. New processor request tests passed. Calendar SQL was checked against actual local migration tables for idempotent updates, all-day/location/description fields, start-less cancellation and owner isolation. No production notifications were sent during testing.
