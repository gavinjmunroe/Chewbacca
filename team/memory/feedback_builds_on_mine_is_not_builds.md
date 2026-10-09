---
name: feedback_builds_on_mine_is_not_builds
description: Portal code compiled on Swift 6.2 and broke Gavin's whole test run on 6.1.2; a shipped kit has to build on the toolchain other people have
metadata:
  type: feedback
---

2026-09-21. Two things written for the HUD portal built and tested clean on
this Mac and did not compile on Gavin's:

1. `WKScriptMessage.body` became **main-actor isolated in the 15.x SDK**, so
   a `nonisolated` `userContentController` is an error on Swift 6.1.2. His
   fix was `MainActor.assumeIsolated { handle(message) }`, which states the
   guarantee WebKit already makes instead of hopping, because hopping would
   reorder the message against the `Task` after it.
2. **`import XCTest` does not resolve in this package** on 6.1.2. The
   `LandmarkBridgeTests` file had to become Swift Testing.

**Why it mattered more than a compile error normally does.** The Portal
target failing to compile stopped the build before any test file was
reached, so `swift test` for the WHOLE package died and took 177 unrelated
tests with it. One target nobody else was touching silently zeroed his
entire signal. His commit message: *"the portal target took the whole test
run down with it."*

This machine is on **Swift 6.2**; he is on **6.1.2**. `Package.swift` says
`swift-tools-version: 6.0`, so the package claims support for a toolchain
nothing is ever built against.

**How to apply.** Chewbacca is installed by other people, so "builds on
mine" is not "builds". Before pushing Swift:

- Run `swift test` for the **whole package**, never `--filter`. A filtered
  run still compiles everything, but a green filtered run on one toolchain
  says nothing about another.
- Prefer Swift Testing over XCTest in this package.
- Treat concurrency isolation on SDK types as version-sensitive. `nonisolated`
  on a delegate callback is the exact shape that moves between SDKs.
- A target that fails to compile takes the whole suite with it, so a new
  target is a suite-wide risk until it has been built somewhere else.

See [[project_portal]] and [[feedback_a_silent_guard_proves_nothing]].
