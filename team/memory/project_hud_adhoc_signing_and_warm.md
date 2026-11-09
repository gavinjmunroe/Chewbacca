---
name: project_hud_adhoc_signing_and_warm
description: BobHUD was ad-hoc signed so every rebuild dropped Accessibility, and the speech model was warmed once at launch; both fixed 2026-09-21
metadata:
  type: project
---

Three findings from the HUD on 2026-09-21, all made visible by reading the
`bob.hud` log rather than theorising.

**Ad-hoc signing was costing the Accessibility grant, and it did not have to.**
`/Applications/BobHUD.app` was signed ad-hoc. macOS stores Accessibility as a
code requirement, and an ad-hoc signature gives it nothing to name but the
binary's own hash, so every rebuild was a new hash and a dropped grant.
`hud/scripts/bundle.sh` looked for exactly one identity, by the name
**"Chewbacca Local Signing"**, which `scripts/signing-identity.sh` creates and
which had never been run. Meanwhile a perfectly good **Apple Development: CALEB
SPENCER NEWTON (N9F648W7F4)** certificate was sitting in the keychain the whole
time, and it needs no administrator password.

Verified rather than assumed: two completely different binaries signed with that
certificate produce a byte-identical designated requirement, pinned to the
certificate and the bundle id instead of the hash. `bundle.sh` now falls back to
any `Apple Development` identity before going ad-hoc. Developer ID is
deliberately skipped; that one is for distribution.

**This corrects [[project_hud_voice_key_chain]]**, which said re-granting
Accessibility after a rebuild was "macOS, not a bug". It was the ad-hoc
signature, and it is fixed.

**The recogniser was warmed once, at launch, and never again.** `voice.warm` ran
at 17:07 and the next press at 21:37 took **651ms** from key down to the
microphone opening. The press twelve seconds later took **73ms**. The on-device
model is evicted after a stretch of disuse and the first press of every sitting
paid to load it. There is now a 240s re-warm, skipped whenever a turn is open so
it never competes with a real sentence.

**The talk key never raised the overlay.** `globe(down:)` went straight to
push-to-talk, so holding it with the glass hidden opened the microphone behind a
blank screen with nothing on screen to say so. It now raises the overlay, placed
after the double-tap check so double-tap-to-leave still leaves.

Shipped in chewbacca `2b511a2`, 185 tests in 32 suites passing. The old ad-hoc
bundle is parked at `/Applications/BobHUD.app.adhoc-*` rather than deleted.

**How to apply:** the HUD app is already resident 24/7 via the LaunchAgent
`com.calebnewton.chewbacca.hud` (KeepAlive=1). When the HUD feels slow, the app
is not what is cold. Read the log first:
`log show --style compact --last 2h --predicate 'subsystem == "bob.hud"'`.
Note that zsh mangles that predicate inline, so put it in a script file.

See [[project_session_startup_profiled_2026_09_21]] for the session it came from.
