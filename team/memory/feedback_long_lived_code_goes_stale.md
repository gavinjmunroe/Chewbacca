---
name: feedback_long_lived_code_goes_stale
description: Any process that lives past a kit update keeps running old code; give it one owner that restarts it on update (chewbacca-daemon), or make it hand over itself (10/11)
metadata:
  type: feedback
---

The kit runtime swaps ~/.chewbacca/kit/current every few minutes, but a running
process keeps the snapshot it started from. On 2026-10-11 Carlton's app was on
main and installed, and "show my agents" still failed three ways in an hour:
the surfaces daemon from that morning didn't know the realm surface ("That
surface didn't open."), hud-listen from 17:44 routed to the old empty card,
and a realm-ui server spawned on the side held the port so the daemon's copy
died on every retry and the orphan served hours-old code.

**Why:** each was started detached by whoever needed it first, so nothing that
notices a kit update owned it. Caleb: "Fix chewb so that never happens again
find the root cause".

**How to apply:** a long-lived server is a chewbacca-daemon service and nothing
else spawns it (the daemon restarts every service when the kit moves; realm_ui
start, 3544d4a0). A process that can't be a daemon child (hud-listen, which
needs Kyber's microphone grant; kyber-surfaces, started on demand) checks its
snapshot and hands over to the current code (57cd4ba0, bin/lib/kit_snapshot.py).
To audit: `ps -eo pid,etime,command | grep kit/snapshots/` and anything not on
`readlink ~/.chewbacca/kit/current` is stale. Related:
[[feedback_one_background_item]], [[project_kit_runtime]].

**2026-10-11, 8:11 to 8:18pm, twice more.** The agents icon opened the retired card because kyber-surfaces was still on pruned snapshot 902977c0 (retire_stale only runs when something calls `start`); it now hands over on its own once the glass is quiet (9528874d). Then realm-engine, up since 10/10 21:15 on pruned 48071084, stopped answering; restarted by hand, its own handover is ledger task realm-engine-handover-2026-10-11. A one-time check at start is not ownership: every long-lived process needs a loop that notices the kit moved.
