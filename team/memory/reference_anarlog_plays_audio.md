---
name: reference_anarlog_plays_audio
description: Anarlog (bundle id com.hyprnote.stable) was the mystery sound on 2026-10-05; how to find what holds the speaker
metadata:
  type: reference
---

Anarlog is the meeting-notes app Caleb runs at login. Its bundle id is still `com.hyprnote.stable`, so it shows up under that name in coreaudiod logs, not as "Anarlog".

On 2026-10-05 it was what was playing sound on his Mac. Confirmed by Caleb after quitting it.

How it was found: `pmset -g assertions` showed a BuiltInSpeakerDevice audio-out assertion but not which app held it. `log show --predicate 'process == "coreaudiod"'` with a grep for `client:` gave the bundle ids, and com.hyprnote.stable was the most frequent. Music, Spotify, Chrome, QuickTime and Comet were all checked and ruled out first.

Related: [[feedback_onboarding_like_anarlog]]
