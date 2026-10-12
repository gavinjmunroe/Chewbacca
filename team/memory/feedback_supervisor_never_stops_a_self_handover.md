---
name: feedback_supervisor_never_stops_a_self_handover
description: A service that knows when it's safe to move (realm-engine waits for no running turn) owns its own handover; the supervisor only reads where it went, never stop-starts it on a kit move
metadata:
  type: feedback
---

On 2026-10-12 chewbacca-daemon stop-started the realm agent engine at
14:57:19Z and 15:03:47Z, 30 s and 23 s into two real Claude turns, and both
turns died. realm-engine already had the right handover (exec the new kit's
copy only when sessions.listAll says no turn is running), but step 10's
blue/green swap reached it first, so two owners decided when realm moved.

Fixed in a2097b88 and 43c98605: swap mode "self". The daemon never stops a
self service for a kit move, and only refreshes its generation from the shas
in its process group's command lines. A realm adopted from the
com.chewbacca.realm plist is self by its label, never by a key written into
realm.json, so a kit moved back to an older daemon still loads the file.

**Why:** proven three ways. A test that fails on the old daemon ("the kit move
killed the agent mid-turn"), a rehearsal with the real engine and a held
permission (main's daemon killed it 3 s after the move), and live at 18:06Z
(swaps.jsonl mode self, same pid 73507, node child on the new snapshot).

**How to apply:** before a supervisor restarts anything on its own schedule,
ask whether the process has state a restart destroys (a running turn, an
unanswered permission, a recording). If it does, it owns its handover and the
supervisor reads, never acts. Related: [[feedback_long_lived_code_goes_stale]].
