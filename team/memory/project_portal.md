---
name: project_portal
description: The Doctor Strange portal: pinch and draw a circle to burn a real hole in the HUD glass with an app window behind it; Portal.app plus bin/portal
metadata:
  type: project
---

Built overnight 2026-09-20 to 21. Pinch thumb to index, sweep a circle in
the air, a portal burns itself open over the desktop. Pinch again to close.

**Two places it runs.** `calebnewtonusc/OpenVision` route `/strange` is the
browser version. `Portal.app` in Chewbacca (`hud/scripts/bundle-portal.sh`,
`bin/portal`) is the HUD version, on branch `feat/portal-hud`.

**The architecture, and why.** Apple Vision produces landmarks at 7.56ms a
frame, `LandmarkBridge` converts them, a transparent WKWebView only draws.
NOT MediaPipe in a webview: that is a second camera stream, a WASM model off
a CDN at launch, and several times the CPU. The gesture logic stays in the
web layer because it has 53 tests in OpenVision and a Swift rewrite would
mean two implementations of subtle geometry with tests for one. The core is
vendored at a recorded commit with `sync.sh`, because an app bundle must not
resolve a dependency at launch.

**An ARMED portal punches a real hole** with `destination-out` and the
target window is moved behind it. Nothing is captured or composited, so it
is live with no latency by construction. ScreenCaptureKit was rejected: a
frame of latency, a second encode of pixels already on screen, a recording
indicator, and a picture of a window rather than the window.

**Targets are a lookup table**, `~/.chewbacca/portal-targets.tsv`.
`portal open dashboard`. See a private note.

**Why:** he wanted to wake up and show his friends something that made them
say woahhhh. It is also the honest version of "open a portal to a different
part of the computer", which is his own framing and better than an effect.

**How to apply:** `portal open <name>`, `portal targets`, `portal close`.
Rebuild with `hud/scripts/bundle-portal.sh`. Palm-dismiss and point-deixis
exist but are OFF (`hud.handControl` false); he found them noisy. Not built
yet: the voice saying "sure go ahead doctor strange" before he draws, and
the dashboard rendering inside the ring rather than behind it.
See [[project_openvision_is_his]] and [[feedback_the_screenshot_beat_the_code]].
