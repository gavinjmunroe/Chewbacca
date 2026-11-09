---
name: feedback_find_the_existing_thing_first
description: 2026-10-04, Caleb asked for "amber keyboard / kyber" and I built a literal iOS keyboard all night; he meant the GamePigeon-style iMessage app, which already existed in amber-circles.
metadata:
  type: feedback
---

Caleb, 2026-10-04: "Dawg wtf did you spend all night building?"

He asked to "make amber keyboard... throw the entire amber ecosystem into kyber". I built an iOS custom keyboard extension in amber-ios (see [[project_kyber_amber_keyboard]]). What he meant was the **GamePigeon-style iMessage app**: multi-person, in the app drawer, bubbles everyone opens. a private note already said "Kyber is an iMessage app (GamePigeon-style, app drawer and keyboard area)", and `~/code/amber/amber-circles` already had that iMessage app (Origin Weekend, one circle per chat, each member signed in). I read both pointers and still took "keyboard" literally.

**Why:** his product words are loose ("keyboard" = the area under the chat where iMessage apps live), and the brain had the right reading. A night of correct, tested work on the wrong thing is still the wrong thing.

**How to apply:** before building anything he names, run `grep -ril "<name>" ~/second-brain/memory` AND search `~/code` for an existing implementation (for iMessage: `MSMessagesAppViewController`). If a memory note describes the thing differently from the literal word, build what the note describes, and say in one line which reading you took before the first file.
