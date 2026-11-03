---
name: reference_people_check_amber_rules
description: chewbacca people-check runs Amber's people rules (realness, dupes, nicknames, mentions, Whisper filler) over the people store, with Jev deciding the unsure cases
metadata:
  type: reference
---

`bin/lib/people-amber/` holds six modules from Amber's amber-id (copied 2026-11-02 under Karthik's 2026-10-20 ruling that features move freely), with Amber's own 138 tests. Any language can call `node bin/lib/people-amber/cli.mjs realness|dupes|mentions|filler|trust` with JSON on stdin. The row shape is Amber's: `full_name`, `emails` as one comma string, `phone_primary`, `phones_all`, `company`. Pass `emails` as an array and dupes silently finds nothing.

`chewbacca people-check dupes --jev` on Caleb's store (3,346 people) found 122 candidates: 1 provable (a shared email), 24 Jev put at 0.8 or higher, 97 left for a person. Nothing merges; it only reads. Jev's noul answer comes back as `{"type": "noul", "noul": 0.83}`, not a bare number, so read `answer["noul"]`. The first run read the bare value and got zero answers.

Meeting capture strips Whisper's silence outros ("Thank you for watching", Amara subtitle credits) from each chunk's ends with `bin/lib/transcript_filler.py`, a Python twin of Amber's JS that a test keeps in agreement with it.
