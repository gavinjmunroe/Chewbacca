---
name: reference_amber_testflight_public_link
description: Amber iMessage app public TestFlight link for Origin judges, and why Sign in with Apple fails on the simulator
metadata:
  type: reference
---

Amber (the iMessage app for Origin Weekend, a private note) has a public TestFlight group "Try Amber": https://testflight.apple.com/join/7DMFRSv8 (limit 500). Build 45 was submitted for Beta App Review on 2026-09-27; the link only installs once review passes. Internal group "Origin Weekend" (Caleb, Shirley) needs no review.

Sign in with Apple cannot work on the simulator build: `codesign -d --entitlements -` on the simulator .app and .appex prints no entitlements at all, so Apple refuses before the server is reached and the app shows "That didn't go through". Test sign-in on a TestFlight build on a real phone. "Continue without signing in" covers the simulator and reviewers.

Update 2026-09-28 2:20pm: build 45 went IN_REVIEW at ~1:56pm. Apple reviews one build per version train at a time, so the public link says "not accepting new testers" until 45 clears. A detached watcher in `~/Library/Caches/amber-ship` (review.log) adds the newest processed build to the "Try Amber" group and submits it the moment 45 clears; the same folder retries the blocked build 60 upload hourly (ship.log).
