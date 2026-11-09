---
name: project_google_sign_in_app_fresh_mac
description: Setting up Chewbacca's Google sign-in app on a teammate's Mac, done on Gavin's 2026-11-09; what gws can't do and what the console refuses.
metadata:
  type: project
---

On a Mac with no OAuth client, gws 0.22.5's `auth setup` enables the APIs and then exits 3:
"OAuth client creation requires manual setup in the Google Cloud Console". `chewbacca email
add` now prints the three console steps and adopts the Desktop client JSON from Downloads.

What the console did on Gavin's Mac (a new project owned by his personal Google account):

- The Google Auth Platform wizard, test users and Desktop client can all be driven by
  `chrome-js` (fill inputs with the native value setter plus an input event, chips commit on
  Enter). No mouse needed.
- Publish app stays disabled until the Branding page has its links (privacy policy), so the app
  runs in Testing with each inbox added as a test user, and sign-ins expire every 7 days.
- A Workspace inbox signs in fine and then needs serviceUsageConsumer on the project, which
  `email add` grants itself.
- Chrome's AppleScript sees only one profile's windows. A consent tab opened in another
  profile can't be clicked by chrome-js, so that click is the person's.
- `people texts search` clips each text at 90 characters and errors on a hyphen in the query.
  The thread view (`people texts "<name>"`) prints texts whole.
