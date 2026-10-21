# Amber ID connection acceptance — September 22, 2026

The simulator runs the persistent `/Users/sagartiwari/dev/amber-ios-sagar-main`
checkout with Node 22 and `npm run preview:connected` from `apps/mobile`.
The workspace `amber-ios` copy contains the same changed frontend files.

## Live backend

Railway production deployment `d66b49a6-aa4a-4622-8469-5efeee48492d` is healthy.
It includes the private journal save route, full community ranks, imported
contact details, date-filtered shared feed and original memo audio restoration.
No migration was needed. Source is saved in the persistent Amber ID Main checkout
and workspace `amber-id-main`; these changes are not committed/pushed yet.

Authenticated simulator acceptance:

- All 2,267 contacts returned; 2,255 have existing computed ranks.
- Contact detail, full facts and six-dimension rank requests succeeded.
- Agenda, daily memo history, shared feed, circles and calendar accounts returned 200.
- A temporary silent AAC memo saved, retried without duplication, restored its
  original transcript, uploaded/finalized audio and downloaded signed playback.
  The test audio and conversation were removed afterward. Nothing was shared.
- This account currently has zero saved circles and zero connected calendar accounts.

## UI

The rock exposes Amber Alert above, Nearby below, Family/Friends/Romance on the
left and Work/School/Exercise on the right. Selecting the active category again
returns to all contacts. Categories start empty and use server-persisted circles;
assignment is explicit in Edit members. General Community orders existing
computed People Rank scores descending, with unscored contacts after them.

Nearby uses saved contact city values and an editable city initialized from the
user profile. It is not live GPS proximity or a public directory of strangers.

Contact cards show full imported notes in Overview and source observations,
Details/Photos/Sources in that order, and an expandable People Rank radar. Apple
and Google provider records and linked voice memo evidence are in Sources.
Sharing remains at the top right. Missing provider data is not manufactured.

Apple Notes limitation: Main intentionally excludes `Contacts.Fields.Note` from
`CONTACT_FIELDS` because this signed build lacks the restricted Contacts Notes
entitlement. Existing notes in Amber render in full; the app cannot import new
Apple contact notes until that entitlement is approved and a suitably signed
build includes it. Do not add Note unconditionally: iOS can reject the entire
contact fetch with `unauthorizedKeys`.

Calendar uses Main's agenda, day-windowed conversations, shared updates and
calendar connection controls. Open the settings control beside Add event to
connect a Google/Outlook account or grant access to calendars on the device.
OAuth and pull-to-refresh await sync before refreshing the agenda. The feed shows
sync/account errors instead of silently treating them as no data.

## Validation and remaining acceptance

31 focused mobile tests and TypeScript passed. Backend focused route tests,
full-suite checks (environment-only failures rerun successfully), boot checks
and real PostgreSQL ownership/journal tests passed. Forty-five backend tests
requiring additional fixtures were skipped by the existing suite.

Still required: complete the user's provider authorization, then check real
Google/Apple calendar events on a physical device and a fresh human recording.
Nearby GPS discovery and notifications from Amber Alerts are separate work.
No TestFlight upload or App Store submission was performed in this update.
