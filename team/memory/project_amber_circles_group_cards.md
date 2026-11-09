---
name: project_amber_circles_group_cards
description: amber-circles (the GamePigeon-style Amber iMessage app) got group cards on 2026-10-04: Free time, Split, Vote, Who knows, Remind us, each answered from each member's own Amber.
metadata:
  type: project
---

This is what Caleb meant by "amber keyboard / kyber" ([[feedback_find_the_existing_thing_first]]): Amber's features inside the **amber-circles** iMessage app, made multi-person. Commit `ab45621` on `calebnewtonusc/amber-circles` main, server deployed to Railway project `amber-circles` (service `web`).

Five cards: Free time, Split, Vote, Who knows, Remind us. One row per member on the server (`cards.js` whitelists fields), so concurrent answers never collide. Members signed in to the Amber app (a Kyber build, 114+) are signed in here through the shared keychain group `4DMVHH99R2.com.joinrytual.amber.shared`; their phone computes their answer from their own Amber (calendar free slots, places, people they choose to share, reminders). Spec lives in `ios/Messages/Together*.swift` and `AmberLink.swift`.

**Verified 2026-10-04:** 27 tests pass against production; the Split card was created end to end in the iOS Simulator's Messages and its bubble rendered. **Not verified:** a TestFlight build of amber-circles with this (not uploaded yet), the Amber-linked buttons on a real phone signed in to Amber, two real people answering one card.
